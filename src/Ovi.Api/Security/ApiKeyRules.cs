namespace Ovi.Api.Security;

/// <summary>Rules for the admin API key in a real deployment.</summary>
public static class ApiKeyRules
{
    /// <summary>The key <c>appsettings.Development.json</c> uses; it is public, so it must never work in production.</summary>
    public const string DevelopmentKey = "dev-key-change-me";

    /// <summary>Long enough that the key can't be guessed by trying common values online.</summary>
    public const int MinLength = 32;

    /// <summary>
    /// Why this API key is unusable outside Development, or null when it is fine (or unset, which turns key access off).
    /// </summary>
    public static string? Problem(string? apiKey, bool isDevelopment)
    {
        if (string.IsNullOrEmpty(apiKey) || isDevelopment) return null;
        if (apiKey == DevelopmentKey)
            return $"Auth:ApiKey is the publicly known development key. Set a random key of at least {MinLength} characters.";
        return apiKey.Length < MinLength
            ? $"Auth:ApiKey must be at least {MinLength} characters, so it can't be guessed."
            : null;
    }
}
