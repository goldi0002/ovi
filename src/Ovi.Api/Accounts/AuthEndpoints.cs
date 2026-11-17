using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;
using Ovi.Api.Links;
using Ovi.Api.Security;

namespace Ovi.Api.Accounts;

public record SessionUser(string Name, string? Email, string Provider, bool IsAdmin);

/// <param name="User">The signed-in user, or null.</param>
/// <param name="Admin">True for admins: the API key, or a signed-in user on the admin list.</param>
/// <param name="Providers">Sign-in providers that are turned on ("google", "github").</param>
/// <param name="AnonymousLinkDays">How long links made without signing in last.</param>
public record SessionResponse(SessionUser? User, bool Admin, IReadOnlyList<string> Providers, int AnonymousLinkDays);

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        // Starts sign-in: redirects to the provider, which comes back to /auth/callback/{provider}.
        app.MapGet("/auth/login/{provider}", (string provider, IConfiguration config, string? returnUrl) =>
            AuthSetup.Schemes.TryGetValue(provider.ToLowerInvariant(), out var scheme) &&
            AuthSetup.EnabledProviders(config).Contains(provider.ToLowerInvariant())
                ? Results.Challenge(new AuthenticationProperties { RedirectUri = SafeReturnUrl(returnUrl) }, [scheme])
                : Results.NotFound())
            .WithTags("Auth")
            .RequireRateLimiting(RateLimits.Auth);

        var api = app.MapGroup("/api").WithTags("Auth").AddEndpointFilter<CallerFilter>();

        api.MapGet("/session", async (HttpContext http, AppDbContext db, IConfiguration config) =>
        {
            var caller = Caller.From(http);
            SessionUser? user = null;
            if (caller.AccountId is { } id)
            {
                user = await db.Users.Where(x => x.Id == id)
                    .Select(x => new SessionUser(x.Name, x.Email, x.Provider, caller is Caller.Admin)).FirstOrDefaultAsync();
            }
            return Results.Ok(new SessionResponse(user, caller is Caller.Admin, AuthSetup.EnabledProviders(config), LinkRules.AnonymousLinkDays));
        })
        .Produces<SessionResponse>();

        // A session is a self-contained cookie, so clearing the browser's copy isn't enough: a copied cookie would keep
        // working. Bumping the account's stamp ends every session for this user, on every device.
        api.MapPost("/logout", async (HttpContext http, AppDbContext db) =>
        {
            if (UserSignIn.UserId(http.User) is { } id)
                await db.Users.Where(u => u.Id == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.SecurityStamp, UserSignIn.NewStamp()));
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// Only paths on this site ("/links"), never another site ("//evil.com", "https://evil.com"). Browsers drop tabs and
    /// newlines and treat "\" like "/", so "/\t/evil.com" would become "//evil.com": any whitespace, control character
    /// or backslash is refused outright.
    /// </summary>
    public static string SafeReturnUrl(string? returnUrl) =>
        returnUrl is { Length: > 0 and <= 512 } url && url[0] == '/' && (url.Length == 1 || url[1] != '/') &&
        !url.Any(c => char.IsControl(c) || char.IsWhiteSpace(c) || c == '\\') &&
        Uri.TryCreate(url, UriKind.Relative, out _)
            ? url
            : "/";
}
