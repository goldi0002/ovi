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

    public bool IsExpired(DateTime utcNow) => ExpiresAt is { } e && e <= utcNow;
}
