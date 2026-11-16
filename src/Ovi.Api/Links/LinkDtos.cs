using Ovi.Api.Data;

namespace Ovi.Api.Links;

public record CreateLinkRequest(string Url, string? CustomCode);

public record LinkResponse(string Code, string ShortUrl, string Url, int Clicks, DateTime CreatedAt, DateTime? LastClickedAt)
{
    public static LinkResponse From(Link link, string baseUrl) =>
        new(link.Code, $"{baseUrl}/{link.Code}", link.Url, link.Clicks, link.CreatedAt, link.LastClickedAt);
}
