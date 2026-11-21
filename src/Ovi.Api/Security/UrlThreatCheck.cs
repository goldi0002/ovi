using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Ovi.Api.Security;

/// <summary>Asks a reputation service whether destination URLs are known phishing or malware.</summary>
public interface IUrlThreatCheck
{
    /// <summary>
    /// The URLs (as passed in) that are flagged as unsafe. Fails open: if the service is off, down or answers badly, no
    /// URL is flagged, so Ovi keeps working when the service doesn't.
    /// </summary>
    Task<IReadOnlySet<string>> FindUnsafeAsync(IReadOnlyCollection<string> urls, CancellationToken ct = default);
}

/// <summary>
/// Google Safe Browsing Lookup API v4 (threatMatches:find). Off unless SafeBrowsing:ApiKey is set. The key travels in the
/// query string, so it is never logged: the client's built-in logging is removed, and our own warnings carry only the
/// exception type or status code.
/// </summary>
public sealed class SafeBrowsingUrlThreatCheck(
    IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<SafeBrowsingUrlThreatCheck> logger) : IUrlThreatCheck
{
    public const string HttpClientName = "safe-browsing";
    public const string FlaggedMessage = "This site is flagged as unsafe by Google Safe Browsing, so it can't be shortened.";
    public const int DefaultTimeoutSeconds = 3;
    private const string Endpoint = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

    private static readonly string ClientVersion =
        typeof(SafeBrowsingUrlThreatCheck).Assembly.GetName().Version?.ToString(3) ?? "1.0";

    public async Task<IReadOnlySet<string>> FindUnsafeAsync(IReadOnlyCollection<string> urls, CancellationToken ct = default)
    {
        var none = new HashSet<string>(StringComparer.Ordinal);
        var key = config["SafeBrowsing:ApiKey"];
        if (string.IsNullOrWhiteSpace(key) || urls.Count == 0) return none;

        var seconds = config.GetValue("SafeBrowsing:TimeoutSeconds", DefaultTimeoutSeconds);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(seconds > 0 ? seconds : DefaultTimeoutSeconds));

        try
        {
            var body = new Request(new("ovi", ClientVersion), new(
                ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
                ["ANY_PLATFORM"], ["URL"], urls.Distinct(StringComparer.Ordinal).Select(u => new Entry(u)).ToList()));
            using var client = httpClientFactory.CreateClient(HttpClientName);
            using var response = await client.PostAsJsonAsync($"{Endpoint}?key={Uri.EscapeDataString(key.Trim())}", body, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Safe Browsing check skipped: the service answered {Status}.", (int)response.StatusCode);
                return none;
            }

            var result = await response.Content.ReadFromJsonAsync<Response>(timeout.Token);
            var matches = result?.Matches?.Select(m => m.Threat?.Url).OfType<string>().ToList() ?? [];
            if (matches.Count == 0) return none;
            return Attribute(urls, matches);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException
                                       or System.Text.Json.JsonException or NotSupportedException)
        {
            if (ct.IsCancellationRequested) throw;
            // Only the type: a message could carry request details, and the request URL holds the key.
            logger.LogWarning("Safe Browsing check skipped: {Failure}.", ex.GetType().Name);
            return none;
        }
    }

    /// <summary>
    /// Maps reported URLs back to the URLs sent. Google canonicalises what it reports (host case, fragment, trailing
    /// slash, or a host/path prefix), so compare on host + path with the scheme, query and fragment ignored, and treat a
    /// reported host/path as covering anything below it. A match that can't be placed on any sent URL still means Google
    /// found something bad, so fail closed: flag the URLs on the reported host, else every URL sent.
    /// </summary>
    internal static HashSet<string> Attribute(IReadOnlyCollection<string> sent, IReadOnlyList<string> reported)
    {
        var flagged = new HashSet<string>(StringComparer.Ordinal);
        if (sent.Count == 1) { flagged.UnionWith(sent); return flagged; }
        var keys = sent.Select(u => (Url: u, Key: Key(u))).ToList();
        foreach (var r in reported)
        {
            var rk = Key(r);
            var hits = keys.Where(k => k.Key == rk || k.Key.StartsWith(rk + "/", StringComparison.Ordinal)).ToList();
            if (hits.Count == 0)
            {
                var host = rk.Split('/')[0];
                hits = keys.Where(k => k.Key.Split('/')[0] == host).ToList();
            }
            if (hits.Count == 0) { flagged.UnionWith(sent); return flagged; }
            flagged.UnionWith(hits.Select(h => h.Url));
        }
        return flagged;
    }

    private static string Key(string url)
    {
        var s = url.Trim();
        var scheme = s.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0) s = s[(scheme + 3)..];
        var cut = s.IndexOfAny(['?', '#']);
        if (cut >= 0) s = s[..cut];
        return s.TrimEnd('/').ToLowerInvariant();
    }

    private sealed record Request(
        [property: JsonPropertyName("client")] ClientInfo Client,
        [property: JsonPropertyName("threatInfo")] ThreatInfo ThreatInfo);
    private sealed record ClientInfo(
        [property: JsonPropertyName("clientId")] string ClientId,
        [property: JsonPropertyName("clientVersion")] string ClientVersion);
    private sealed record ThreatInfo(
        [property: JsonPropertyName("threatTypes")] string[] ThreatTypes,
        [property: JsonPropertyName("platformTypes")] string[] PlatformTypes,
        [property: JsonPropertyName("threatEntryTypes")] string[] ThreatEntryTypes,
        [property: JsonPropertyName("threatEntries")] List<Entry> ThreatEntries);
    private sealed record Entry([property: JsonPropertyName("url")] string Url);
    private sealed record Response([property: JsonPropertyName("matches")] List<Match>? Matches);
    private sealed record Match([property: JsonPropertyName("threat")] Entry? Threat);
}
