using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;

namespace Ovi.Api.Links;

/// <summary>
/// Deletes click rows older than <c>Clicks:RetentionDays</c> (default 400, never less than the longest stats range)
/// a few times a day, so the Clicks table stops growing forever. Each link's all-time count lives on the link itself
/// and isn't affected. Set the value to 0 to keep clicks forever.
/// </summary>
public sealed class ClickRetentionService(IServiceScopeFactory scopes, TimeProvider time, IConfiguration config, ILogger<ClickRetentionService> log)
    : BackgroundService
{
    public const int DefaultRetentionDays = 400;

    public static int RetentionDays(IConfiguration config) =>
        config.GetValue("Clicks:RetentionDays", DefaultRetentionDays) is var days && days <= 0
            ? 0
            : Math.Max(days, LinkEndpoints.MaxStatsDays + 1);

    /// <summary>Deletes clicks from before the retention window; returns how many.</summary>
    public static Task<int> PruneAsync(AppDbContext db, DateTime utcNow, int retentionDays, CancellationToken ct = default)
    {
        var cutoff = utcNow.AddDays(-retentionDays);
        return db.Clicks.Where(c => c.At < cutoff).ExecuteDeleteAsync(ct);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var days = RetentionDays(config);
        if (days == 0) return;

        using var timer = new PeriodicTimer(TimeSpan.FromHours(6), time);
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var deleted = await PruneAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(),
                    time.GetUtcNow().UtcDateTime, days, stoppingToken);
                if (deleted > 0) log.LogInformation("Deleted {Count} clicks older than {Days} days", deleted, days);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Couldn't delete old clicks; will try again later");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
