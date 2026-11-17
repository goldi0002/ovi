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

        api.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent);
    }

    /// <summary>Only paths on this site ("/links"), never another site ("//evil.com", "https://evil.com").</summary>
    public static string SafeReturnUrl(string? returnUrl) =>
        returnUrl is { Length: > 0 and <= 512 } url && url[0] == '/' && !url.StartsWith("//") && !url.StartsWith("/\\") &&
        Uri.TryCreate(url, UriKind.Relative, out _)
            ? url
            : "/";
}
