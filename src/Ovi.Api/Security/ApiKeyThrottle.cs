using System.Collections.Concurrent;

namespace Ovi.Api.Security;

/// <summary>
/// Counts wrong <c>X-Api-Key</c> attempts per client so a key can't be guessed online. A correct key is never counted,
/// and the counter is per minute and in memory (it doesn't need to survive a restart to stop a brute-force attempt).
/// </summary>
public sealed class ApiKeyThrottle(TimeProvider time, IConfiguration config)
{
    private const int MaxTracked = 10_000;

    private readonly int _limit = Math.Max(1, config.GetValue("RateLimits:ApiKeyFailuresPerMinute", 10));
    private readonly ConcurrentDictionary<string, (long Minute, int Failures)> _failures = new();

    /// <summary>True once this client has used up its wrong-key budget for the current minute.</summary>
    public bool TooManyFailures(string client) =>
        _failures.TryGetValue(client, out var entry) && entry.Minute == Minute && entry.Failures >= _limit;

    public void RecordFailure(string client)
    {
        var minute = Minute;
        _failures.AddOrUpdate(client, _ => (minute, 1),
            (_, old) => old.Minute == minute ? (minute, old.Failures + 1) : (minute, 1));
        if (_failures.Count > MaxTracked) Prune(minute);
    }

    private long Minute => time.GetUtcNow().UtcDateTime.Ticks / TimeSpan.TicksPerMinute;

    private void Prune(long minute)
    {
        foreach (var (client, entry) in _failures)
            if (entry.Minute != minute) _failures.TryRemove(client, out _);
        // Still full of this minute's failures (a flood from many clients): start over rather than grow without bound.
        if (_failures.Count > MaxTracked) _failures.Clear();
    }
}
