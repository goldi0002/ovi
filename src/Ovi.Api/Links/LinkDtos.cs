using Ovi.Api.Data;
using Ovi.Api.Infrastructure;

namespace Ovi.Api.Links;

/// <param name="Url">Absolute http or https URL to redirect to (max 2048 characters).</param>
/// <param name="CustomCode">Optional short code; one is generated if omitted.</param>
/// <param name="ExpiresAt">Optional time (with offset, e.g. 2030-01-01T00:00:00Z) after which the link stops redirecting.</param>
public record CreateLinkRequest(string Url, string? CustomCode = null, DateTimeOffset? ExpiresAt = null);

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
