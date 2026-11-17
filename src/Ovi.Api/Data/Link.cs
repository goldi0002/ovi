namespace Ovi.Api.Data;

public class Link
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public required string Url { get; set; }
    public int Clicks { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastClickedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Set when the link is deleted. Deleted links are kept (soft delete) but hidden by a query filter.</summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>The account that made the link; null for links made with the admin API key or anonymously.</summary>
    public int? OwnerId { get; set; }

    /// <summary>Made without signing in. Such links always expire and only the admin can list them.</summary>
    public bool Anonymous { get; set; }

    public bool IsExpired(DateTime utcNow) => ExpiresAt is { } e && e <= utcNow;
}
