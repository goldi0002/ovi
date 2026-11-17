namespace Ovi.Api.Links;

/// <summary>Limits on what a link may be.</summary>
public static class LinkRules
{
    public const int MaxUrlLength = 2048;

    /// <summary>Links made without signing in expire after this many days.</summary>
    public const int AnonymousLinkDays = 30;

    /// <summary>The furthest ahead an expiry date may be.</summary>
    public const int MaxExpiryYears = 10;

    /// <summary>
    /// Hosts that can't be shortened (configured as <c>Links:BlockedHosts</c>, comma-separated), e.g. to stop a spammer's
    /// domain. A blocked host also blocks its subdomains.
    /// </summary>
    public static bool IsBlockedHost(string host, IConfiguration config)
    {
        var normalized = NormalizeHost(host);
        return (config["Links:BlockedHosts"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeHost)
            .Any(b => b.Length > 0 && (normalized == b || normalized.EndsWith("." + b, StringComparison.Ordinal)));
    }

    /// <summary>True if the stored URL's host is blocked (also used at redirect time, so blocking applies to old links).</summary>
    public static bool IsBlockedUrl(string url, IConfiguration config) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && IsBlockedHost(uri.IdnHost, config);

    /// <summary>
    /// True when a URL contains control characters or bidi overrides. Browsers strip the control characters (so a stored
    /// URL can point somewhere other than it looks) and Kestrel refuses to send a header containing them.
    /// </summary>
    public static bool HasUnsafeCharacters(string url) => url.Any(c => char.IsControl(c) || IsBidiControl(c));

    private static bool IsBidiControl(char c) =>
        c is '\u061C' or '\u200E' or '\u200F' or >= '\u202A' and <= '\u202E' or >= '\u2066' and <= '\u2069';

    /// <summary>
    /// The form two names for the same site share: punycode, lowercase, without the trailing dot of a fully
    /// qualified name ("Evil.COM." and "evil.com" are the same site to a browser).
    /// </summary>
    public static string NormalizeHost(string host)
    {
        var trimmed = host.Trim().TrimEnd('.');
        if (trimmed.Length == 0) return "";
        try
        {
            return new System.Globalization.IdnMapping().GetAscii(trimmed).ToLowerInvariant();
        }
        catch (ArgumentException)
        {
            return trimmed.ToLowerInvariant();
        }
    }
}
