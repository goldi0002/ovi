using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using Ovi.Api.Data;
using Ovi.Api.Security;

namespace Ovi.Api.Tests;

/// <summary>Runs the API against a private in-memory SQLite database with a controllable clock.</summary>
public class OviApiFactory(Dictionary<string, string?>? settings = null, IPAddress? remoteIp = null) : WebApplicationFactory<Program>
{
    public const string ApiKey = "test-key";

    private readonly SqliteConnection _connection = new("Data Source=:memory:");

    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero));

    /// <summary>A client that sends the API key and does not follow redirects.</summary>
    public HttpClient CreateAuthedClient()
    {
        var client = CreateUnauthedClient();
        client.DefaultRequestHeaders.Add(ApiKeyFilter.HeaderName, ApiKey);
        return client;
    }

    public HttpClient CreateUnauthedClient() =>
        CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        _connection.Open();
        builder.UseSetting("Auth:ApiKey", ApiKey);
        builder.UseSetting("RateLimits:CreatePerMinute", "1000");
        builder.UseSetting("RateLimits:RedirectPerMinute", "1000");
        foreach (var (key, value) in settings ?? []) builder.UseSetting(key, value);

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.AddDbContext<AppDbContext>(o => o.UseSqlite(_connection));
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Time);
            if (remoteIp is not null) services.AddSingleton<IStartupFilter>(new RemoteIpStartupFilter(remoteIp));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) _connection.Dispose();
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
