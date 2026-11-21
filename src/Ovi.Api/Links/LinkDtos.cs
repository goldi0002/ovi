using Ovi.Api.Data;
using Ovi.Api.Infrastructure;

namespace Ovi.Api.Links;

/// <param name="Url">Absolute http or https URL to redirect to (max 2048 characters).</param>
/// <param name="CustomCode">Optional short code; one is generated if omitted.</param>
/// <param name="ExpiresAt">Optional time (with offset, e.g. 2030-01-01T00:00:00Z) after which the link stops redirecting.</param>
public record CreateLinkRequest(string Url, string? CustomCode = null, DateTimeOffset? ExpiresAt = null);

/// <summary>Shortens many URLs at once, all or nothing. Each gets a random code.</summary>
/// <param name="Urls">1 to 25 absolute http or https URLs, each checked like a new link's. Repeats each get their own link.</param>
/// <param name="ExpiresAt">Optional time (with offset) set on every link; without it the links never expire.</param>
public record BulkCreateLinksRequest(List<string?>? Urls, DateTimeOffset? ExpiresAt = null);

/// <param name="Items">The new links, in the same order as the request's URLs.</param>
public record BulkCreateLinksResponse(IReadOnlyList<LinkResponse> Items);

/// <summary>
/// Changes to a link; leave a field out (or null) to keep it as it is. The code, clicks and stats never change.
/// </summary>
/// <param name="Url">New absolute http or https URL to redirect to, checked like a new link's.</param>
/// <param name="ExpiresAt">New expiry time (with offset). Must be in the future.</param>
/// <param name="ClearExpiry">True to remove the expiry so the link never expires; can't be combined with ExpiresAt.</param>
public record UpdateLinkRequest(string? Url = null, DateTimeOffset? ExpiresAt = null, bool ClearExpiry = false);

public record LinkResponse(
    string Code,
    string ShortUrl,
    string QrCodeUrl,
    string Url,
    int Clicks,
    DateTime CreatedAt,
    DateTime? LastClickedAt,
    DateTime? ExpiresAt)
{
    public static LinkResponse From(Link link, ShortUrlBuilder urls)
    {
        var shortUrl = urls.For(link.Code);
        return new(link.Code, shortUrl, $"{shortUrl}/qr", link.Url, link.Clicks, link.CreatedAt, link.LastClickedAt, link.ExpiresAt);
    }
}

public record PagedResponse<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total);

public record DailyClicks(DateOnly Date, int Clicks);

public record NamedCount(string Name, int Clicks);

/// <param name="TotalClicks">Every click since the link was created, including ones before detailed stats were recorded.</param>
/// <param name="Days">Length of the range, ending today (UTC).</param>
/// <param name="ClicksInRange">Clicks recorded within the range.</param>
/// <param name="Daily">One entry per day in the range, oldest first, including days with no clicks.</param>
/// <param name="Referrers">Top referring sites in the range; "Direct" means no referrer.</param>
public record LinkStatsResponse(
    string Code,
    int TotalClicks,
    int Days,
    int ClicksInRange,
    IReadOnlyList<DailyClicks> Daily,
    IReadOnlyList<NamedCount> Referrers,
    IReadOnlyList<NamedCount> Devices,
    IReadOnlyList<NamedCount> Browsers);
