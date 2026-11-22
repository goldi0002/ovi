using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Data;
using Ovi.Api.Links;
using Ovi.Api.Security;

namespace Ovi.Api.Tests;

/// <summary>Click flooding (#12) and blocked hosts (#13). Open redirects after sign-in (#14) are in AccountTests.</summary>
[TestClass]
public sealed class SecurityFixTests
{
    private static async Task<LinkResponse> CreateAsync(OviApiFactory factory, string url, string? code = null)
    {
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest(url, code));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
    }

    private static async Task<(int Clicks, int Rows)> CountsAsync(OviApiFactory factory, string code)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var link = await db.Links.SingleAsync(l => l.Code == code);
        return (link.Clicks, await db.Clicks.CountAsync(c => c.LinkId == link.Id));
    }

    private static Task<HttpResponseMessage> VisitAsync(OviApiFactory factory, string code, string? userAgent = null)
    {
        var client = factory.CreateUnauthedClient();
        if (userAgent is not null) client.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent);
        return client.GetAsync("/" + code);
    }

    // ---- #12 Click flooding ----

    [TestMethod]
    public async Task Bots_are_redirected_but_not_counted()
    {
        using var factory = new OviApiFactory();
        await CreateAsync(factory, "https://example.com", "botty");

        var res = await VisitAsync(factory, "botty", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
        Assert.AreEqual(HttpStatusCode.Redirect, res.StatusCode);
        Assert.AreEqual((0, 0), await CountsAsync(factory, "botty"));
    }

    [TestMethod]
    public async Task Repeat_visits_from_one_client_within_the_window_count_once()
    {
        using var factory = new OviApiFactory(new() { ["Clicks:DedupeSeconds"] = "30" });
        await CreateAsync(factory, "https://example.com", "again");

        for (var i = 0; i < 5; i++)
            Assert.AreEqual(HttpStatusCode.Redirect, (await VisitAsync(factory, "again")).StatusCode);
        Assert.AreEqual((1, 1), await CountsAsync(factory, "again"));

        factory.Time.Advance(TimeSpan.FromSeconds(31));
        await VisitAsync(factory, "again");
        Assert.AreEqual((2, 2), await CountsAsync(factory, "again"));
    }

    [TestMethod]
    public async Task Only_so_many_clicks_are_recorded_per_minute_overall()
    {
        using var factory = new OviApiFactory(new() { ["Clicks:MaxRecordedPerMinute"] = "3" });
        await CreateAsync(factory, "https://example.com", "busy");

        for (var i = 0; i < 6; i++)
            Assert.AreEqual(HttpStatusCode.Redirect, (await VisitAsync(factory, "busy")).StatusCode);
        Assert.AreEqual((3, 3), await CountsAsync(factory, "busy"));

        factory.Time.Advance(TimeSpan.FromMinutes(1));
        await VisitAsync(factory, "busy");
        Assert.AreEqual((4, 4), await CountsAsync(factory, "busy"));
    }

    [TestMethod]
    public async Task Old_clicks_are_deleted_and_recent_ones_kept()
    {
        using var factory = new OviApiFactory();
        var link = await CreateAsync(factory, "https://example.com", "old");
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var id = (await db.Links.SingleAsync(l => l.Code == link.Code)).Id;
        var now = factory.Time.GetUtcNow().UtcDateTime;
        db.Clicks.AddRange(
            new Click { LinkId = id, At = now.AddDays(-401), Device = "Desktop" },
            new Click { LinkId = id, At = now.AddDays(-399), Device = "Desktop" });
        await db.SaveChangesAsync();

        Assert.AreEqual(1, await ClickRetentionService.PruneAsync(db, now, 400));
        Assert.AreEqual(1, await db.Clicks.CountAsync(c => c.LinkId == id));
    }

    [TestMethod]
    public void Retention_never_drops_below_the_longest_stats_range()
    {
        static int Days(string? value) => ClickRetentionService.RetentionDays(
            new Microsoft.Extensions.Configuration.ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["Clicks:RetentionDays"] = value }).Build());
        Assert.AreEqual(400, Days(null));
        Assert.AreEqual(LinkEndpoints.MaxStatsDays + 1, Days("30"));
        Assert.AreEqual(0, Days("0"));
        Assert.AreEqual(1000, Days("1000"));
    }

    [TestMethod]
    public async Task Stats_have_their_own_rate_limit()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:StatsPerMinute"] = "2" });
        await CreateAsync(factory, "https://example.com", "stat");
        var client = factory.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/links/stat/stats")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/links/stat/stats")).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/links/stat/stats")).StatusCode);
    }

    [TestMethod]
    public async Task Listing_and_reading_links_and_the_session_share_a_read_limit()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:ReadsPerMinute"] = "3" });
        await CreateAsync(factory, "https://example.com", "readme");
        var client = factory.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/links")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/links/readme")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/session")).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/links?q=x")).StatusCode);
    }

    [TestMethod]
    public async Task The_database_health_check_is_rate_limited_but_liveness_is_not()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:HealthPerMinute"] = "2" });
        var client = factory.CreateUnauthedClient();
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await client.GetAsync("/health")).StatusCode);
        for (var i = 0; i < 5; i++)
            Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
    }

    [TestMethod]
    [DataRow("203.0.113.9", "203.0.113.9")]
    [DataRow("::ffff:203.0.113.9", "203.0.113.9")]
    [DataRow("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64")]
    [DataRow("2001:db8:1:2::1", "2001:db8:1:2::/64")]
    public void Ipv6_clients_are_grouped_by_their_64(string ip, string expected) =>
        Assert.AreEqual(expected, ClientKey.For(IPAddress.Parse(ip)));

    [TestMethod]
    public async Task Ipv6_address_rotation_shares_one_rate_limit()
    {
        using var a = new OviApiFactory(new() { ["RateLimits:AnonymousCreatePerHour"] = "1" }, IPAddress.Parse("2001:db8:1:2::1"));
        var first = await a.CreateUnauthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/1"));
        Assert.AreEqual(HttpStatusCode.Created, first.StatusCode);
        // Same factory = same limiter; a different address in the same /64 must hit the same bucket.
        Assert.AreEqual("2001:db8:1:2::/64", ClientKey.For(IPAddress.Parse("2001:db8:1:2:ffff::9")));
        var second = await a.CreateUnauthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/2"));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, second.StatusCode);
    }

    // ---- #13 Blocked hosts ----

    [TestMethod]
    [DataRow("https://phish.example./login")]
    [DataRow("https://PHISH.Example/login")]
    [DataRow("https://www.phish.example../")]
    [DataRow("https://bücher.example/")]
    [DataRow("https://xn--bcher-kva.example/")]
    public async Task Blocked_hosts_cannot_be_dodged_with_dots_case_or_punycode(string url)
    {
        using var factory = new OviApiFactory(new() { ["Links:BlockedHosts"] = "phish.example, Bücher.example" });
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest(url));
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, url);
    }

    [TestMethod]
    public async Task Blocking_a_host_disables_links_made_before_it_was_blocked()
    {
        string db;
        // Create the link while the host is allowed...
        using (var before = new OviApiFactory())
        {
            await CreateAsync(before, "https://later-bad.example/x", "early");
            db = before.Services.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>()["DATABASE_URL"]!;
        }
        // ...then restart against the same database with the host blocked.
        using var after = new OviApiFactory(new() { ["DATABASE_URL"] = db, ["Links:BlockedHosts"] = "later-bad.example" });
        Assert.AreEqual(HttpStatusCode.Gone, (await VisitAsync(after, "early")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Gone, (await after.CreateUnauthedClient().GetAsync("/early/qr")).StatusCode);
    }

    [TestMethod]
    [DataRow("http://localhost./abc")]
    [DataRow("http://LOCALHOST/abc")]
    public async Task Links_back_to_ovi_are_refused_however_the_host_is_written(string url)
    {
        using var factory = new OviApiFactory();
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest(url));
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, url);
    }
}
