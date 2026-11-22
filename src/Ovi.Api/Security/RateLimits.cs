using System.Threading.RateLimiting;
using Ovi.Api.Accounts;

namespace Ovi.Api.Security;

public static class RateLimits
{
    public const string Redirect = "redirect";
    public const string Auth = "auth";
    public const string Stats = "stats";
    public const string Report = "report";
    public const string Read = "read";
    public const string Health = "health";

    public static IServiceCollection AddOviRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var redirectLimit = config.GetValue("RateLimits:RedirectPerMinute", 300);
        var authLimit = config.GetValue("RateLimits:AuthPerMinute", 20);
        var statsLimit = config.GetValue("RateLimits:StatsPerMinute", 60);
        var readLimit = config.GetValue("RateLimits:ReadsPerMinute", 120);
        var healthLimit = config.GetValue("RateLimits:HealthPerMinute", 30);

        var reportLimit = config.GetValue("RateLimits:ReportPerHour", 10);

        services.AddSingleton<ApiKeyThrottle>();
        // Making and changing links is limited per link, not per request, by CreateBudget (an endpoint filter).
        services.AddSingleton<CreateBudget>();
        return services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(Redirect, ctx => PerMinute(Ip(ctx), redirectLimit));
            options.AddPolicy(Auth, ctx => PerMinute(Ip(ctx), authLimit));
            // Stats run aggregate queries, so each caller gets a modest budget.
            options.AddPolicy(Stats, ctx =>
                UserSignIn.UserId(ctx.User) is { } id ? PerMinute("user:" + id, statsLimit) : PerMinute("ip:" + Ip(ctx), statsLimit));
            // Listing and searching links and checking the session read the database on every call, so each account
            // (or, for the API key, each client address) gets a budget; the UI makes a handful of these a minute.
            options.AddPolicy(Read, ctx =>
                UserSignIn.UserId(ctx.User) is { } id ? PerMinute("read-user:" + id, readLimit) : PerMinute("read-ip:" + Ip(ctx), readLimit));
            // /health opens a database connection, so it is limited per client; a health check polls a few times a minute.
            options.AddPolicy(Health, ctx => PerMinute("health:" + Ip(ctx), healthLimit));
            // Reports need no sign-in, so they are limited per client, and hourly: a person reports a few links, not many.
            options.AddPolicy(Report, ctx => PerHour(Ip(ctx), reportLimit));
        });
    }

    private static string Ip(HttpContext ctx) => ClientKey.For(ctx.Connection.RemoteIpAddress);

    private static RateLimitPartition<string> PerHour(string key, int permits) =>
        RateLimitPartition.GetFixedWindowLimiter("report:" + key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = TimeSpan.FromHours(1),
            QueueLimit = 0
        });

    private static RateLimitPartition<string> PerMinute(string key, int permits) =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        });
}
