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
