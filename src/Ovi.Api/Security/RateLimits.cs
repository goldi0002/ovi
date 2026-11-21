using System.Threading.RateLimiting;
using Ovi.Api.Accounts;

namespace Ovi.Api.Security;

public static class RateLimits
{
    public const string Redirect = "redirect";
    public const string Auth = "auth";
    public const string Stats = "stats";
    public const string Report = "report";

    public static IServiceCollection AddOviRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var redirectLimit = config.GetValue("RateLimits:RedirectPerMinute", 300);
        var authLimit = config.GetValue("RateLimits:AuthPerMinute", 20);
        var statsLimit = config.GetValue("RateLimits:StatsPerMinute", 60);

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
