using System.Security.Cryptography;
using System.Text;
using Ovi.Api.Accounts;
using Ovi.Api.Data;

namespace Ovi.Api.Security;

/// <summary>Who is making an API request: the admin (API key), a signed-in user (session cookie), or nobody.</summary>
public abstract record Caller
{
    public sealed record Admin : Caller;
    public sealed record User(int Id) : Caller;
    public sealed record Anonymous : Caller;

    private const string ItemKey = "ovi.caller";

    /// <summary>The caller worked out by <see cref="CallerFilter"/> for this request.</summary>
    public static Caller From(HttpContext ctx) =>
        ctx.Items[ItemKey] as Caller ?? throw new InvalidOperationException("CallerFilter didn't run for this endpoint.");

    internal static void Set(HttpContext ctx, Caller caller) => ctx.Items[ItemKey] = caller;

    public bool SignedIn => this is Admin or User;
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
        var caller = Resolve(http, config);
        if (caller is null)
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Missing or invalid API key.");

        if (caller is Caller.User && !HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method) &&
            !http.Request.Headers.ContainsKey(CsrfHeader))
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: $"Missing the {CsrfHeader} header.");

        Caller.Set(http, caller);
        return await next(context);
    }

    /// <summary>The caller, or null for a wrong API key.</summary>
    public static Caller? Resolve(HttpContext http, IConfiguration config)
    {
        if (http.Request.Headers.TryGetValue(ApiKeyHeader, out var provided))
        {
            var expected = config["Auth:ApiKey"];
            return !string.IsNullOrEmpty(expected) && KeysMatch(expected, provided.ToString()) ? new Caller.Admin() : null;
        }
        return UserSignIn.UserId(http.User) is { } id ? new Caller.User(id) : new Caller.Anonymous();
    }

    // Hash first so the comparison is constant-time regardless of key length.
    private static bool KeysMatch(string expected, string provided) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
            SHA256.HashData(Encoding.UTF8.GetBytes(provided)));
}
