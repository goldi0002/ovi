using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

/// <summary>Searching and filtering the link list, and editing a link.</summary>
[TestClass]
public sealed class LinkSearchAndEditTests : IDisposable
{
    private readonly OviApiFactory _factory = new(new() { ["Links:BlockedHosts"] = "spam.example" });
    private readonly HttpClient _admin;

    public LinkSearchAndEditTests() => _admin = _factory.CreateAuthedClient();

    public void Dispose() => _factory.Dispose();

    private static async Task<LinkResponse> CreateAsync(HttpClient client, string url, string? code = null, DateTimeOffset? expiresAt = null)
    {
        var res = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest(url, code, expiresAt));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
    }

    private static async Task<string[]> Codes(HttpClient client, string query)
    {
        var res = await client.GetAsync($"/api/links?{query}");
        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode, await res.Content.ReadAsStringAsync());
        var page = (await res.Content.ReadFromJsonAsync<PagedResponse<LinkResponse>>())!;
        Assert.AreEqual(page.Items.Count, page.Total, "every match fits on one page in these tests");
        return page.Items.Select(l => l.Code).Order(StringComparer.Ordinal).ToArray();
    }

    private static async Task<string> ErrorFor(HttpResponseMessage res, string field)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, await res.Content.ReadAsStringAsync());
        var problem = await res.Content.ReadFromJsonAsync<JsonElement>();
        return problem.GetProperty("errors").GetProperty(field)[0].GetString()!;
    }

    private static Task<HttpResponseMessage> PatchAsync(HttpClient client, string code, object body) =>
        client.PatchAsJsonAsync($"/api/links/{code}", body);

    // ---- Search ----

    [TestMethod]
    public async Task Search_matches_code_or_destination_ignoring_case()
    {
        await CreateAsync(_admin, "https://docs.example.com/guide", "guide");
        await CreateAsync(_admin, "https://shop.example.com/", "Promo-Docs");
        await CreateAsync(_admin, "https://other.test/", "misc");

        CollectionAssert.AreEqual(new[] { "Promo-Docs", "guide" }, await Codes(_admin, "q=DOCS"));
        CollectionAssert.AreEqual(new[] { "misc" }, await Codes(_admin, "q=other.TEST"));
        CollectionAssert.AreEqual(new[] { "guide" }, await Codes(_admin, "q=%20%20guide%20"));
        CollectionAssert.AreEqual(new[] { "Promo-Docs", "guide", "misc" }, await Codes(_admin, "q="));
        CollectionAssert.AreEqual(Array.Empty<string>(), await Codes(_admin, "q=nothing-like-this"));
    }

    [TestMethod]
    public async Task Search_treats_like_wildcards_literally()
    {
        await CreateAsync(_admin, "https://example.com/100%25-off", "sale");
        await CreateAsync(_admin, "https://example.com/a_b", "under");
        await CreateAsync(_admin, "https://example.com/axb", "plain");

        CollectionAssert.AreEqual(new[] { "sale" }, await Codes(_admin, "q=" + Uri.EscapeDataString("%")));
        CollectionAssert.AreEqual(new[] { "under" }, await Codes(_admin, "q=" + Uri.EscapeDataString("a_b")));
        CollectionAssert.AreEqual(new[] { "under" }, await Codes(_admin, "q=" + Uri.EscapeDataString("_")));
        // The escape character itself is escaped too, so it can't break the pattern.
        CollectionAssert.AreEqual(Array.Empty<string>(), await Codes(_admin, "q=" + Uri.EscapeDataString("\\")));
        CollectionAssert.AreEqual(Array.Empty<string>(), await Codes(_admin, "q=" + Uri.EscapeDataString("\\%")));
    }

    [TestMethod]
    public async Task Search_and_filters_only_cover_the_callers_own_links()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        var bob = await _factory.CreateUserClientAsync("bob");
        await CreateAsync(ada, "https://example.com/shared-word", "ada-one");
        await CreateAsync(bob, "https://example.com/shared-word", "bob-one");
        await CreateAsync(_factory.CreateUnauthedClient(), "https://example.com/shared-word");

        CollectionAssert.AreEqual(new[] { "ada-one" }, await Codes(ada, "q=shared-word"));
        CollectionAssert.AreEqual(Array.Empty<string>(), await Codes(ada, "q=bob"));
        CollectionAssert.AreEqual(new[] { "ada-one" }, await Codes(ada, "status=active"));
        CollectionAssert.AreEqual(new[] { "bob-one" }, await Codes(bob, "q=shared-word&status=all"));
        Assert.AreEqual(3, (await Codes(_admin, "q=shared-word")).Length);
    }

    [TestMethod]
    public async Task Search_and_filters_work_with_paging()
    {
        for (var i = 0; i < 5; i++)
        {
            await CreateAsync(_admin, $"https://match.example/{i}", $"match{i}");
            await CreateAsync(_admin, $"https://other.example/{i}", $"other{i}");
            _factory.Time.Advance(TimeSpan.FromSeconds(1));
        }

        var page = (await _admin.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links?q=match&page=2&pageSize=2"))!;
        Assert.AreEqual(5, page.Total);
        CollectionAssert.AreEqual(new[] { "match2", "match1" }, page.Items.Select(l => l.Code).ToArray());
    }

    [TestMethod]
    public async Task Search_terms_are_limited_in_length()
    {
        StringAssert.Contains(await ErrorFor(await _admin.GetAsync("/api/links?q=" + new string('a', 101)), "q"), "100");
        Assert.AreEqual(HttpStatusCode.OK, (await _admin.GetAsync("/api/links?q=" + new string('a', 100))).StatusCode);
    }

    // ---- Status filter ----

    [TestMethod]
    public async Task Status_filter_splits_active_and_expired_links()
    {
        var now = _factory.Time.GetUtcNow();
        await CreateAsync(_admin, "https://example.com/forever", "forever");
        await CreateAsync(_admin, "https://example.com/later", "later", now.AddDays(2));
        await CreateAsync(_admin, "https://example.com/soon", "soon", now.AddHours(1));
        _factory.Time.Advance(TimeSpan.FromHours(1)); // "soon" expires exactly now

        CollectionAssert.AreEqual(new[] { "forever", "later", "soon" }, await Codes(_admin, ""));
        CollectionAssert.AreEqual(new[] { "forever", "later", "soon" }, await Codes(_admin, "status=all"));
        CollectionAssert.AreEqual(new[] { "forever", "later" }, await Codes(_admin, "status=active"));
        CollectionAssert.AreEqual(new[] { "soon" }, await Codes(_admin, "status=Expired"));
        CollectionAssert.AreEqual(new[] { "later" }, await Codes(_admin, "status=active&q=later"));
        CollectionAssert.AreEqual(Array.Empty<string>(), await Codes(_admin, "status=expired&q=later"));
    }

    [TestMethod]
    [DataRow("archived")]
    [DataRow("1")]
    public async Task Unknown_status_is_rejected(string status)
    {
        StringAssert.Contains(await ErrorFor(await _admin.GetAsync($"/api/links?status={status}"), "status"), "all, active or expired");
    }

    // ---- Sort ----

    private static async Task<string[]> OrderedCodes(HttpClient client, string query)
    {
        var res = await client.GetAsync($"/api/links?{query}");
        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<PagedResponse<LinkResponse>>())!.Items.Select(l => l.Code).ToArray();
    }

    [TestMethod]
    public async Task Sort_orders_the_whole_list_so_paging_follows_it()
    {
        var now = _factory.Time.GetUtcNow();
        await CreateAsync(_admin, "https://example.com/forever", "forever");
        await CreateAsync(_admin, "https://example.com/later", "later", now.AddDays(2));
        await CreateAsync(_admin, "https://example.com/soon", "soon", now.AddHours(1));
        await CreateAsync(_admin, "https://example.com/gone", "gone", now.AddHours(2));
        _factory.Time.Advance(TimeSpan.FromHours(3)); // "soon" and "gone" are expired now

        // Newest first is the default; the others are explicit.
        CollectionAssert.AreEqual(new[] { "gone", "soon", "later", "forever" }, await OrderedCodes(_admin, ""));
        CollectionAssert.AreEqual(new[] { "gone", "soon", "later", "forever" }, await OrderedCodes(_admin, "sort=NEWEST"));
        // Will expire (soonest first), then never, then already expired (earliest expiry first).
        CollectionAssert.AreEqual(new[] { "later", "forever", "soon", "gone" }, await OrderedCodes(_admin, "sort=expiring"));

        var page2 = (await _admin.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links?sort=expiring&page=2&pageSize=2"))!;
        Assert.AreEqual(4, page2.Total);
        CollectionAssert.AreEqual(new[] { "soon", "gone" }, page2.Items.Select(l => l.Code).ToArray());
    }

    [TestMethod]
    public async Task Sort_by_clicks_puts_the_most_clicked_first()
    {
        await CreateAsync(_admin, "https://example.com/a", "quiet");
        await CreateAsync(_admin, "https://example.com/b", "popular");
        await CreateAsync(_admin, "https://example.com/c", "middle");
        for (var i = 0; i < 3; i++) Assert.AreEqual(HttpStatusCode.Redirect, (await _admin.GetAsync("/popular")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Redirect, (await _admin.GetAsync("/middle")).StatusCode);

        CollectionAssert.AreEqual(new[] { "popular", "middle", "quiet" }, await OrderedCodes(_admin, "sort=clicks"));
    }

    [TestMethod]
    [DataRow("oldest")]
    [DataRow("clicks;drop")]
    [DataRow("1")]
    public async Task Unknown_sort_is_rejected(string sort)
    {
        StringAssert.Contains(await ErrorFor(await _admin.GetAsync($"/api/links?sort={sort}"), "sort"), "newest, clicks or expiring");
    }

    // ---- Edit ----

    [TestMethod]
    public async Task Edit_changes_the_destination_and_expiry_but_keeps_the_code_and_clicks()
    {
        var created = await CreateAsync(_admin, "https://example.com/old", "keep");
        await _admin.GetAsync("/keep");
        await _admin.GetAsync("/keep");
        var expires = _factory.Time.GetUtcNow().AddDays(7);

        var res = await PatchAsync(_admin, "keep", new { url = "  https://example.com/new  ", expiresAt = expires });

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode, await res.Content.ReadAsStringAsync());
        var updated = (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
        Assert.AreEqual("keep", updated.Code);
        Assert.AreEqual(created.ShortUrl, updated.ShortUrl);
        Assert.AreEqual("https://example.com/new", updated.Url);
        Assert.AreEqual(expires.UtcDateTime, updated.ExpiresAt);
        Assert.AreEqual(2, updated.Clicks);
        Assert.AreEqual(created.CreatedAt, updated.CreatedAt);

        var visit = await _admin.GetAsync("/keep");
        Assert.AreEqual("https://example.com/new", visit.Headers.Location!.ToString());
        var stats = (await _admin.GetFromJsonAsync<LinkStatsResponse>("/api/links/keep/stats"))!;
        Assert.AreEqual(3, stats.TotalClicks);
        Assert.AreEqual(3, stats.ClicksInRange);
    }

    [TestMethod]
    public async Task Edit_leaves_fields_that_are_not_sent()
    {
        var expires = _factory.Time.GetUtcNow().AddDays(7);
        await CreateAsync(_admin, "https://example.com/old", "partial", expires);

        var urlOnly = (await (await PatchAsync(_admin, "partial", new { url = "https://example.com/new" }))
            .Content.ReadFromJsonAsync<LinkResponse>())!;
        Assert.AreEqual("https://example.com/new", urlOnly.Url);
        Assert.AreEqual(expires.UtcDateTime, urlOnly.ExpiresAt);

        // A null expiresAt means "leave it", like leaving it out; clearing needs clearExpiry.
        var later = expires.AddDays(1);
        var expiryOnly = (await (await PatchAsync(_admin, "partial", new { url = (string?)null, expiresAt = later }))
            .Content.ReadFromJsonAsync<LinkResponse>())!;
        Assert.AreEqual("https://example.com/new", expiryOnly.Url);
        Assert.AreEqual(later.UtcDateTime, expiryOnly.ExpiresAt);
    }

    [TestMethod]
    public async Task Edit_can_clear_the_expiry_bringing_an_expired_link_back()
    {
        await CreateAsync(_admin, "https://example.com", "revive", _factory.Time.GetUtcNow().AddHours(1));
        _factory.Time.Advance(TimeSpan.FromHours(2));
        Assert.AreEqual(HttpStatusCode.Gone, (await _admin.GetAsync("/revive")).StatusCode);

        var res = await PatchAsync(_admin, "revive", new { clearExpiry = true });

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.IsNull((await res.Content.ReadFromJsonAsync<LinkResponse>())!.ExpiresAt);
        Assert.AreEqual(HttpStatusCode.Redirect, (await _admin.GetAsync("/revive")).StatusCode);
        CollectionAssert.AreEqual(new[] { "revive" }, await Codes(_admin, "status=active"));
    }

    [TestMethod]
    [DataRow("", "Enter a URL")]
    [DataRow("example.com", "full web address")]
    [DataRow("javascript:alert(1)", "full web address")]
    [DataRow("https://bank.example@evil.example/login", "user name or password")]
    [DataRow("https://spam.example/buy", "can't be created")]
    [DataRow("http://localhost/abc", "already an Ovi link")]
    public async Task Edit_checks_the_url_like_create(string url, string message)
    {
        await CreateAsync(_admin, "https://example.com/before", "checked");

        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, "checked", new { url }), "url"), message);

        var unchanged = (await _admin.GetFromJsonAsync<LinkResponse>("/api/links/checked"))!;
        Assert.AreEqual("https://example.com/before", unchanged.Url);
    }

    [TestMethod]
    public async Task Edit_checks_the_expiry_like_create()
    {
        var now = _factory.Time.GetUtcNow();
        await CreateAsync(_admin, "https://example.com", "when");

        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, "when", new { expiresAt = now.AddMinutes(-1) }), "expiresAt"),
            "in the future");
        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, "when", new { expiresAt = now.AddYears(11) }), "expiresAt"),
            "10 years");
        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, "when",
            new { expiresAt = now.AddDays(1), clearExpiry = true }), "expiresAt"), "not both");
    }

    [TestMethod]
    public async Task Edit_reports_every_bad_field_and_changes_nothing()
    {
        await CreateAsync(_admin, "https://example.com/before", "both");

        var res = await PatchAsync(_admin, "both", new { url = "nope", expiresAt = _factory.Time.GetUtcNow().AddDays(-1) });

        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode);
        var errors = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.IsTrue(errors.TryGetProperty("url", out _));
        Assert.IsTrue(errors.TryGetProperty("expiresAt", out _));
        Assert.AreEqual("https://example.com/before", (await _admin.GetFromJsonAsync<LinkResponse>("/api/links/both"))!.Url);
    }

    [TestMethod]
    public async Task Edit_needs_something_to_change()
    {
        await CreateAsync(_admin, "https://example.com", "empty");

        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, "empty", new { }), "body"), "clearExpiry");
        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, "empty", new { expiresAt = (DateTimeOffset?)null }), "body"), "url");
        var noBody = await _admin.PatchAsync("/api/links/empty", new StringContent("", System.Text.Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.BadRequest, noBody.StatusCode);
    }

    [TestMethod]
    public async Task Anonymous_links_must_keep_expiring_within_30_days()
    {
        var anon = await CreateAsync(_factory.CreateUnauthedClient(), "https://example.com/anon");
        var now = _factory.Time.GetUtcNow();

        // Only the admin can see anonymous links, and even the admin can't make them permanent.
        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, anon.Code, new { clearExpiry = true }), "expiresAt"), "always expire");
        StringAssert.Contains(await ErrorFor(await PatchAsync(_admin, anon.Code, new { expiresAt = now.AddDays(31) }), "expiresAt"),
            "30 days");

        var res = await PatchAsync(_admin, anon.Code, new { url = "https://example.com/fixed", expiresAt = now.AddDays(3) });
        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.AreEqual(now.AddDays(3).UtcDateTime, (await res.Content.ReadFromJsonAsync<LinkResponse>())!.ExpiresAt);
    }

    [TestMethod]
    public async Task Only_the_owner_or_the_admin_can_edit_a_link()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        var bob = await _factory.CreateUserClientAsync("bob");
        await CreateAsync(ada, "https://example.com/ada", "adas");
        var anonLink = await CreateAsync(_factory.CreateUnauthedClient(), "https://example.com/anon");

        Assert.AreEqual(HttpStatusCode.NotFound, (await PatchAsync(bob, "adas", new { url = "https://evil.example/" })).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await PatchAsync(bob, anonLink.Code, new { url = "https://evil.example/" })).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await PatchAsync(ada, "missing", new { url = "https://example.com/" })).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized,
            (await PatchAsync(_factory.CreateUnauthedClient(), "adas", new { url = "https://evil.example/" })).StatusCode);
        Assert.AreEqual("https://example.com/ada", (await ada.GetFromJsonAsync<LinkResponse>("/api/links/adas"))!.Url);

        Assert.AreEqual(HttpStatusCode.OK, (await PatchAsync(ada, "adas", new { url = "https://example.com/ada2" })).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await PatchAsync(_admin, "adas", new { url = "https://example.com/ada3" })).StatusCode);
        Assert.AreEqual("https://example.com/ada3", (await ada.GetFromJsonAsync<LinkResponse>("/api/links/adas"))!.Url);
    }

    [TestMethod]
    public async Task Editing_with_a_session_cookie_needs_the_ovi_request_header()
    {
        var owner = await _factory.CreateUserClientAsync("csrf");
        await CreateAsync(owner, "https://example.com", "guarded");
        var noHeader = await _factory.CreateUserClientAsync("csrf", csrfHeader: false);

        Assert.AreEqual(HttpStatusCode.Forbidden, (await PatchAsync(noHeader, "guarded", new { url = "https://evil.example/" })).StatusCode);
    }

    [TestMethod]
    public async Task Deleted_links_cannot_be_edited()
    {
        await CreateAsync(_admin, "https://example.com", "gone");
        await _admin.DeleteAsync("/api/links/gone");

        Assert.AreEqual(HttpStatusCode.NotFound, (await PatchAsync(_admin, "gone", new { url = "https://example.com/back" })).StatusCode);
    }
}
