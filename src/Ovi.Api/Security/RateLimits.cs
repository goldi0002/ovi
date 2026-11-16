using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Ovi.Api.Security;

public static class RateLimits
{
    public const string Create = "create";
    public const string Redirect = "redirect";

    public static IServiceCollection AddOviRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var createLimit = config.GetValue("RateLimits:CreatePerMinute", 30);
        var redirectLimit = config.GetValue("RateLimits:RedirectPerMinute", 300);

        return services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(Create, ctx => PerClient(ctx, createLimit));
            options.AddPolicy(Redirect, ctx => PerClient(ctx, redirectLimit));
        });
    }

    private static RateLimitPartition<string> PerClient(HttpContext ctx, int permitsPerMinute) =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitsPerMinute,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            });
}
