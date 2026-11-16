using System.Text.RegularExpressions;

namespace Ovi.Api.Links;

/// <summary>Turns request headers into the coarse categories stored for each click.</summary>
public static partial class ClientInfo
{
    public const int MaxReferrerLength = 255;

    [GeneratedRegex(@"bot|crawl|spider|slurp|preview|facebookexternalhit|curl/|wget/|python|httpclient|okhttp|go-http|java/|headless",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BotPattern();

    public static (string Device, string? Browser) ParseUserAgent(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent)) return ("Other", null);
        if (BotPattern().IsMatch(userAgent)) return ("Bot", null);

        bool Has(string s) => userAgent.Contains(s, StringComparison.OrdinalIgnoreCase);

        var device =
            Has("iPad") || Has("Tablet") || (Has("Android") && !Has("Mobile")) ? "Tablet" :
            Has("Mobi") || Has("iPhone") || Has("Android") ? "Mobile" :
            Has("Windows") || Has("Macintosh") || Has("Linux") || Has("CrOS") ? "Desktop" :
            "Other";

        // Order matters: Edge, Opera and Samsung Internet also claim to be Chrome and Safari.
        string? browser =
            Has("Edg/") || Has("EdgA/") || Has("EdgiOS/") ? "Edge" :
            Has("OPR/") || Has("Opera") ? "Opera" :
            Has("SamsungBrowser/") ? "Samsung Internet" :
            Has("Firefox/") || Has("FxiOS/") ? "Firefox" :
            Has("Chrome/") || Has("CriOS/") ? "Chrome" :
            Has("Safari/") ? "Safari" :
            "Other";

        return (device, browser);
    }

    /// <summary>The referring site's host without "www.", or null when there is no usable http(s) referrer.</summary>
    public static string? ParseReferrer(string? referer)
    {
        if (string.IsNullOrWhiteSpace(referer) ||
            !Uri.TryCreate(referer, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            string.IsNullOrEmpty(uri.Host))
            return null;

        var host = uri.IdnHost.ToLowerInvariant();
        if (host.StartsWith("www.", StringComparison.Ordinal)) host = host[4..];
        return host.Length > MaxReferrerLength ? host[..MaxReferrerLength] : host;
    }
}
