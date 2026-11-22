using Microsoft.Extensions.Caching.Memory;
using Ovi.Api.Data;

namespace Ovi.Api.Links;

/// <summary>
/// Keeps recently followed links in memory, so a popular link (or a flood against one) doesn't query the database on
/// every redirect, and so links keep working for a while if the database is briefly unreachable.
/// </summary>
/// <remarks>
/// An entry is fresh for <c>Links:RedirectCacheSeconds</c> (default 15; 0 turns the cache off). Changing, deleting or
/// blocking a link, or suspending an account, clears it at once on this server. After the fresh period the database is
/// asked again; if that fails, the stale entry is served for up to <see cref="StaleFor"/>.
/// </remarks>
public sealed class RedirectCache(IConfiguration config, TimeProvider time) : IDisposable
{
    public static readonly TimeSpan StaleFor = TimeSpan.FromHours(1);
    private const int MaxEntries = 10_000;

    /// <param name="OwnerBlocked">The owner was suspended when this was cached.</param>
    public sealed record Entry(Link Link, bool OwnerBlocked, DateTime FetchedAt);

    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = MaxEntries });
    private readonly TimeSpan _fresh = TimeSpan.FromSeconds(Math.Max(0, config.GetValue("Links:RedirectCacheSeconds", 15)));

    public bool Enabled => _fresh > TimeSpan.Zero;

    public Entry? Get(string code) => Enabled && _cache.TryGetValue(code, out Entry? e) ? e : null;

    public bool IsFresh(Entry entry) => time.GetUtcNow().UtcDateTime - entry.FetchedAt < _fresh;

    public void Set(string code, Link link, bool ownerBlocked)
    {
        if (!Enabled) return;
        _cache.Set(code, new Entry(link, ownerBlocked, time.GetUtcNow().UtcDateTime),
            new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = StaleFor });
    }

    public void Remove(string code) => _cache.Remove(code);

    public void Clear() => _cache.Clear();

    public void Dispose() => _cache.Dispose();
}
