namespace Ovi.Api.Data;

/// <summary>An account, created the first time someone signs in with Google or GitHub.</summary>
public class User
{
    public int Id { get; set; }

    /// <summary>"google" or "github".</summary>
    public required string Provider { get; set; }

    /// <summary>The provider's stable id for this person (Google's "sub", GitHub's numeric id).</summary>
    public required string ProviderKey { get; set; }

    public required string Name { get; set; }
    public string? Email { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastLoginAt { get; set; }
}
