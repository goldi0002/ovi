using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Ovi.Api.Links;

public static partial class CodeGenerator
{
    private const string Alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>Codes that would collide with real routes.</summary>
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "api", "swagger", "openapi", "health", "qr"
    };

    public static string Generate(int length = 7) => RandomNumberGenerator.GetString(Alphabet, length);

    public static bool IsValidCustomCode(string code) => ValidCode().IsMatch(code) && !Reserved.Contains(code);

    [GeneratedRegex("^[A-Za-z0-9_-]{3,32}$")]
    private static partial Regex ValidCode();
}
