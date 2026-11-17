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
    public static bool IsBlockedHost(string host, IConfiguration config) =>
        (config["Links:BlockedHosts"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(b => host.Equals(b, StringComparison.OrdinalIgnoreCase) ||
                      host.EndsWith("." + b, StringComparison.OrdinalIgnoreCase));
}
