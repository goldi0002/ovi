using System.Globalization;
using System.Threading.RateLimiting;

namespace Ovi.Api.Security;

/// <summary>
/// The budget for making and changing links, counted in links rather than requests, so a bulk request of N URLs costs N
/// permits from the same budget single create and edit use (see docs/decisions/0002-bulk-link-creation.md). Partitioned
/// on the resolved <see cref="Caller"/>, so it must run after <see cref="CallerFilter"/>: the API key per client address,
/// a signed-in account per account, and anonymous visitors per address on a much smaller hourly budget.
/// </summary>
public sealed class CreateBudget : IDisposable
{
    public const string TooManyTitle = "You've made too many links in the last minute; try again shortly.";

    private readonly PartitionedRateLimiter<HttpContext> _limiter;

    public CreateBudget(IConfiguration config)
    {
        PermitLimit = config.GetValue("RateLimits:CreatePerMinute", 30);
        AnonymousPermitLimit = config.GetValue("RateLimits:AnonymousCreatePerHour", 20);
        _limiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        {
            var ip = ClientKey.For(ctx.Connection.RemoteIpAddress);
            return Caller.From(ctx) switch
            {
                Caller.Admin { UserId: null } => Fixed("key:" + ip, PermitLimit, TimeSpan.FromMinutes(1)),
                { AccountId: { } id } => Fixed("user:" + id, PermitLimit, TimeSpan.FromMinutes(1)),
                _ => Fixed("anon:" + ip, AnonymousPermitLimit, TimeSpan.FromHours(1)),
            };
        });
    }

    /// <summary>Links a signed-in caller or the API key may make a minute.</summary>
    public int PermitLimit { get; }

    /// <summary>Links an anonymous visitor may make an hour, per address.</summary>
    public int AnonymousPermitLimit { get; }

    /// <summary>
    /// Takes <paramref name="permits"/> from the caller's budget, all or none. A request for more than the budget could
    /// ever hold is refused (with no retry time) rather than throwing.
    /// </summary>
    public bool TryAcquire(HttpContext ctx, int permits, out TimeSpan? retryAfter)
    {
        retryAfter = null;
        if (permits < 1) throw new ArgumentOutOfRangeException(nameof(permits));
        var limit = Caller.From(ctx).SignedIn ? PermitLimit : AnonymousPermitLimit;
        if (permits > limit) return false;

        using var lease = _limiter.AttemptAcquire(ctx, permits);
        if (lease.IsAcquired) return true;
        if (lease.TryGetMetadata(MetadataName.RetryAfter, out var after)) retryAfter = after;
        return false;
    }

    /// <summary>The 429 every create-budget refusal returns, with Retry-After in whole seconds when known.</summary>
    public static IResult TooMany(HttpContext ctx, TimeSpan? retryAfter)
    {
        if (retryAfter is { } after)
            ctx.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(after.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        return Results.Problem(statusCode: StatusCodes.Status429TooManyRequests, title: TooManyTitle);
    }

    public void Dispose() => _limiter.Dispose();

    private static RateLimitPartition<string> Fixed(string key, int permits, TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = window,
            QueueLimit = 0
        });
}

/// <summary>Takes one permit from the <see cref="CreateBudget"/> before the handler runs. Runs after <see cref="CallerFilter"/>.</summary>
public sealed class CreateBudgetFilter(CreateBudget budget) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next) =>
        budget.TryAcquire(context.HttpContext, 1, out var retryAfter)
            ? await next(context)
            : CreateBudget.TooMany(context.HttpContext, retryAfter);
}

public static class CreateBudgetExtensions
{
    /// <summary>Charges one link from the caller's create budget. Put it on endpoints in a group that has <see cref="CallerFilter"/>.</summary>
    public static RouteHandlerBuilder RequireCreateBudget(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter<CreateBudgetFilter>().Produces(StatusCodes.Status429TooManyRequests);
}
