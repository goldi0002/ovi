using Ovi.Api.Data;

namespace Ovi.Api.Links;

/// <param name="Url">Absolute http or https URL to redirect to.</param>
/// <param name="CustomCode">Optional short code; one is generated if omitted.</param>
/// <param name="ExpiresAt">Optional UTC time after which the link stops redirecting.</param>
public record CreateLinkRequest(string Url, string? CustomCode = null, DateTime? ExpiresAt = null);

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
    public static LinkResponse From(Link link, string baseUrl) =>
        new(link.Code, $"{baseUrl}/{link.Code}", $"{baseUrl}/{link.Code}/qr", link.Url, link.Clicks,
            link.CreatedAt, link.LastClickedAt, link.ExpiresAt);
}
