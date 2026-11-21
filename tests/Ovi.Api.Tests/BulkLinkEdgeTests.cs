using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Ovi.Api.Data;
using Ovi.Api.Links;
using Ovi.Api.Security;

namespace Ovi.Api.Tests;

/// <summary>
/// Edge cases for POST /api/links/bulk (docs/product/bulk-shortening.md, docs/decisions/0002-bulk-link-creation.md):
/// limits, malformed bodies, the auth matrix, the shared create budget, unicode, expiry edges, atomicity and concurrency.
/// The happy path and per-rule errors are in BulkLinkTests.
/// </summary>
[TestClass]
public sealed class BulkLinkEdgeTests : IDisposable
{
    private const string Bulk = "/api/links/bulk";
    private const int Max = 25;

    private readonly OviApiFactory _factory = new();

    public void Dispose() => _factory.Dispose();

    private sealed record BulkResult(List<LinkResponse> Items);

    private static List<string> Urls(int n, string prefix = "https://example.com/") =>
        Enumerable.Range(0, n).Select(i => prefix + i).ToList();

    private static Task<HttpResponseMessage> PostBulk(HttpClient client, object body) => client.PostAsJsonAsync(Bulk, body);

    private static Task<HttpResponseMessage> PostRaw(HttpClient client, string json) =>
        client.PostAsync(Bulk, new StringContent(json, Encoding.UTF8, "application/json"));

    private static async Task<List<LinkResponse>> CreatedAsync(HttpResponseMessage res)
    {
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<BulkResult>())!.Items;
    }

    private static async Task<IDictionary<string, string[]>> ErrorsAsync(HttpResponseMessage res)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors;
    }

    private static async Task<int> LinkCountAsync(OviApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Links.IgnoreQueryFilters().CountAsync();
    }

    private static async Task<List<Link>> LinksAsync(OviApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Links.IgnoreQueryFilters().AsNoTracking().ToListAsync();
    }

    private static async Task ExecuteSqlAsync(OviApiFactory factory, string sql)
    {
        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.ExecuteSqlRawAsync(sql);
    }

    // ---- Batch size (AC 6, 7) ----

    [TestMethod]
    public async Task Exactly_the_limit_succeeds_in_input_order()
    {
        var urls = Urls(Max);
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls }));

        CollectionAssert.AreEqual(urls.Select(u => new Uri(u).AbsoluteUri).ToList(), items.Select(i => i.Url).ToList());
        Assert.AreEqual(Max, items.Select(i => i.Code).Distinct().Count());
        Assert.AreEqual(Max, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task The_limit_of_maximum_length_urls_fits_the_body_limit()
    {
        var urls = Enumerable.Range(0, Max)
            .Select(i => { var u = $"https://example.com/{i:D2}/"; return u + new string('a', LinkRules.MaxUrlLength - u.Length); })
            .ToList();
        Assert.IsTrue(urls.All(u => u.Length == LinkRules.MaxUrlLength));
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls }));
        CollectionAssert.AreEqual(urls, items.Select(i => i.Url).ToList());
    }

    [TestMethod]
    public async Task One_url_succeeds()
    {
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = new[] { "https://example.com/one" } }));
        Assert.HasCount(1, items);
    }

    [TestMethod]
    public async Task One_over_the_limit_is_refused_and_creates_nothing()
    {
        var errors = await ErrorsAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(Max + 1) }));
        CollectionAssert.AreEqual(new[] { "You can shorten at most 25 URLs at once." }, errors["urls"]);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task A_huge_batch_is_refused_without_a_500()
    {
        var res = await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(2000, "https://e.test/") });
        Assert.IsTrue(res.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge, res.StatusCode.ToString());
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task An_over_limit_batch_of_invalid_urls_reports_the_size()
    {
        // Size is checked before the items, so 30 bad URLs give one clear message rather than 30.
        var errors = await ErrorsAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = Enumerable.Repeat("nope", 30) }));
        CollectionAssert.AreEqual(new[] { "You can shorten at most 25 URLs at once." }, errors["urls"]);
        Assert.IsFalse(errors.Keys.Any(k => k.StartsWith("urls[")));
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    [DataRow("{}")]
    [DataRow("{\"urls\":null}")]
    [DataRow("{\"urls\":[]}")]
    [DataRow("{\"URLS\":[]}")]
    public async Task Missing_null_or_empty_list_asks_for_a_url(string json)
    {
        var errors = await ErrorsAsync(await PostRaw(_factory.CreateAuthedClient(), json));
        CollectionAssert.AreEqual(new[] { "Add at least one URL." }, errors["urls"]);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("null")]
    [DataRow("not json")]
    [DataRow("{\"urls\":[\"https://a.test\"")]
    [DataRow("{\"urls\":\"https://a.test\"}")]
    [DataRow("{\"urls\":[1,2]}")]
    [DataRow("{\"urls\":[[\"https://a.test\"]]}")]
    [DataRow("{\"urls\":{\"0\":\"https://a.test\"}}")]
    [DataRow("{\"urls\":[\"https://a.test\"],\"expiresAt\":\"tomorrow\"}")]
    [DataRow("[\"https://a.test\"]")]
    public async Task Malformed_bodies_get_400_not_500(string json)
    {
        var res = await PostRaw(_factory.CreateAuthedClient(), json);
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, json + " -> " + await res.Content.ReadAsStringAsync());
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task Wrong_content_type_is_refused_without_a_500()
    {
        var res = await _factory.CreateAuthedClient().PostAsync(Bulk, new StringContent("{\"urls\":[\"https://a.test\"]}", Encoding.UTF8, "text/plain"));
        Assert.IsTrue((int)res.StatusCode is 400 or 415, res.StatusCode.ToString());
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    // ---- Items (AC 9, 10, 11, 13) ----

    [TestMethod]
    public async Task Empty_and_null_items_are_reported_by_position_and_nothing_is_created()
    {
        var errors = await ErrorsAsync(await PostRaw(_factory.CreateAuthedClient(), "{\"urls\":[\"https://a.test\",\"\",null,\"   \"]}"));

        Assert.IsFalse(errors.ContainsKey("urls[0]"));
        foreach (var key in new[] { "urls[1]", "urls[2]", "urls[3]" })
            CollectionAssert.AreEqual(new[] { "Enter a URL to shorten." }, errors[key], key);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task Every_invalid_item_is_reported_with_the_single_create_message()
    {
        var urls = new[]
        {
            "https://ok.test/0",
            "ftp://x.test",
            "https://ok.test/2",
            "http://localhost/abc",
            "https://user:pw@bank.test/",
            "https://example.com/‮gpj.exe",
            "https://example.com/" + new string('a', LinkRules.MaxUrlLength),
        };
        var client = _factory.CreateAuthedClient();
        var errors = await ErrorsAsync(await PostBulk(client, new { urls }));

        CollectionAssert.AreEquivalent(new[] { "urls[1]", "urls[3]", "urls[4]", "urls[5]", "urls[6]" }, errors.Keys.ToList());
        for (var i = 0; i < urls.Length; i++)
        {
            if (!errors.TryGetValue($"urls[{i}]", out var bulkMessage)) continue;
            var single = await ErrorsAsync(await client.PostAsJsonAsync("/api/links", new CreateLinkRequest(urls[i])));
            CollectionAssert.AreEqual(single["url"], bulkMessage, urls[i]);
        }
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task Indexes_count_from_zero_up_to_the_last_item()
    {
        var urls = Urls(Max);
        urls[0] = "bad";
        urls[Max - 1] = "also bad";
        var errors = await ErrorsAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls }));
        CollectionAssert.AreEquivalent(new[] { "urls[0]", $"urls[{Max - 1}]" }, errors.Keys.ToList());
    }

    [TestMethod]
    public async Task A_url_that_grows_past_the_limit_once_encoded_is_refused()
    {
        // 1000 two-byte characters fit in 2048 as typed but become 6000 characters percent-encoded.
        var url = "https://example.com/" + new string('é', 1000);
        var errors = await ErrorsAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = new[] { url } }));
        StringAssert.Contains(errors["urls[0]"][0], "once encoded");
    }

    [TestMethod]
    public async Task Duplicate_urls_each_get_their_own_link()
    {
        var urls = new[] { "https://dup.test/", "https://dup.test/", "https://other.test/", "https://dup.test/" };
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls }));

        CollectionAssert.AreEqual(urls, items.Select(i => i.Url).ToArray());
        Assert.AreEqual(4, items.Select(i => i.Code).Distinct().Count());
    }

    [TestMethod]
    public async Task A_custom_code_field_is_never_used()
    {
        var res = await PostRaw(_factory.CreateAuthedClient(),
            "{\"urls\":[\"https://a.test/\"],\"customCode\":\"mine1\",\"code\":\"mine2\"}");
        if (res.StatusCode == HttpStatusCode.BadRequest) return; // rejecting it is also allowed (AC 13)
        var items = await CreatedAsync(res);
        Assert.IsFalse(items[0].Code is "mine1" or "mine2");
        Assert.AreEqual(7, items[0].Code.Length);
    }

    [TestMethod]
    public async Task Unicode_urls_are_stored_ascii_and_redirect_without_a_500()
    {
        var urls = new[] { "https://bücher.example/straße?q=日本", "https://例え.テスト/パス" };
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls }));

        Assert.AreEqual("https://xn--bcher-kva.example/stra%C3%9Fe?q=%E6%97%A5%E6%9C%AC", items[0].Url);
        foreach (var item in items)
        {
            Assert.IsTrue(item.Url.All(char.IsAscii), item.Url);
            var visit = await _factory.CreateUnauthedClient().GetAsync("/" + item.Code);
            Assert.AreEqual(HttpStatusCode.Redirect, visit.StatusCode);
            Assert.AreEqual(item.Url, visit.Headers.Location!.AbsoluteUri);
        }
    }

    [TestMethod]
    public async Task A_stored_link_with_a_unicode_host_redirects_with_an_ascii_location()
    {
        // Rows stored before the punycode fix hold Unicode hosts; Kestrel refuses non-ASCII headers (500 on every visit).
        await ExecuteSqlAsync(_factory, """
            INSERT INTO "Links" ("Code", "Url", "Clicks", "CreatedAt", "Anonymous")
            VALUES ('oldidn1', 'https://bücher.example/stra%C3%9Fe', 0, now(), false)
            """);
        var visit = await _factory.CreateUnauthedClient().GetAsync("/oldidn1");
        Assert.AreEqual(HttpStatusCode.Redirect, visit.StatusCode);
        var location = visit.Headers.GetValues("Location").Single();
        Assert.IsTrue(location.All(char.IsAscii), location);
        Assert.AreEqual("https://xn--bcher-kva.example/stra%C3%9Fe", location);
    }

    [TestMethod]
    public async Task Surrounding_whitespace_is_trimmed_like_single_create()
    {
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = new[] { "  https://trim.test/a \t" } }));
        Assert.AreEqual("https://trim.test/a", items[0].Url);
    }

    // ---- Expiry (AC 12) ----

    [TestMethod]
    public async Task Expiry_exactly_now_is_refused()
    {
        var now = _factory.Time.GetUtcNow();
        var errors = await ErrorsAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(2), expiresAt = now }));
        CollectionAssert.AreEqual(new[] { "The expiry date must be in the future." }, errors["expiresAt"]);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task Expiry_one_second_ahead_is_set_on_every_link_and_they_stop_when_it_passes()
    {
        var expiry = _factory.Time.GetUtcNow().AddSeconds(1);
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(3), expiresAt = expiry }));
        Assert.IsTrue(items.All(i => i.ExpiresAt == expiry.UtcDateTime));

        _factory.Time.Advance(TimeSpan.FromSeconds(1)); // expiry == now counts as expired
        foreach (var item in items)
            Assert.AreEqual(HttpStatusCode.Gone, (await _factory.CreateUnauthedClient().GetAsync("/" + item.Code)).StatusCode);
    }

    [TestMethod]
    public async Task Expiry_at_most_ten_years_away()
    {
        var client = _factory.CreateAuthedClient();
        var limit = _factory.Time.GetUtcNow().AddYears(LinkRules.MaxExpiryYears);

        await CreatedAsync(await PostBulk(client, new { urls = Urls(1), expiresAt = limit }));
        var errors = await ErrorsAsync(await PostBulk(client, new { urls = Urls(1), expiresAt = limit.AddSeconds(1) }));
        Assert.IsTrue(errors.ContainsKey("expiresAt"));
    }

    [TestMethod]
    public async Task Expiry_with_an_offset_is_stored_in_utc()
    {
        var local = new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.FromHours(5.5));
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(1), expiresAt = local }));
        Assert.AreEqual(local.UtcDateTime, items[0].ExpiresAt);
        Assert.AreEqual(DateTimeKind.Utc, items[0].ExpiresAt!.Value.Kind);
    }

    [TestMethod]
    public async Task Without_an_expiry_signed_in_links_never_expire()
    {
        var items = await CreatedAsync(await PostBulk(await _factory.CreateUserClientAsync(), new { urls = Urls(2) }));
        Assert.IsTrue(items.All(i => i.ExpiresAt is null));
    }

    // ---- Who may call it (AC 1-5) ----

    [TestMethod]
    public async Task Anonymous_callers_get_401_and_nothing_is_created()
    {
        var res = await PostBulk(_factory.CreateUnauthedClient(), new { urls = Urls(2) });
        Assert.AreEqual(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.AreEqual("Sign in to shorten many links at once.", (await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task Anonymous_callers_get_401_even_for_an_invalid_body()
    {
        // Auth is checked before the body, so visitors learn nothing about validation.
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await PostBulk(_factory.CreateUnauthedClient(), new { urls = Urls(Max + 1) })).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await PostRaw(_factory.CreateUnauthedClient(), "{}")).StatusCode);
    }

    [TestMethod]
    public async Task Cookie_without_the_csrf_header_gets_403_and_nothing_is_created()
    {
        var client = await _factory.CreateUserClientAsync("csrf", csrfHeader: false);
        var res = await PostBulk(client, new { urls = Urls(2) });
        Assert.AreEqual(HttpStatusCode.Forbidden, res.StatusCode);
        StringAssert.Contains((await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title, CallerFilter.CsrfHeader);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task Suspended_users_get_403_and_nothing_is_created()
    {
        var client = await _factory.CreateUserClientAsync("spammer");
        await ExecuteSqlAsync(_factory, "UPDATE \"Users\" SET \"BlockedAt\" = now()");

        var res = await PostBulk(client, new { urls = Urls(2) });
        Assert.AreEqual(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.AreEqual("This account is suspended.", (await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task Wrong_api_keys_get_401_and_count_towards_the_key_throttle()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:ApiKeyFailuresPerMinute"] = "2" });
        var client = factory.CreateUnauthedClient();
        client.DefaultRequestHeaders.Add(CallerFilter.ApiKeyHeader, "wrong");

        Assert.AreEqual(HttpStatusCode.Unauthorized, (await PostBulk(client, new { urls = Urls(1) })).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await PostBulk(client, new { urls = Urls(1) })).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await PostBulk(client, new { urls = Urls(1) })).StatusCode);
        Assert.AreEqual(0, await LinkCountAsync(factory));
    }

    [TestMethod]
    public async Task A_users_batch_is_theirs_only()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        var bob = await _factory.CreateUserClientAsync("bob");
        var items = await CreatedAsync(await PostBulk(ada, new { urls = Urls(3) }));

        var adaList = (await ada.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links"))!;
        CollectionAssert.AreEquivalent(items.Select(i => i.Code).ToList(), adaList.Items.Select(i => i.Code).ToList());
        Assert.AreEqual(0, (await bob.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links"))!.Total);
        foreach (var item in items)
        {
            Assert.AreEqual(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/links/{item.Code}")).StatusCode);
            Assert.AreEqual(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/links/{item.Code}")).StatusCode);
        }

        var stored = await LinksAsync(_factory);
        Assert.IsTrue(stored.All(l => l.OwnerId is not null && !l.Anonymous && l.OwnerId == stored[0].OwnerId));
    }

    [TestMethod]
    public async Task Api_key_links_have_no_owner_and_are_not_anonymous()
    {
        await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(2) }));
        var stored = await LinksAsync(_factory);
        Assert.HasCount(2, stored);
        Assert.IsTrue(stored.All(l => l.OwnerId is null && !l.Anonymous && l.ExpiresAt is null));
        Assert.AreEqual(1, stored.Select(l => l.CreatedAt).Distinct().Count());
    }

    [TestMethod]
    public async Task Only_post_is_allowed()
    {
        var client = _factory.CreateAuthedClient();
        // GET /api/links/bulk is the "get one link" route with code "bulk"; with no such link it is 404, not 500.
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(Bulk)).StatusCode);
        Assert.AreEqual(HttpStatusCode.MethodNotAllowed, (await client.PutAsJsonAsync(Bulk, new { urls = Urls(1) })).StatusCode);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    [TestMethod]
    public async Task A_link_with_the_code_bulk_stays_manageable_and_post_still_reaches_bulk()
    {
        // "bulk" is a valid custom code (and may already exist). GET/PATCH/DELETE /api/links/bulk must still reach that
        // link, while POST /api/links/bulk is the bulk route.
        var client = _factory.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/", "bulk"))).StatusCode);

        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync(Bulk)).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await client.PatchAsJsonAsync(Bulk, new UpdateLinkRequest("https://example.com/2"))).StatusCode);
        await CreatedAsync(await PostBulk(client, new { urls = Urls(2) }));
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.DeleteAsync(Bulk)).StatusCode);
    }

    // ---- Shared create budget (AC 18-21) ----

    [TestMethod]
    public async Task A_batch_costs_one_permit_per_url_shared_with_single_create()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "30" });
        var client = factory.CreateAuthedClient();

        await CreatedAsync(await PostBulk(client, new { urls = Urls(25) }));
        var refused = await PostBulk(client, new { urls = Urls(10) });
        Assert.AreEqual(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.IsTrue(refused.Headers.RetryAfter is not null, "429 should carry Retry-After");
        await CreatedAsync(await PostBulk(client, new { urls = Urls(5) }));

        // The budget is spent: single create and edits are refused too.
        Assert.AreEqual(HttpStatusCode.TooManyRequests,
            (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/"))).StatusCode);
        Assert.AreEqual(30, await LinkCountAsync(factory));
    }

    [TestMethod]
    public async Task Single_creates_use_up_the_budget_a_batch_needs()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "5" });
        var client = factory.CreateAuthedClient();
        for (var i = 0; i < 3; i++)
            Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/" + i))).StatusCode);

        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await PostBulk(client, new { urls = Urls(3) })).StatusCode);
        await CreatedAsync(await PostBulk(client, new { urls = Urls(2) }));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await PostBulk(client, new { urls = Urls(1) })).StatusCode);
    }

    [TestMethod]
    public async Task Invalid_batches_cost_nothing()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "3" });
        var client = factory.CreateAuthedClient();
        for (var i = 0; i < 5; i++)
        {
            Assert.AreEqual(HttpStatusCode.BadRequest, (await PostBulk(client, new { urls = new[] { "bad" } })).StatusCode);
            Assert.AreEqual(HttpStatusCode.BadRequest, (await PostBulk(client, new { urls = Urls(Max + 1) })).StatusCode);
            Assert.AreEqual(HttpStatusCode.BadRequest, (await PostRaw(client, "{}")).StatusCode);
        }
        await CreatedAsync(await PostBulk(client, new { urls = Urls(3) }));
    }

    [TestMethod]
    public async Task A_batch_bigger_than_the_whole_budget_is_a_400_naming_the_lower_limit()
    {
        // max = min(25, CreatePerMinute): such a batch could never succeed, and the limiter throws for N > limit.
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "10" });
        var client = factory.CreateAuthedClient();
        for (var i = 0; i < 3; i++)
        {
            var errors = await ErrorsAsync(await PostBulk(client, new { urls = Urls(11) }));
            CollectionAssert.AreEqual(new[] { "You can shorten at most 10 URLs at once." }, errors["urls"]);
            Assert.IsFalse(errors.Keys.Any(k => k.StartsWith("urls[")));
        }
        Assert.AreEqual(0, await LinkCountAsync(factory));
        await CreatedAsync(await PostBulk(client, new { urls = Urls(10) }));
    }

    [TestMethod]
    public async Task A_batch_over_the_remaining_budget_is_a_429_that_takes_nothing()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "6" });
        var client = factory.CreateAuthedClient();
        await CreatedAsync(await PostBulk(client, new { urls = Urls(2) }));
        for (var i = 0; i < 3; i++)
        {
            var res = await PostBulk(client, new { urls = Urls(5) });
            Assert.AreEqual(HttpStatusCode.TooManyRequests, res.StatusCode);
            Assert.IsNotNull(res.Headers.RetryAfter);
            Assert.AreEqual("You've made too many links in the last minute; try again shortly.",
                (await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title);
        }
        Assert.AreEqual(2, await LinkCountAsync(factory));
        await CreatedAsync(await PostBulk(client, new { urls = Urls(4) }));
    }

    [TestMethod]
    public async Task Single_create_429_has_a_problem_body_and_retry_after()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "1" });
        var client = factory.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/"))).StatusCode);
        var res = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/"));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, res.StatusCode);
        Assert.IsNotNull(res.Headers.RetryAfter);
        Assert.IsNotNull((await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title);
    }

    [TestMethod]
    public async Task Refused_auth_does_not_spend_the_users_budget()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "2" });
        var noCsrf = await factory.CreateUserClientAsync("ada", csrfHeader: false);
        for (var i = 0; i < 5; i++)
            Assert.AreEqual(HttpStatusCode.Forbidden, (await PostBulk(noCsrf, new { urls = Urls(2) })).StatusCode);

        var ada = await factory.CreateUserClientAsync("ada");
        await CreatedAsync(await PostBulk(ada, new { urls = Urls(2) }));
    }

    [TestMethod]
    public async Task Wrong_api_keys_do_not_spend_the_key_budget()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "2" });
        var wrong = factory.CreateUnauthedClient();
        wrong.DefaultRequestHeaders.Add(CallerFilter.ApiKeyHeader, "wrong");
        for (var i = 0; i < 3; i++)
        {
            Assert.AreEqual(HttpStatusCode.Unauthorized, (await PostBulk(wrong, new { urls = Urls(2) })).StatusCode);
            Assert.AreEqual(HttpStatusCode.Unauthorized,
                (await wrong.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/"))).StatusCode);
        }

        var right = factory.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.Created, (await right.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/"))).StatusCode);
        await CreatedAsync(await PostBulk(right, new { urls = Urls(1) }));
    }

    [TestMethod]
    public async Task Suspended_users_get_403_not_429_when_their_budget_is_spent()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "2" });
        var client = await factory.CreateUserClientAsync("spent");
        await CreatedAsync(await PostBulk(client, new { urls = Urls(2) }));
        await ExecuteSqlAsync(factory, "UPDATE \"Users\" SET \"BlockedAt\" = now()");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await PostBulk(client, new { urls = Urls(1) })).StatusCode);
    }

    [TestMethod]
    public async Task Each_user_has_their_own_budget()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "3" });
        var ada = await factory.CreateUserClientAsync("ada");
        var bob = await factory.CreateUserClientAsync("bob");
        await CreatedAsync(await PostBulk(ada, new { urls = Urls(3) }));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await PostBulk(ada, new { urls = Urls(1) })).StatusCode);
        await CreatedAsync(await PostBulk(bob, new { urls = Urls(3) }));
    }

    [TestMethod]
    public async Task Edits_share_the_create_budget()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "3" });
        var client = factory.CreateAuthedClient();
        var items = await CreatedAsync(await PostBulk(client, new { urls = Urls(2) }));
        Assert.AreEqual(HttpStatusCode.OK,
            (await client.PatchAsJsonAsync($"/api/links/{items[0].Code}", new UpdateLinkRequest("https://example.com/new"))).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests,
            (await client.PatchAsJsonAsync($"/api/links/{items[0].Code}", new UpdateLinkRequest("https://example.com/new2"))).StatusCode);
    }

    [TestMethod]
    public async Task Single_create_and_patch_still_cost_one_permit_even_when_invalid()
    {
        // Contract 0002: single create and PATCH take their permit before validating (unchanged behaviour).
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "4" });
        var client = factory.CreateAuthedClient();
        var items = await CreatedAsync(await PostBulk(client, new { urls = Urls(1) }));              // 1
        Assert.AreEqual(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("bad"))).StatusCode);   // 2
        Assert.AreEqual(HttpStatusCode.BadRequest,
            (await client.PatchAsJsonAsync($"/api/links/{items[0].Code}", new UpdateLinkRequest("bad"))).StatusCode); // 3
        await CreatedAsync(await PostBulk(client, new { urls = Urls(1) }));                           // 4
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await PostBulk(client, new { urls = Urls(1) })).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests,
            (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/"))).StatusCode);
    }

    [TestMethod]
    public async Task Anonymous_single_create_keeps_its_hourly_budget()
    {
        // Regression guard for moving the create policy out of the middleware (decision 0002).
        using var factory = new OviApiFactory(new() { ["RateLimits:AnonymousCreatePerHour"] = "2" });
        var anon = factory.CreateUnauthedClient();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 3; i++)
            statuses.Add((await anon.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/" + i))).StatusCode);
        CollectionAssert.AreEqual(new[] { HttpStatusCode.Created, HttpStatusCode.Created, HttpStatusCode.TooManyRequests }, statuses);
    }

    [TestMethod]
    public async Task Concurrent_batches_never_exceed_the_budget()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "30" });
        var client = factory.CreateAuthedClient();
        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => PostBulk(client, new { urls = Urls(10) })));

        Assert.AreEqual(3, results.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.AreEqual(3, results.Count(r => r.StatusCode == HttpStatusCode.TooManyRequests));
        Assert.AreEqual(30, await LinkCountAsync(factory));
    }

    // ---- Codes, atomicity, concurrency (AC 14, 16, 17) ----

    [TestMethod]
    public async Task Concurrent_batches_get_distinct_codes_and_all_redirect()
    {
        var client = _factory.CreateAuthedClient();
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(b => PostBulk(client, new { urls = Urls(Max, $"https://c{b}.test/") })));

        var all = new List<LinkResponse>();
        foreach (var r in results) all.AddRange(await CreatedAsync(r));
        Assert.AreEqual(8 * Max, all.Select(l => l.Code).Distinct().Count());

        foreach (var item in all.Take(10))
        {
            var visit = await _factory.CreateUnauthedClient().GetAsync("/" + item.Code);
            Assert.AreEqual(item.Url, visit.Headers.Location!.AbsoluteUri);
        }
    }

    [TestMethod]
    public async Task Codes_never_reuse_live_or_deleted_links()
    {
        var client = _factory.CreateAuthedClient();
        var first = await CreatedAsync(await PostBulk(client, new { urls = Urls(Max) }));
        foreach (var item in first.Take(10))
            Assert.AreEqual(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/links/{item.Code}")).StatusCode);

        var second = await CreatedAsync(await PostBulk(client, new { urls = Urls(Max) }));
        Assert.IsFalse(second.Select(i => i.Code).Intersect(first.Select(i => i.Code)).Any());
    }

    [TestMethod]
    public async Task A_database_failure_part_way_leaves_no_link_from_the_batch()
    {
        await ExecuteSqlAsync(_factory, """
            CREATE FUNCTION qa_fail_insert() RETURNS trigger AS $$
            BEGIN
              IF NEW."Url" = 'https://fail.test/' THEN RAISE EXCEPTION 'qa: simulated failure'; END IF;
              RETURN NEW;
            END $$ LANGUAGE plpgsql;
            CREATE TRIGGER qa_fail_insert BEFORE INSERT ON "Links" FOR EACH ROW EXECUTE FUNCTION qa_fail_insert();
            """);
        var urls = new[] { "https://ok.test/1", "https://ok.test/2", "https://fail.test/", "https://ok.test/4" };

        var res = await PostBulk(_factory.CreateAuthedClient(), new { urls });

        Assert.IsGreaterThanOrEqualTo(500, (int)res.StatusCode);
        Assert.AreEqual(0, await LinkCountAsync(_factory));
    }

    // ---- Code generation through the test seam (AC 16, 40) ----

    private static Func<string> Script(params string[] codes)
    {
        var queue = new Queue<string>(codes);
        return () => queue.Count > 0 ? queue.Dequeue() : throw new AssertFailedException("generator called too often");
    }

    private async Task<List<string>> NewCodesAsync(int count, Func<string> generate)
    {
        using var scope = _factory.Services.CreateScope();
        return await LinkEndpoints.NewCodesAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), count, generate);
    }

    [TestMethod]
    public async Task Repeats_within_a_batch_are_replaced()
    {
        var codes = await NewCodesAsync(3, Script("aaaaaaa", "aaaaaaa", "bbbbbbb", "aaaaaaa", "ccccccc"));
        CollectionAssert.AreEqual(new[] { "aaaaaaa", "bbbbbbb", "ccccccc" }, codes);
    }

    [TestMethod]
    public async Task Codes_of_live_and_deleted_links_are_replaced()
    {
        var client = _factory.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/", "livecode"))).StatusCode);
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/", "gonecode"))).StatusCode);
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/links/gonecode")).StatusCode);

        var codes = await NewCodesAsync(2, Script("livecode", "fresh01", "gonecode", "fresh02"));
        CollectionAssert.AreEquivalent(new[] { "fresh01", "fresh02" }, codes);
    }

    [TestMethod]
    public async Task Codes_are_compared_case_sensitively()
    {
        // Codes are case-sensitive in the redirect route, so "ABCDEFG" is free when "abcdefg" exists.
        var client = _factory.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://a.test/", "abcdefg"))).StatusCode);
        CollectionAssert.AreEqual(new[] { "ABCDEFG" }, await NewCodesAsync(1, Script("ABCDEFG")));
    }

    [TestMethod]
    public async Task A_generator_that_always_collides_gives_up_instead_of_spinning()
    {
        var calls = 0;
        var codes = await NewCodesAsync(5, () => { calls++; return "samesam"; });
        Assert.HasCount(1, codes);
        Assert.IsLessThan(1000, calls);
    }

    private sealed class StuckCodeSource : CodeSource
    {
        public volatile bool Stuck = true;
        public override string Next() => Stuck ? "samesam" : base.Next();
    }

    [TestMethod]
    public async Task Running_out_of_codes_is_a_503_that_leaves_nothing_and_a_resend_succeeds()
    {
        // A generator that keeps repeating itself can't fill the batch, so NewCodesAsync gives up (AC 40).
        var source = new StuckCodeSource();
        using var factory = _factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<CodeSource>();
            s.AddSingleton<CodeSource>(source);
        }));
        var client = factory.CreateClient(new() { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add(CallerFilter.ApiKeyHeader, OviApiFactory.ApiKey);
        var body = new { urls = Urls(3, "https://stuck.test/") };

        var res = await PostBulk(client, body);
        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.AreEqual("Couldn't make short codes; try again.", (await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title);
        using (var scope = factory.Services.CreateScope())
            Assert.AreEqual(0, await scope.ServiceProvider.GetRequiredService<AppDbContext>().Links.IgnoreQueryFilters().CountAsync());

        source.Stuck = false;
        var items = await CreatedAsync(await PostBulk(client, body));
        CollectionAssert.AreEqual(body.urls, items.Select(i => i.Url).ToList());
        Assert.AreEqual(3, items.Select(i => i.Code).Distinct().Count());
    }

    [TestMethod]
    public async Task A_code_race_lost_at_save_is_a_503_that_leaves_nothing_and_a_resend_succeeds()
    {
        // Simulates a concurrent request taking one of the batch's codes between the check and the insert: the
        // database reports a unique violation for the third row (AC 40, LinkEndpoints bulk UniqueViolation path).
        await ExecuteSqlAsync(_factory, """
            CREATE FUNCTION qa_race() RETURNS trigger AS $$
            BEGIN
              IF NEW."Url" = 'https://race.test/2' THEN
                RAISE EXCEPTION 'qa: simulated code race' USING ERRCODE = 'unique_violation';
              END IF;
              RETURN NEW;
            END $$ LANGUAGE plpgsql;
            CREATE TRIGGER qa_race BEFORE INSERT ON "Links" FOR EACH ROW EXECUTE FUNCTION qa_race();
            """);
        var client = _factory.CreateAuthedClient();
        var body = new { urls = Urls(4, "https://race.test/") };

        var res = await PostBulk(client, body);
        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.AreEqual("Couldn't make short codes; try again.", (await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title);
        Assert.AreEqual(0, await LinkCountAsync(_factory));

        // The race is over: the same request now succeeds.
        await ExecuteSqlAsync(_factory, "DROP TRIGGER qa_race ON \"Links\"");
        var items = await CreatedAsync(await PostBulk(client, body));
        CollectionAssert.AreEqual(body.urls, items.Select(i => i.Url).ToList());
    }

    [TestMethod]
    public async Task The_response_has_every_field_of_a_single_create()
    {
        var items = await CreatedAsync(await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(1) }));
        var link = items[0];
        Assert.EndsWith("/" + link.Code, link.ShortUrl);
        Assert.AreEqual(link.ShortUrl + "/qr", link.QrCodeUrl);
        Assert.AreEqual(0, link.Clicks);
        Assert.IsNull(link.LastClickedAt);
        Assert.AreEqual(_factory.Time.GetUtcNow().UtcDateTime, link.CreatedAt);
        Assert.AreEqual(DateTimeKind.Utc, link.CreatedAt.Kind);
        Assert.AreEqual(HttpStatusCode.OK, (await _factory.CreateUnauthedClient().GetAsync($"/{link.Code}/qr")).StatusCode);
    }

    [TestMethod]
    public async Task The_response_json_uses_an_items_array()
    {
        var res = await PostBulk(_factory.CreateAuthedClient(), new { urls = Urls(2) });
        Assert.IsNull(res.Headers.Location);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.AreEqual(JsonValueKind.Array, doc.RootElement.GetProperty("items").ValueKind);
        Assert.AreEqual(2, doc.RootElement.GetProperty("items").GetArrayLength());
    }
}
