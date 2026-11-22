using System.Collections.Concurrent;

namespace Ovi.Api.Links;

/// <summary>
/// Decides which redirects become click rows, so a flood of requests can't fill the database or skew the stats:
/// bots are skipped, a visitor hitting the same link again within a short window counts once, and only so many clicks
/// are recorded per minute overall. Skipped requests still redirect.
/// </summary>
public sealed class ClickRecorder(TimeProvider time, IConfiguration config)
{
    private const int MaxTracked = 100_000;

    private readonly TimeSpan _window = TimeSpan.FromSeconds(Math.Max(0, config.GetValue("Clicks:DedupeSeconds", 30)));
    private readonly int _maxPerMinute = config.GetValue("Clicks:MaxRecordedPerMinute", 1000);
    private readonly int _maxPerLinkPerMinute = config.GetValue("Clicks:MaxRecordedPerLinkPerMinute", 60);
    private readonly int _maxPerDay = config.GetValue("Clicks:MaxRecordedPerDay", 50_000);
    private readonly ConcurrentDictionary<(string Client, int LinkId), DateTime> _recent = new();
    private readonly ConcurrentDictionary<int, (long Minute, int Used)> _perLink = new();
    private readonly Lock _budgetLock = new();
    private long _budgetMinute;
    private int _budgetUsed;
    private long _budgetDay;
    private int _dayUsed;

    public bool ShouldRecord(string client, int linkId, string device)
    {
        if (device == ClientInfo.BotDevice) return false;

        var now = time.GetUtcNow().UtcDateTime;
        var key = (client, linkId);
        if (_recent.TryGetValue(key, out var last) && now - last < _window) return false;
        _recent[key] = now;
        if (_recent.Count > MaxTracked) Prune(now);

        lock (_budgetLock)
        {
            var minute = now.Ticks / TimeSpan.TicksPerMinute;
            if (minute != _budgetMinute)
            {
                _budgetMinute = minute;
                _budgetUsed = 0;
            }
            var day = now.Ticks / TimeSpan.TicksPerDay;
            if (day != _budgetDay)
            {
                _budgetDay = day;
                _dayUsed = 0;
            }
            if (_budgetUsed >= _maxPerMinute || (_maxPerDay > 0 && _dayUsed >= _maxPerDay)) return false;

            // One busy (or attacked) link can't use the whole site's budget.
            var linkMinute = _perLink.TryGetValue(linkId, out var seen) && seen.Minute == minute ? seen : (minute, 0);
            if (_maxPerLinkPerMinute > 0 && linkMinute.Item2 >= _maxPerLinkPerMinute) return false;
            _perLink[linkId] = (minute, linkMinute.Item2 + 1);
            if (_perLink.Count > MaxTracked) _perLink.Clear();

            _budgetUsed++;
            _dayUsed++;
            return true;
        }
    }

    private void Prune(DateTime now)
    {
        foreach (var (key, at) in _recent)
            if (now - at >= _window) _recent.TryRemove(key, out _);
        // Still full of fresh entries (a flood from many clients): start over rather than grow without bound.
        if (_recent.Count > MaxTracked) _recent.Clear();
    }
}
