using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Data;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class StatsTests : IDisposable
{
    private const string ChromeDesktop =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    private const string SafariIphone =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

    private readonly OviApiFactory _factory = new();
    private readonly HttpClient _client;

    public StatsTests() => _client = _factory.CreateAuthedClient();

    public void Dispose() => _factory.Dispose();

    private async Task CreateAsync(string code)
    {
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", code));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode);
    }

    private async Task VisitAsync(string code, string? userAgent = null, string? referer = null)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "/" + code);
        if (userAgent is not null) req.Headers.TryAddWithoutValidation("User-Agent", userAgent);
        if (referer is not null) req.Headers.TryAddWithoutValidation("Referer", referer);
        Assert.AreEqual(HttpStatusCode.Redirect, (await _client.SendAsync(req)).StatusCode);
    }

    private Task<LinkStatsResponse?> StatsAsync(string code, int? days = null) =>
        _client.GetFromJsonAsync<LinkStatsResponse>($"/api/links/{code}/stats" + (days is null ? "" : $"?days={days}"));

    [TestMethod]
    public async Task Redirect_records_a_click_without_personal_data()
    {
        await CreateAsync("rec");
        await VisitAsync("rec", ChromeDesktop, "https://www.Example.org/some/page?q=secret");

        using var scope = _factory.Services.CreateScope();
        var click = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Clicks.SingleAsync();
        Assert.AreEqual(_factory.Time.GetUtcNow().UtcDateTime, click.At);
        Assert.AreEqual("example.org", click.Referrer); // host only: no path or query string
        Assert.AreEqual("Desktop", click.Device);
        Assert.AreEqual("Chrome", click.Browser);
    }

    [TestMethod]
    public async Task Stats_break_clicks_down_by_day_referrer_device_and_browser()
    {
        await CreateAsync("brk");
        await CreateAsync("other");

        // Day one: two clicks from Hacker News on desktop Chrome.
        await VisitAsync("brk", ChromeDesktop, "https://news.ycombinator.com/item?id=1");
        await VisitAsync("brk", ChromeDesktop, "https://news.ycombinator.com/");
        // Two days later (today): one direct visit from an iPhone, and a bot.
        _factory.Time.Advance(TimeSpan.FromDays(2));
        await VisitAsync("brk", SafariIphone);
        await VisitAsync("brk", "Googlebot/2.1 (+http://www.google.com/bot.html)");
        // Clicks on other links don't count.
        await VisitAsync("other", ChromeDesktop);

        var stats = (await StatsAsync("brk", days: 7))!;

        Assert.AreEqual("brk", stats.Code);
        Assert.AreEqual(4, stats.TotalClicks);
        Assert.AreEqual(7, stats.Days);
        Assert.AreEqual(4, stats.ClicksInRange);
        var today = DateOnly.FromDateTime(_factory.Time.GetUtcNow().UtcDateTime);
        CollectionAssert.AreEqual(
            Enumerable.Range(0, 7).Select(i => today.AddDays(i - 6)).ToList(),
            stats.Daily.Select(d => d.Date).ToList());
        CollectionAssert.AreEqual(new[] { 0, 0, 0, 0, 2, 0, 2 }, stats.Daily.Select(d => d.Clicks).ToArray());
        CollectionAssert.AreEqual(
            new[] { new NamedCount("news.ycombinator.com", 2), new NamedCount("Direct", 2) },
            stats.Referrers.ToArray());
        CollectionAssert.AreEqual(
            new[] { new NamedCount("Desktop", 2), new NamedCount("Bot", 1), new NamedCount("Mobile", 1) },
            stats.Devices.ToArray());
        CollectionAssert.AreEqual(
            new[] { new NamedCount("Chrome", 2), new NamedCount("Safari", 1) },
            stats.Browsers.ToArray());
    }

    [TestMethod]
    public async Task Stats_only_count_clicks_inside_the_range()
    {
        await CreateAsync("old");
        await VisitAsync("old", ChromeDesktop);
        _factory.Time.Advance(TimeSpan.FromDays(10));

        var stats = (await StatsAsync("old", days: 7))!;
        Assert.AreEqual(1, stats.TotalClicks);
        Assert.AreEqual(0, stats.ClicksInRange);
        Assert.IsEmpty(stats.Referrers);
        Assert.AreEqual(30, (await StatsAsync("old"))!.Days);
        Assert.AreEqual(1, (await StatsAsync("old", days: 30))!.ClicksInRange);
    }

    [TestMethod]
    [DataRow(0)]
    [DataRow(366)]
    public async Task Stats_reject_out_of_range_days(int days)
    {
        await CreateAsync("days");
        Assert.AreEqual(HttpStatusCode.BadRequest, (await _client.GetAsync($"/api/links/days/stats?days={days}")).StatusCode);
    }

    [TestMethod]
    public async Task Stats_need_the_api_key_and_a_live_link()
    {
        await CreateAsync("gone");
        Assert.AreEqual(HttpStatusCode.Unauthorized,
            (await _factory.CreateUnauthedClient().GetAsync("/api/links/gone/stats")).StatusCode);
        await _client.DeleteAsync("/api/links/gone");
        Assert.AreEqual(HttpStatusCode.NotFound, (await _client.GetAsync("/api/links/gone/stats")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await _client.GetAsync("/api/links/nope/stats")).StatusCode);
    }
}

[TestClass]
public sealed class ClientInfoTests
{
    [TestMethod]
    [DataRow("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Desktop", "Edge")]
    [DataRow("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Desktop", "Safari")]
    [DataRow("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Desktop", "Firefox")]
    [DataRow("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Mobile", "Chrome")]
    [DataRow("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Mobile", "Samsung Internet")]
    [DataRow("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1", "Tablet", "Chrome")]
    [DataRow("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Tablet", "Chrome")]
    [DataRow("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Bot", null)]
    [DataRow("curl/8.5.0", "Bot", null)]
    [DataRow("", "Other", null)]
    [DataRow(null, "Other", null)]
    public void Parses_user_agents(string? userAgent, string device, string? browser)
    {
        Assert.AreEqual((device, browser), ClientInfo.ParseUserAgent(userAgent));
    }

    [TestMethod]
    [DataRow("https://www.google.com/search?q=x", "google.com")]
    [DataRow("http://t.co/abc", "t.co")]
    [DataRow("https://Bücher.example/", "xn--bcher-kva.example")]
    [DataRow("android-app://com.slack/", null)]
    [DataRow("not a url", null)]
    [DataRow("", null)]
    [DataRow(null, null)]
    public void Parses_referrers(string? referer, string? expected)
    {
        Assert.AreEqual(expected, ClientInfo.ParseReferrer(referer));
    }
}
