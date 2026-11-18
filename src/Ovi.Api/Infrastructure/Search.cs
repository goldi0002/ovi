namespace Ovi.Api.Infrastructure;

/// <summary>Free-text search over list endpoints.</summary>
public static class Search
{
    /// <summary>The longest search term the API looks at.</summary>
    public const int MaxLength = 100;

    /// <summary>
    /// A case-insensitive "contains" pattern for <c>ILIKE ... ESCAPE '\'</c>, with LIKE's wildcards escaped so a search
    /// for "50%" or "a_b" matches those characters literally, or null for no search. Terms longer than
    /// <see cref="MaxLength"/> are cut short.
    /// </summary>
    public static string? ContainsPattern(string? q)
    {
        var term = q?.Trim();
        if (string.IsNullOrEmpty(term)) return null;
        if (term.Length > MaxLength) term = term[..MaxLength];
        return "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
    }
}
