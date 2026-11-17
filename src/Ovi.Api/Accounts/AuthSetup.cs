using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.DataProtection;
using Ovi.Api.Data;

namespace Ovi.Api.Accounts;

/// <summary>
/// Sign-in with Google and GitHub. Each provider is turned on only when its client id and secret are configured
/// (<c>Auth:Google:ClientId</c> / <c>ClientSecret</c>, <c>Auth:GitHub:ClientId</c> / <c>ClientSecret</c>).
/// After the provider's callback, the person gets an HttpOnly session cookie holding just their account id.
/// </summary>
public static class AuthSetup
{
    public const string CookieName = "ovi.session";
    public const string CertificatePathKey = "DataProtection:CertificatePath";
    public const string CertificatePasswordKey = "DataProtection:CertificatePassword";

    /// <summary>Provider ids used in URLs (/auth/login/google) and stored on users, mapped to scheme names.</summary>
    public static readonly IReadOnlyDictionary<string, string> Schemes = new Dictionary<string, string>
    {
        ["google"] = "Google",
        ["github"] = "GitHub",
    };

    public static IServiceCollection AddOviAuth(this IServiceCollection services, IConfiguration config, IWebHostEnvironment env)
    {
        // Encrypts the session and OAuth state cookies. Stored in Postgres so every deploy can read cookies from the last one.
        var dataProtection = services.AddDataProtection().SetApplicationName("ovi").PersistKeysToDbContext<AppDbContext>();
        if (LoadKeyProtectionCertificate(config) is { } keyCertificate)
        {
            // The key ring sits in the same database as the data, so it must not be readable with it alone: encrypt the
            // keys with a certificate that only the app can see (e.g. a Render secret file), not a database value.
            services.AddSingleton(keyCertificate);
            dataProtection.ProtectKeysWithCertificate(keyCertificate);
        }

        var auth = services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(o =>
            {
                o.Cookie.Name = CookieName;
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Lax;
                o.Cookie.SecurePolicy = env.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
                o.ExpireTimeSpan = TimeSpan.FromDays(30);
                o.SlidingExpiration = true;
                // This is an API: answer 401/403 instead of redirecting to a login page.
                o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
                o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
            });

        if (Configured(config, "Google") is { } google)
        {
            auth.AddGoogle(Schemes["google"], o =>
            {
                o.ClientId = google.Id;
                o.ClientSecret = google.Secret;
                o.CallbackPath = "/auth/callback/google";
                o.Events.OnCreatingTicket = ctx => CompleteSignIn(ctx, "google",
                    emailVerified: ctx.User.TryGetProperty("email_verified", out var v) && v.ValueKind == JsonValueKind.True);
                o.Events.OnRemoteFailure = LoginFailed;
            });
        }

        if (Configured(config, "GitHub") is { } github)
        {
            auth.AddOAuth(Schemes["github"], o =>
            {
                o.ClientId = github.Id;
                o.ClientSecret = github.Secret;
                o.CallbackPath = "/auth/callback/github";
                o.AuthorizationEndpoint = "https://github.com/login/oauth/authorize";
                o.TokenEndpoint = "https://github.com/login/oauth/access_token";
                o.UserInformationEndpoint = "https://api.github.com/user";
                o.UsePkce = true;
                o.Scope.Add("read:user");
                o.Scope.Add("user:email");
                o.Events.OnCreatingTicket = async ctx =>
                {
                    var profile = await GitHubGetAsync(ctx, ctx.Options.UserInformationEndpoint);
                    var id = profile.GetProperty("id").GetRawText();
                    var name = profile.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
                    name ??= profile.GetProperty("login").GetString();
                    // The profile's public email isn't necessarily verified; use the primary verified one instead.
                    string? email = null;
                    try { email = PrimaryEmail(await GitHubGetAsync(ctx, "https://api.github.com/user/emails")); }
                    catch (HttpRequestException) { /* The email scope wasn't granted; sign in without an email. */ }

                    ctx.Identity!.AddClaim(new Claim(ClaimTypes.NameIdentifier, id));
                    if (name is not null) ctx.Identity.AddClaim(new Claim(ClaimTypes.Name, name));
                    if (email is not null) ctx.Identity.AddClaim(new Claim(ClaimTypes.Email, email));
                    await CompleteSignIn(ctx, "github", emailVerified: email is not null);
                };
                o.Events.OnRemoteFailure = LoginFailed;
            });
        }

        services.AddAuthorization();
        return services;
    }

    /// <summary>True when the key ring stored in the database is encrypted (a certificate is configured).</summary>
    public static bool KeysAreEncrypted(IConfiguration config) =>
        !string.IsNullOrWhiteSpace(config[CertificatePathKey]);

    /// <summary>
    /// The optional X.509 certificate that encrypts the data protection key ring at rest
    /// (<c>DataProtection:CertificatePath</c> and <c>DataProtection:CertificatePassword</c>), or null when unset.
    /// </summary>
    public static X509Certificate2? LoadKeyProtectionCertificate(IConfiguration config)
    {
        var path = config[CertificatePathKey];
        if (string.IsNullOrWhiteSpace(path)) return null;
        if (!File.Exists(path))
            throw new InvalidOperationException($"{CertificatePathKey} points at '{path}', which doesn't exist.");
        try
        {
            return X509CertificateLoader.LoadPkcs12FromFile(path, config[CertificatePasswordKey], X509KeyStorageFlags.EphemeralKeySet);
        }
        catch (CryptographicException ex)
        {
            throw new InvalidOperationException($"Couldn't read the data protection certificate at '{path}'.", ex);
        }
    }

    /// <summary>Which providers are turned on, as URL ids ("google", "github").</summary>
    public static IReadOnlyList<string> EnabledProviders(IConfiguration config) =>
        Schemes.Where(s => Configured(config, s.Value) is not null).Select(s => s.Key).ToList();

    private static (string Id, string Secret)? Configured(IConfiguration config, string provider) =>
        config[$"Auth:{provider}:ClientId"] is { Length: > 0 } id && config[$"Auth:{provider}:ClientSecret"] is { Length: > 0 } secret
            ? (id, secret)
            : null;

    /// <summary>Creates or updates the account, then swaps the provider's claims for a small Ovi session.</summary>
    private static async Task CompleteSignIn(OAuthCreatingTicketContext ctx, string provider, bool emailVerified)
    {
        var key = ctx.Identity?.FindFirst(ClaimTypes.NameIdentifier)?.Value
                  ?? throw new InvalidOperationException($"{provider} didn't return a user id.");
        var services = ctx.HttpContext.RequestServices;
        var user = await UserSignIn.UpsertAsync(
            services.GetRequiredService<AppDbContext>(), services.GetRequiredService<TimeProvider>(),
            provider, key, ctx.Identity!.FindFirst(ClaimTypes.Name)?.Value, ctx.Identity.FindFirst(ClaimTypes.Email)?.Value, emailVerified);
        if (user.BlockedAt is not null) throw new AccountBlockedException();
        ctx.Principal = UserSignIn.SessionPrincipal(user);
    }

    /// <summary>Cancelled or failed sign-ins go back to the app with a flag instead of an error page.</summary>
    private static Task LoginFailed(RemoteFailureContext ctx)
    {
        ctx.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Ovi.Auth")
            .LogWarning(ctx.Failure, "Sign-in with {Scheme} failed", ctx.Scheme.Name);
        ctx.Response.Redirect(ctx.Failure is AccountBlockedException ? "/?login=blocked" : "/?login=failed");
        ctx.HandleResponse();
        return Task.CompletedTask;
    }

    private static async Task<JsonElement> GitHubGetAsync(OAuthCreatingTicketContext ctx, string url)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ctx.AccessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("Ovi", "1.0"));
        using var response = await ctx.Backchannel.SendAsync(request, ctx.HttpContext.RequestAborted);
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ctx.HttpContext.RequestAborted));
        return doc.RootElement.Clone();
    }

    private static string? PrimaryEmail(JsonElement emails) =>
        emails.ValueKind != JsonValueKind.Array
            ? null
            : emails.EnumerateArray()
                .Where(e => e.TryGetProperty("primary", out var p) && p.GetBoolean() &&
                            e.TryGetProperty("verified", out var v) && v.GetBoolean())
                .Select(e => e.GetProperty("email").GetString())
                .FirstOrDefault();
}

/// <summary>A suspended account tried to sign in.</summary>
public sealed class AccountBlockedException() : Exception("This account is suspended.");
