using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using System.Text;
using Ovi.Api.Accounts;
using Ovi.Api.Data;

namespace Ovi.Api.Security;

/// <summary>Who is making an API request: an admin, a signed-in user (session cookie), or nobody.</summary>
public abstract record Caller
{
    /// <summary>The API key (<paramref name="UserId"/> null) or a signed-in user on the admin list.</summary>
    public sealed record Admin(int? UserId) : Caller;
    public sealed record User(int Id) : Caller;
    public sealed record Anonymous : Caller;

    private const string ItemKey = "ovi.caller";

    /// <summary>The caller worked out by <see cref="CallerFilter"/> for this request.</summary>
    public static Caller From(HttpContext ctx) =>
        ctx.Items[ItemKey] as Caller ?? throw new InvalidOperationException("CallerFilter didn't run for this endpoint.");

    internal static void Set(HttpContext ctx, Caller caller) => ctx.Items[ItemKey] = caller;

    public bool SignedIn => this is Admin or User;

    /// <summary>The account behind the request, if it came with a session cookie.</summary>
    public int? AccountId => this switch { User u => u.Id, Admin a => a.UserId, _ => null };
}

public static class CallerQueries
{
    /// <summary>The links this caller may see: all for the admin, their own for a user, none when anonymous.</summary>
    public static IQueryable<Link> VisibleTo(this IQueryable<Link> links, Caller caller) => caller switch
    {
        Caller.Admin => links,
        Caller.User u => links.Where(l => l.OwnerId == u.Id),
        _ => links.Where(_ => false),
    };
}

/// <summary>Endpoint metadata marking routes that accept the admin API key (used for OpenAPI docs).</summary>
public sealed class AcceptsApiKey;

/// <summary>
/// Works out the <see cref="Caller"/>. A request that sends <c>X-Api-Key</c> must send the right one (no fallback to the
/// cookie). Requests that change data with a session cookie must carry <c>X-Ovi-Request</c>: other sites can't add that
/// header without a CORS preflight, which Ovi never allows, so a cross-site form or fetch can't act as the user.
/// </summary>
public class CallerFilter(IConfiguration config) : IEndpointFilter
{
    public const string ApiKeyHeader = "X-Api-Key";
    public const string CsrfHeader = "X-Ovi-Request";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var (caller, problem) = await ResolveAsync(http, config);
        if (problem is not null) return problem;

        // Cookies are sent by the browser automatically, so cookie-based changes need proof they came from Ovi's UI.
        if (caller!.AccountId is not null && !HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method) &&
            !http.Request.Headers.ContainsKey(CsrfHeader))
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: $"Missing the {CsrfHeader} header.");

        Caller.Set(http, caller);
        return await next(context);
    }

    /// <summary>
    /// Works out the caller. A session is checked against the database on every request, so a suspended or deleted
    /// account, or an email taken off the admin list, loses access immediately rather than when the cookie expires.
    /// </summary>
    public static async Task<(Caller? Caller, IResult? Problem)> ResolveAsync(HttpContext http, IConfiguration config)
    {
        if (http.Request.Headers.TryGetValue(ApiKeyHeader, out var provided))
        {
            var expected = config["Auth:ApiKey"];
            return !string.IsNullOrEmpty(expected) && KeysMatch(expected, provided.ToString())
                ? (new Caller.Admin(null), null)
                : (null, Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Missing or invalid API key."));
        }

        if (UserSignIn.UserId(http.User) is not { } id) return (new Caller.Anonymous(), null);

        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        var account = await db.Users.AsNoTracking().Where(u => u.Id == id)
            .Select(u => new { u.Email, u.EmailVerified, u.BlockedAt }).FirstOrDefaultAsync();
        if (account is null)
        {
            // The account was deleted: end the session and carry on as a visitor.
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return (new Caller.Anonymous(), null);
        }
        if (account.BlockedAt is not null)
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return (null, Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "This account is suspended."));
        }
        return (AdminAccess.IsAdmin(account.Email, account.EmailVerified, config) ? new Caller.Admin(id) : new Caller.User(id), null);
    }

    // Hash first so the comparison is constant-time regardless of key length.
    private static bool KeysMatch(string expected, string provided) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
            SHA256.HashData(Encoding.UTF8.GetBytes(provided)));
}

/// <summary>Endpoint metadata: the route is for admins only. Added together with <see cref="AdminOnlyFilter"/>.</summary>
public sealed class RequiresAdmin;

/// <summary>Lets only admins through: 401 for visitors, 403 for signed-in users. Runs after <see cref="CallerFilter"/>.</summary>
public sealed class AdminOnlyFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next) =>
        Caller.From(context.HttpContext) switch
        {
            Caller.Admin => await next(context),
            Caller.User => Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Admins only."),
            _ => Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign in as an admin."),
        };
}

public static class AdminEndpointExtensions
{
    /// <summary>Works out the caller, then refuses everyone but admins. Use on every admin route group.</summary>
    public static TBuilder RequireAdmin<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter<TBuilder, CallerFilter>().AddEndpointFilter<TBuilder, AdminOnlyFilter>().WithMetadata(new RequiresAdmin());
}
