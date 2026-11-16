namespace Ovi.Api.Data;

public class Link
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public required string Url { get; set; }
    public int Clicks { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastClickedAt { get; set; }
}
