namespace Ovi.Api.Infrastructure;

/// <summary>
/// Pings the app's own public URL on a timer so hosts that sleep idle services (Render's free plan
/// sleeps after 15 minutes without traffic) keep it awake. The request has to go to the public URL,
/// through the platform's proxy: requests to localhost don't count as traffic.
/// Off unless KeepAlive:Enabled is true.
/// </summary>
public sealed class KeepAliveService(
    IHttpClientFactory httpClientFactory,
    IConfiguration config,
    TimeProvider time,
    ILogger<KeepAliveService> logger) : BackgroundService
{
    public const string HttpClientName = "keep-alive";
    public static readonly TimeSpan DefaultInterval = TimeSpan.FromMinutes(10);

    /// <summary>KeepAlive:Url, else the public base URL (App:PublicBaseUrl or RENDER_EXTERNAL_URL) + /health/live.</summary>
    public static Uri? ResolveUrl(IConfiguration config)
    {
        if (config["KeepAlive:Url"] is { Length: > 0 } url) return new Uri(url, UriKind.Absolute);
        var baseUrl = ShortUrlBuilder.ParseBaseUrl(ShortUrlBuilder.ConfiguredValue(config));
        return baseUrl is null ? null : new Uri(baseUrl.GetLeftPart(UriPartial.Path).TrimEnd('/') + "/health/live");
    }

    public static TimeSpan ResolveInterval(IConfiguration config) =>
        config.GetValue<double?>("KeepAlive:IntervalMinutes") is { } minutes and > 0
            ? TimeSpan.FromMinutes(minutes)
            : DefaultInterval;

    private readonly Uri? _url = ResolveUrl(config);
    private readonly PeriodicTimer _timer = new(ResolveInterval(config), time);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_url is null)
        {
            logger.LogWarning("KeepAlive is enabled but no URL is known; set KeepAlive:Url or App:PublicBaseUrl.");
            return;
        }

        logger.LogInformation("KeepAlive: pinging {Url} every {Interval}.", _url, _timer.Period);
        var client = httpClientFactory.CreateClient(HttpClientName);
        try
        {
            while (await _timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    using var response = await client.GetAsync(_url, stoppingToken);
                    if (response.IsSuccessStatusCode)
                        logger.LogDebug("KeepAlive: {Url} returned {Status}.", _url, (int)response.StatusCode);
                    else
                        logger.LogWarning("KeepAlive: {Url} returned {Status}.", _url, (int)response.StatusCode);
                }
                catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning(ex, "KeepAlive: request to {Url} failed.", _url);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down.
        }
    }

    public override void Dispose()
    {
        _timer.Dispose();
        base.Dispose();
    }
}
