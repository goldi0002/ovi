namespace Ovi.Api.Data;

/// <summary>One visit to a short link. No IP address or full user agent is stored, only coarse categories.</summary>
public class Click
{
    public long Id { get; set; }
    public int LinkId { get; set; }
    public DateTime At { get; set; }

    /// <summary>Host of the referring page (e.g. "news.ycombinator.com"), or null for direct visits.</summary>
    public string? Referrer { get; set; }

    /// <summary>Desktop, Mobile, Tablet, Bot or Other.</summary>
    public required string Device { get; set; }

    /// <summary>Chrome, Safari, Firefox, Edge and so on; null for bots and unknown clients.</summary>
    public string? Browser { get; set; }
}
