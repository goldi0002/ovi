using System.Threading.RateLimiting;
using Ovi.Api.Accounts;

namespace Ovi.Api.Security;

public static class RateLimits
{
    public const string Create = "create";
    public const string Redirect = "redirect";
    public const string Auth = "auth";
    public const string Stats = "stats";

    public static IServiceCollection AddOviRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var createLimit = config.GetValue("RateLimits:CreatePerMinute", 30);
        var anonymousCreateLimit = config.GetValue("RateLimits:AnonymousCreatePerHour", 20);
        var redirectLimit = config.GetValue("RateLimits:RedirectPerMinute", 300);
        var authLimit = config.GetValue("RateLimits:AuthPerMinute", 20);
        var statsLimit = config.GetValue("RateLimits:StatsPerMinute", 60);

        services.AddSingleton<ApiKeyThrottle>();
        return services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            // Signed-in users get their own budget; anonymous visitors share a much smaller one per IP address.
            options.AddPolicy(Create, ctx =>
                ctx.Request.Headers.ContainsKey(CallerFilter.ApiKeyHeader) ? PerMinute("key:" + Ip(ctx), createLimit)
                : UserSignIn.UserId(ctx.User) is { } id ? PerMinute("user:" + id, createLimit)
                : Fixed("anon:" + Ip(ctx), anonymousCreateLimit, TimeSpan.FromHours(1)));
            options.AddPolicy(Redirect, ctx => PerMinute(Ip(ctx), redirectLimit));
            options.AddPolicy(Auth, ctx => PerMinute(Ip(ctx), authLimit));
            // Stats run aggregate queries, so each caller gets a modest budget.
            options.AddPolicy(Stats, ctx =>
                UserSignIn.UserId(ctx.User) is { } id ? PerMinute("user:" + id, statsLimit) : PerMinute("ip:" + Ip(ctx), statsLimit));
        });
    }

    private static string Ip(HttpContext ctx) => ClientKey.For(ctx.Connection.RemoteIpAddress);

    private static RateLimitPartition<string> PerMinute(string key, int permits) => Fixed(key, permits, TimeSpan.FromMinutes(1));

    private static RateLimitPartition<string> Fixed(string key, int permits, TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = window,
            QueueLimit = 0
        });
}
