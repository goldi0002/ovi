namespace Ovi.Api.Data;

/// <summary>A visitor's report that a short link is abusive. Nothing about the reporter is stored: no IP, user agent or user id.</summary>
public class LinkReport
{
    public long Id { get; set; }
    public int LinkId { get; set; }

    /// <summary>phishing, malware, spam or other.</summary>
    public required string Reason { get; set; }

    public string? Details { get; set; }
    public DateTime CreatedAt { get; set; }

    /// <summary>Null while the report is open.</summary>
    public DateTime? ResolvedAt { get; set; }

    /// <summary>dismissed or actioned; null while open.</summary>
    public string? Resolution { get; set; }

    public const int MaxReasonLength = 16;
    public const int MaxDetailsLength = 500;
}
