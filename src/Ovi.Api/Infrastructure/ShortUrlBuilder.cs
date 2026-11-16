namespace Ovi.Api.Infrastructure;

/// <summary>
/// Builds public short URLs. Uses App:PublicBaseUrl when set so that links and QR codes
/// can't be pointed at another host by a forged Host header.
/// </summary>
public class ShortUrlBuilder(IConfiguration config, IHttpContextAccessor http)
{
    public Uri? ConfiguredBaseUrl { get; } = ParseBaseUrl(config["App:PublicBaseUrl"]);

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

    /// <summary>True if the URL points back at this shortener, which would create a redirect loop.</summary>
    public bool IsSelf(Uri target) =>
        string.Equals(target.Authority, new Uri(BaseUrl).Authority, StringComparison.OrdinalIgnoreCase);

    public static Uri? ParseBaseUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            return uri;
        throw new InvalidOperationException($"App:PublicBaseUrl '{value}' must be an absolute http or https URL.");
    }
}
