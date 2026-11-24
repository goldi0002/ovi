using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Ovi.Api.Links;

public static partial class CodeGenerator
{
    private const string Alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>Codes that would collide with real routes.</summary>
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "api", "auth", "swagger", "openapi", "health", "qr", "assets",
        // Pages of the web UI (see WebUiSetup.Pages).
        "links", "admin", "report", "privacy", "terms", "qr-code-generator", "self-host"
    };

    public static string Generate(int length = 7) => RandomNumberGenerator.GetString(Alphabet, length);

    public static bool IsValidCustomCode(string code) => IsValidCode(code) && !Reserved.Contains(code);

    /// <summary>Has the shape of a code (3 to 32 letters, digits, - or _), reserved or not.</summary>
    public static bool IsValidCode(string code) => ValidCode().IsMatch(code);

    [GeneratedRegex("^[A-Za-z0-9_-]{3,32}$")]
    private static partial Regex ValidCode();
}

/// <summary>Where new random codes come from (a service, so tests can replace it to force collisions).</summary>
public class CodeSource
{
    public virtual string Next() => CodeGenerator.Generate();
}
