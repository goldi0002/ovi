namespace Ovi.Api.Infrastructure;

/// <summary>
/// Builds public short URLs. Uses App:PublicBaseUrl (or, on Render, RENDER_EXTERNAL_URL) when set
/// so that links and QR codes can't be pointed at another host by a forged Host header.
/// </summary>
public class ShortUrlBuilder(IConfiguration config, IHttpContextAccessor http)
{
    public Uri? ConfiguredBaseUrl { get; } = ParseBaseUrl(ConfiguredValue(config));

    public string BaseUrl
    {
        get
        {
            if (ConfiguredBaseUrl is not null) return ConfiguredBaseUrl.GetLeftPart(UriPartial.Path).TrimEnd('/');
            var req = http.HttpContext?.Request ?? throw new InvalidOperationException("No active request.");
            return $"{req.Scheme}://{req.Host}";
        }
    }

    public string For(string code) => $"{BaseUrl}/{code}";

    /// <summary>
    /// True if the URL points back at this shortener, which would create a redirect loop. Every hostname the app answers
    /// on counts: a custom domain doesn't stop the platform's own hostname (or the request's) from reaching it.
    /// </summary>
    public bool IsSelf(Uri target) =>
        SelfHosts().Contains(Ovi.Api.Links.LinkRules.NormalizeHost(target.IdnHost));

    private IEnumerable<string> SelfHosts()
    {
        if (ConfiguredBaseUrl is not null)
            yield return Ovi.Api.Links.LinkRules.NormalizeHost(ConfiguredBaseUrl.IdnHost);

        if (TryParseBaseUrl(config["RENDER_EXTERNAL_URL"]) is { } render)
            yield return Ovi.Api.Links.LinkRules.NormalizeHost(render.IdnHost);

        if (http.HttpContext?.Request.Host.Host is { Length: > 0 } requestHost)
            yield return Ovi.Api.Links.LinkRules.NormalizeHost(requestHost);
    }

    /// <summary>App:PublicBaseUrl wins; RENDER_EXTERNAL_URL is set automatically by Render.</summary>
    public static string? ConfiguredValue(IConfiguration config) =>
        config["App:PublicBaseUrl"] is { Length: > 0 } explicitUrl ? explicitUrl : config["RENDER_EXTERNAL_URL"];

    public static Uri? ParseBaseUrl(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : TryParseBaseUrl(value) ?? throw new InvalidOperationException($"App:PublicBaseUrl '{value}' must be an absolute http or https URL.");

    private static Uri? TryParseBaseUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            ? uri
            : null;
}
