using Ovi.Api.Infrastructure;

namespace Ovi.Api.Links;

/// <summary>Limits on what a link may be.</summary>
public static class LinkRules
{
    public const int MaxUrlLength = 2048;

    /// <summary>Links made without signing in expire after this many days.</summary>
    public const int AnonymousLinkDays = 30;

    /// <summary>The URI with a Unicode host replaced by its punycode form; other URIs come back unchanged.</summary>
    public static Uri WithAsciiHost(Uri uri) =>
        uri.HostNameType == UriHostNameType.Dns && uri.IdnHost != uri.Host ? new UriBuilder(uri) { Host = uri.IdnHost }.Uri : uri;

    /// <summary>
    /// A stored URL as it can be sent in a Location header. Links stored before hosts were kept as punycode may have a
    /// Unicode host; this converts those, and leaves every other URL exactly as stored.
    /// </summary>
    public static string RedirectTarget(string url) =>
        url.Any(c => c > '\u007F') && Uri.TryCreate(url, UriKind.Absolute, out var uri) ? WithAsciiHost(uri).AbsoluteUri : url;

    /// <summary>The furthest ahead an expiry date may be.</summary>
    public const int MaxExpiryYears = 10;

    /// <summary>
    /// Checks a destination typed by a person (when a link is made or changed). Returns why it can't be used, or null
    /// with <paramref name="uri"/> set to the URL to store (as <see cref="Uri.AbsoluteUri"/>).
    /// </summary>
    public static string? UrlProblem(string? url, ShortUrlBuilder urls, IConfiguration config, out Uri? uri)
    {
        uri = null;
        var rawUrl = url?.Trim();
        if (string.IsNullOrEmpty(rawUrl))
            return "Enter a URL to shorten.";
        if (rawUrl.Length > MaxUrlLength)
            return $"The URL is too long; the limit is {MaxUrlLength} characters.";
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) ||
            string.IsNullOrEmpty(parsed.Host) || rawUrl.Any(char.IsWhiteSpace))
            return "Enter a full web address starting with http:// or https://.";
        if (HasUnsafeCharacters(rawUrl))
            return "The URL contains characters that can't be shortened.";
        // AbsoluteUri percent-encodes the path but keeps a Unicode host as typed, and Kestrel refuses to send a non-ASCII
        // Location header. Store the punycode host, so the stored form is all ASCII.
        parsed = WithAsciiHost(parsed);
        // Percent-encoding and punycode can make the stored form longer than what was typed.
        if (parsed.AbsoluteUri.Length > MaxUrlLength)
            return $"The URL is too long once encoded; the limit is {MaxUrlLength} characters.";
        // https://bank.com@evil.com looks like bank.com but goes to evil.com: a common phishing trick.
        if (!string.IsNullOrEmpty(parsed.UserInfo))
            return "URLs with a user name or password in them can't be shortened.";
        if (urls.IsSelf(parsed))
            return "That URL is already an Ovi link.";
        if (IsBlockedHost(parsed.IdnHost, config))
            return "Links to this site can't be created.";
        uri = parsed;
        return null;
    }

    /// <summary>The furthest ahead a link's expiry may be set, from <paramref name="utcNow"/>.</summary>
    public static DateTime LatestExpiry(DateTime utcNow, bool anonymous) =>
        anonymous ? utcNow.AddDays(AnonymousLinkDays) : utcNow.AddYears(MaxExpiryYears);

    /// <summary>
    /// Checks a requested expiry (UTC, or null for none) for a link that is or will be <paramref name="anonymous"/>.
    /// Returns why it can't be used, or null. Anonymous links must always expire.
    /// </summary>
    public static string? ExpiryProblem(DateTime? expiresAt, DateTime utcNow, bool anonymous)
    {
        if (expiresAt is not { } e)
            return null;
        if (e <= utcNow)
            return "The expiry date must be in the future.";
        if (e > LatestExpiry(utcNow, anonymous))
            return anonymous
                ? $"Links made without signing in last at most {AnonymousLinkDays} days."
                : $"The expiry date can be at most {MaxExpiryYears} years away.";
        return null;
    }

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
