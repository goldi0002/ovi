using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Time.Testing;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Ovi.Api.Accounts;
using Ovi.Api.Data;
using Ovi.Api.Security;

namespace Ovi.Api.Tests;

/// <summary>Runs the API against its own Postgres database (in the shared test container) with a controllable clock.</summary>
public class OviApiFactory(Dictionary<string, string?>? settings = null, IPAddress? remoteIp = null, string? webRoot = null) : WebApplicationFactory<Program>
{
    public const string ApiKey = "test-key";

    /// <summary>Name of the named HttpClient the app uses for Safe Browsing (must match the app).</summary>
    public const string SafeBrowsingClientName = Ovi.Api.Security.SafeBrowsingUrlThreatCheck.HttpClientName;

    /// <summary>Stands in for Google Safe Browsing in every test, so no test can reach the real network.</summary>
    public FakeSafeBrowsing SafeBrowsing { get; } = new();

    /// <summary>Every log entry the app wrote, for checking that secrets never reach the logs.</summary>
    public CapturingLoggerProvider Logs { get; } = new();

    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero));

    /// <summary>A client that sends the API key and does not follow redirects.</summary>
    public HttpClient CreateAuthedClient()
    {
        var client = CreateUnauthedClient();
        client.DefaultRequestHeaders.Add(CallerFilter.ApiKeyHeader, ApiKey);
        return client;
    }

    /// <summary>
    /// A client signed in as a user (created on first use, like a first Google/GitHub sign-in), holding a real session
    /// cookie. It sends the X-Ovi-Request header the web UI sends, unless <paramref name="csrfHeader"/> is false.
    /// </summary>
    public async Task<HttpClient> CreateUserClientAsync(string providerKey = "user-1", bool csrfHeader = true, bool emailVerified = true)
    {
        var client = CreateUnauthedClient();
        var res = await client.GetAsync($"{TestLoginPath}?key={Uri.EscapeDataString(providerKey)}&verified={emailVerified}");
        res.EnsureSuccessStatusCode();
        if (csrfHeader) client.DefaultRequestHeaders.Add(CallerFilter.CsrfHeader, "1");
        return client;
    }

    private const string TestLoginPath = "/test-only/login";

    /// <summary>
    /// Each factory has its own database, so its connection pool would otherwise keep idle connections open after the
    /// test; with many factories that exhausts Postgres's connection limit. Close them when the factory goes away.
    /// </summary>
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) Npgsql.NpgsqlConnection.ClearAllPools();
    }

    public HttpClient CreateUnauthedClient() =>
        CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("DATABASE_URL", PostgresFixture.NewDatabase());
        builder.UseSetting("Auth:ApiKey", ApiKey);
        builder.UseSetting("RateLimits:CreatePerMinute", "1000");
        builder.UseSetting("RateLimits:RedirectPerMinute", "1000");
        builder.UseSetting("RateLimits:StatsPerMinute", "1000");
        // Count every click, so tests can click a link repeatedly; ClickFloodTests turn this back on.
        builder.UseSetting("Clicks:DedupeSeconds", "0");
        // Tests change rows directly in the database, so redirects must read it every time; RedirectCacheTests turn it on.
        builder.UseSetting("Links:RedirectCacheSeconds", "0");
        foreach (var (key, value) in settings ?? []) builder.UseSetting(key, value);

        builder.ConfigureLogging(l => l.AddProvider(Logs));
        builder.ConfigureServices(services =>
        {
            services.AddHttpClient(SafeBrowsingClientName).ConfigurePrimaryHttpMessageHandler(() => SafeBrowsing);
            // An empty web root unless a test supplies one, so API tests don't depend on a built UI.
            // (UseWebRoot doesn't apply to minimal hosting here; set it on the environment directly.)
            var root = webRoot ?? Directory.CreateTempSubdirectory("ovi-webroot-").FullName;
            foreach (var env in services.Where(d => d.ServiceType == typeof(IWebHostEnvironment))
                         .Select(d => d.ImplementationInstance).OfType<IWebHostEnvironment>().Distinct())
            {
                env.WebRootPath = root;
                env.WebRootFileProvider = new PhysicalFileProvider(root);
            }

            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Time);
            if (remoteIp is not null) services.AddSingleton<IStartupFilter>(new RemoteIpStartupFilter(remoteIp));
            services.AddSingleton<IStartupFilter>(new TestLoginStartupFilter());
        });
    }

    /// <summary>Signs in the way the OAuth callback does (same account upsert, same cookie), minus the provider round trip.</summary>
    private sealed class TestLoginStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (ctx, nxt) =>
            {
                if (ctx.Request.Path != TestLoginPath) { await nxt(ctx); return; }
                var key = ctx.Request.Query["key"].ToString();
                var user = await UserSignIn.UpsertAsync(ctx.RequestServices.GetRequiredService<AppDbContext>(),
                    ctx.RequestServices.GetRequiredService<TimeProvider>(), "github", key, "User " + key, key + "@example.com",
                    emailVerified: ctx.Request.Query["verified"] != "False");
                if (user.BlockedAt is not null) { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return; }
                await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, UserSignIn.SessionPrincipal(user));
                ctx.Response.StatusCode = StatusCodes.Status204NoContent;
            });
            next(app);
        };
    }

    /// <summary>TestServer has no client IP; this simulates every request arriving from one address (e.g. a proxy).</summary>
    private sealed class RemoteIpStartupFilter(IPAddress ip) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((ctx, nxt) => { ctx.Connection.RemoteIpAddress = ip; return nxt(ctx); });
            next(app);
        };
    }
}
