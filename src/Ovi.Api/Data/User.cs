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

    /// <summary>True only when the provider confirmed the person owns <see cref="Email"/>. Admin rights need a verified email.</summary>
    public bool EmailVerified { get; set; }

    /// <summary>Set when an admin suspends the account: it can't sign in or use the API, and its links stop redirecting.</summary>
    public DateTime? BlockedAt { get; set; }

    /// <summary>
    /// The version of this account's sessions. The session cookie carries it and every request compares the two, so
    /// changing it (on logout) ends every session at once, including a cookie copied from the browser.
    /// </summary>
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime CreatedAt { get; set; }
    public DateTime LastLoginAt { get; set; }
}
