using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Data;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

/// <summary>Google Safe Browsing check on create, bulk create and edit. Google is always a fake: no test reaches the network.</summary>
[TestClass]
public sealed class SafeBrowsingTests : IDisposable
{
    private const string Key = "sb-secret-KEY-0123456789";
    private const string Bad = "https://evil.example.net/phish";
    private const string Message = "This site is flagged as unsafe by Google Safe Browsing, so it can't be shortened.";
    private const string Route = "/api/links";

    private readonly List<OviApiFactory> _factories = [];

    public void Dispose() { foreach (var f in _factories) f.Dispose(); }

    private OviApiFactory Factory(string? key = Key, Dictionary<string, string?>? extra = null)
    {
        var settings = new Dictionary<string, string?>(extra ?? []);
        if (key is not null) settings["SafeBrowsing:ApiKey"] = key;
        var f = new OviApiFactory(settings);
        _factories.Add(f);
        return f;
    }

    private static async Task<IDictionary<string, string[]>> ErrorsAsync(HttpResponseMessage res)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors;
    }

    private static async Task<int> CountAsync(OviApiFactory f)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Links.IgnoreQueryFilters().CountAsync();
    }

    private static Task<HttpResponseMessage> Post(HttpClient c, string url) => c.PostAsJsonAsync(Route, new CreateLinkRequest(url));

    private static JsonElement Body(SafeBrowsingCall call) => JsonDocument.Parse(call.Body).RootElement;

    // ---- Skipped without a key ----

    [TestMethod]
    public async Task Without_a_key_no_call_is_made_and_the_link_is_created()
    {
        var f = Factory(key: null);
        f.SafeBrowsing.Flag(_ => true);
        var res = await Post(f.CreateUnauthedClient(), Bad);
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode);
        Assert.AreEqual(0, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task A_blank_key_counts_as_missing()
    {
        var f = Factory(key: "  ");
        var res = await Post(f.CreateAuthedClient(), Bad);
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode);
        Assert.AreEqual(0, f.SafeBrowsing.Calls.Count);
    }

    // ---- Single create ----

    [TestMethod]
    public async Task Clean_url_is_created_for_every_kind_of_caller()
    {
        var f = Factory();
        var user = await f.CreateUserClientAsync();
        foreach (var c in new[] { f.CreateUnauthedClient(), user, f.CreateAuthedClient() })
            Assert.AreEqual(HttpStatusCode.Created, (await Post(c, "https://example.com/ok")).StatusCode);
        Assert.AreEqual(3, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task Flagged_url_is_refused_with_the_exact_message_for_every_kind_of_caller()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(u => u == Bad);
        var user = await f.CreateUserClientAsync();
        foreach (var c in new[] { f.CreateUnauthedClient(), user, f.CreateAuthedClient() })
        {
            var errors = await ErrorsAsync(await Post(c, Bad));
            CollectionAssert.AreEqual(new[] { Message }, errors["url"]);
        }
        Assert.AreEqual(0, await CountAsync(f));
    }

    [TestMethod]
    public async Task The_request_to_Google_has_the_key_in_the_query_the_threat_types_and_the_url()
    {
        var f = Factory();
        await Post(f.CreateAuthedClient(), "https://example.com/a?b=1");

        var call = f.SafeBrowsing.Calls.Single();
        Assert.AreEqual("safebrowsing.googleapis.com", call.Uri.Host);
        Assert.AreEqual("/v4/threatMatches:find", call.Uri.AbsolutePath);
        Assert.AreEqual("https", call.Uri.Scheme);
        Assert.AreEqual("?key=" + Key, call.Uri.Query);

        var info = Body(call).GetProperty("threatInfo");
        var types = info.GetProperty("threatTypes").EnumerateArray().Select(e => e.GetString()).ToList();
        foreach (var t in new[] { "MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE" })
            CollectionAssert.Contains(types, t);
        CollectionAssert.AreEqual(new[] { "URL" }, info.GetProperty("threatEntryTypes").EnumerateArray().Select(e => e.GetString()).ToArray());
        CollectionAssert.AreEqual(new[] { "https://example.com/a?b=1" },
            info.GetProperty("threatEntries").EnumerateArray().Select(e => e.GetProperty("url").GetString()).ToArray());
        Assert.IsFalse(call.Body.Contains(Key), "the key belongs in the query only");
    }

    [TestMethod]
    public async Task Existing_validation_runs_first_and_never_calls_Google()
    {
        var f = Factory();
        var c = f.CreateAuthedClient();
        foreach (var url in new[] { "not a url", "ftp://example.com", "http://localhost/abc" })
            Assert.AreEqual(HttpStatusCode.BadRequest, (await Post(c, url)).StatusCode);
        Assert.AreEqual(0, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task A_taken_custom_code_still_reports_the_conflict_for_a_clean_url()
    {
        var f = Factory();
        var c = f.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.Created, (await c.PostAsJsonAsync(Route, new CreateLinkRequest("https://example.com/1", "taken-code"))).StatusCode);
        Assert.AreEqual(HttpStatusCode.Conflict, (await c.PostAsJsonAsync(Route, new CreateLinkRequest("https://example.com/2", "taken-code"))).StatusCode);
    }

    // ---- Fail open ----

    private static IEnumerable<object[]> Failures() =>
    [
        ["timeout"], ["http500"], ["http503"], ["garbage"], ["emptybody"], ["throws"],
    ];

    [TestMethod]
    [DynamicData(nameof(Failures))]
    public async Task Google_failing_lets_the_link_through_and_logs_a_warning_without_the_key(string mode)
    {
        var f = Factory();
        f.SafeBrowsing.Respond = _ => mode switch
        {
            "timeout" => throw new TaskCanceledException("timed out", new TimeoutException()),
            "throws" => throw new HttpRequestException("boom " + Key),
            "http500" => FakeSafeBrowsing.Json("{}", HttpStatusCode.InternalServerError),
            "http503" => FakeSafeBrowsing.Json("{\"error\":\"x\"}", HttpStatusCode.ServiceUnavailable),
            "garbage" => FakeSafeBrowsing.Json("<html>not json"),
            "emptybody" => FakeSafeBrowsing.Json(""),
            _ => FakeSafeBrowsing.Json("{}"),
        };

        var res = await Post(f.CreateAuthedClient(), Bad);

        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.AreEqual(1, await CountAsync(f));
        Assert.IsTrue(f.Logs.Entries.Any(e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning && e.Category == "Ovi.Api.Security.SafeBrowsingUrlThreatCheck"),
            "expected a Warning from the Safe Browsing code");
        Assert.IsFalse(f.Logs.Entries.Any(e => e.Text.Contains(Key)), "the key must never be logged");
        Assert.IsFalse((await res.Content.ReadAsStringAsync()).Contains(Key));
    }

    [TestMethod]
    public async Task A_match_without_a_threat_url_is_not_a_flag()
    {
        var f = Factory();
        f.SafeBrowsing.Respond = _ => FakeSafeBrowsing.Json("{\"matches\":[{\"threat\":null},{}]}");
        Assert.AreEqual(HttpStatusCode.Created, (await Post(f.CreateAuthedClient(), Bad)).StatusCode);
    }

    [TestMethod]
    public async Task Flagged_and_failing_responses_and_logs_never_contain_the_key()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(_ => true);
        var res = await Post(f.CreateAuthedClient(), Bad);
        Assert.IsFalse((await res.Content.ReadAsStringAsync()).Contains(Key));
        foreach (var h in res.Headers) Assert.IsFalse(string.Join(",", h.Value).Contains(Key));
        Assert.IsFalse(f.Logs.Entries.Any(e => e.Text.Contains(Key)));
    }

    // ---- Rate limit: a flagged attempt still costs budget ----

    [TestMethod]
    public async Task Flagged_attempts_use_the_create_budget_so_the_check_is_not_a_free_oracle()
    {
        var f = Factory(extra: new() { ["RateLimits:CreatePerMinute"] = "3" });
        f.SafeBrowsing.Flag(u => u == Bad);
        var c = f.CreateAuthedClient();
        for (var i = 0; i < 3; i++) Assert.AreEqual(HttpStatusCode.BadRequest, (await Post(c, Bad)).StatusCode);

        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await Post(c, Bad)).StatusCode);
        Assert.AreEqual(3, f.SafeBrowsing.Calls.Count, "no Google call once the budget is gone");
    }

    [TestMethod]
    public async Task Anonymous_flagged_attempts_use_the_anonymous_budget()
    {
        var f = Factory(extra: new() { ["RateLimits:AnonymousCreatePerHour"] = "2" });
        f.SafeBrowsing.Flag(_ => true);
        var c = f.CreateUnauthedClient();
        Assert.AreEqual(HttpStatusCode.BadRequest, (await Post(c, Bad)).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await Post(c, Bad)).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await Post(c, Bad)).StatusCode);
        Assert.AreEqual(2, f.SafeBrowsing.Calls.Count);
    }

    // ---- Bulk ----

    private static Task<HttpResponseMessage> Bulk(HttpClient c, params string[] urls) =>
        c.PostAsJsonAsync(Route + "/bulk", new BulkCreateLinksRequest(urls.ToList<string?>()));

    [TestMethod]
    public async Task Bulk_with_one_flagged_line_creates_nothing_reports_that_line_and_calls_Google_once()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(u => u == Bad);
        var c = await f.CreateUserClientAsync();

        var errors = await ErrorsAsync(await Bulk(c, "https://example.com/1", Bad, "https://example.com/3"));

        CollectionAssert.AreEqual(new[] { "urls[1]" }, errors.Keys.ToArray());
        CollectionAssert.AreEqual(new[] { Message }, errors["urls[1]"]);
        Assert.AreEqual(0, await CountAsync(f));
        var call = f.SafeBrowsing.Calls.Single();
        var sent = Body(call).GetProperty("threatInfo").GetProperty("threatEntries").EnumerateArray().Select(e => e.GetProperty("url").GetString()).ToArray();
        CollectionAssert.AreEqual(new[] { "https://example.com/1", Bad, "https://example.com/3" }, sent);
    }

    [TestMethod]
    public async Task Bulk_reports_every_flagged_line_and_the_items_shape_uses_item_keys()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(u => u.Contains("evil"));
        var c = await f.CreateUserClientAsync();
        var res = await c.PostAsJsonAsync(Route + "/bulk", new BulkCreateLinksRequest(null, null,
            [new("https://evil.example.net/1"), new("https://example.com/ok"), new("https://evil.example.net/2", "my-code")]));
        var errors = await ErrorsAsync(res);
        CollectionAssert.AreEquivalent(new[] { "items[0].url", "items[2].url" }, errors.Keys.ToArray());
        Assert.AreEqual(1, f.SafeBrowsing.Calls.Count);
        Assert.AreEqual(0, await CountAsync(f));
    }

    [TestMethod]
    public async Task Bulk_clean_creates_everything_with_one_Google_call()
    {
        var f = Factory();
        var c = await f.CreateUserClientAsync();
        Assert.AreEqual(HttpStatusCode.Created, (await Bulk(c, "https://example.com/1", "https://example.com/2")).StatusCode);
        Assert.AreEqual(1, f.SafeBrowsing.Calls.Count);
        Assert.AreEqual(2, await CountAsync(f));
    }

    [TestMethod]
    public async Task Bulk_with_a_validation_error_does_not_call_Google()
    {
        var f = Factory();
        var c = await f.CreateUserClientAsync();
        var errors = await ErrorsAsync(await Bulk(c, "https://example.com/1", "not a url"));
        CollectionAssert.AreEqual(new[] { "urls[1]" }, errors.Keys.ToArray());
        Assert.AreEqual(0, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task Bulk_flagged_batch_uses_the_budget_one_permit_per_url()
    {
        var f = Factory(extra: new() { ["RateLimits:CreatePerMinute"] = "4" });
        f.SafeBrowsing.Flag(_ => true);
        var c = await f.CreateUserClientAsync();
        await ErrorsAsync(await Bulk(c, "https://example.com/1", "https://example.com/2", "https://example.com/3"));
        // 3 of 4 permits are gone; a second batch of 3 is over budget, and Google is not asked again.
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await Bulk(c, "https://example.com/4", "https://example.com/5", "https://example.com/6")).StatusCode);
        Assert.AreEqual(1, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task Bulk_fails_open_when_Google_errors()
    {
        var f = Factory();
        f.SafeBrowsing.Respond = _ => FakeSafeBrowsing.Json("{}", HttpStatusCode.BadGateway);
        var c = await f.CreateUserClientAsync();
        Assert.AreEqual(HttpStatusCode.Created, (await Bulk(c, "https://example.com/1", "https://example.com/2")).StatusCode);
        Assert.AreEqual(2, await CountAsync(f));
    }

    [TestMethod]
    public async Task Bulk_without_a_key_makes_no_call()
    {
        var f = Factory(key: null);
        var c = await f.CreateUserClientAsync();
        Assert.AreEqual(HttpStatusCode.Created, (await Bulk(c, "https://example.com/1")).StatusCode);
        Assert.AreEqual(0, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task Bulk_at_the_maximum_size_sends_all_urls_in_one_request()
    {
        var f = Factory();
        var c = await f.CreateUserClientAsync();
        var urls = Enumerable.Range(0, LinkEndpoints.MaxBulkUrls).Select(i => $"https://example.com/{i}").ToArray();
        Assert.AreEqual(HttpStatusCode.Created, (await Bulk(c, urls)).StatusCode);
        var call = f.SafeBrowsing.Calls.Single();
        Assert.AreEqual(urls.Length, Body(call).GetProperty("threatInfo").GetProperty("threatEntries").GetArrayLength());
    }

    [TestMethod]
    public async Task Bulk_over_the_maximum_is_refused_before_Google()
    {
        var f = Factory();
        var c = await f.CreateUserClientAsync();
        var urls = Enumerable.Range(0, LinkEndpoints.MaxBulkUrls + 1).Select(i => $"https://example.com/{i}").ToArray();
        await ErrorsAsync(await Bulk(c, urls));
        Assert.AreEqual(0, f.SafeBrowsing.Calls.Count);
    }

    // ---- PATCH ----

    private async Task<(OviApiFactory F, HttpClient Admin)> WithLinkAsync(string code = "patchme")
    {
        var f = Factory();
        var admin = f.CreateAuthedClient();
        Assert.AreEqual(HttpStatusCode.Created, (await admin.PostAsJsonAsync(Route, new CreateLinkRequest("https://example.com/start", code))).StatusCode);
        f.SafeBrowsing.Calls.ToList(); // creation made one call; tests below compare against it
        return (f, admin);
    }

    [TestMethod]
    public async Task Patch_to_a_flagged_url_is_refused_and_the_link_is_unchanged()
    {
        var (f, admin) = await WithLinkAsync();
        f.SafeBrowsing.Flag(u => u == Bad);
        var res = await admin.PatchAsJsonAsync($"{Route}/patchme", new { url = Bad });
        CollectionAssert.AreEqual(new[] { Message }, (await ErrorsAsync(res))["url"]);

        using var scope = f.Services.CreateScope();
        var link = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Links.SingleAsync(l => l.Code == "patchme");
        Assert.AreEqual("https://example.com/start", link.Url);
    }

    [TestMethod]
    public async Task Patch_to_a_clean_url_sends_the_new_url_to_Google()
    {
        var (f, admin) = await WithLinkAsync();
        var before = f.SafeBrowsing.Calls.Count;
        var res = await admin.PatchAsJsonAsync($"{Route}/patchme", new { url = "https://example.com/new" });
        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        var call = f.SafeBrowsing.Calls.Skip(before).Single();
        Assert.AreEqual("https://example.com/new",
            Body(call).GetProperty("threatInfo").GetProperty("threatEntries")[0].GetProperty("url").GetString());
    }

    [TestMethod]
    public async Task Patch_that_does_not_change_the_url_makes_no_call_even_when_the_site_is_now_flagged()
    {
        var (f, admin) = await WithLinkAsync();
        var before = f.SafeBrowsing.Calls.Count;
        f.SafeBrowsing.Flag(_ => true);
        var later = f.Time.GetUtcNow().AddDays(3);

        Assert.AreEqual(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"{Route}/patchme", new { expiresAt = later })).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"{Route}/patchme", new { clearExpiry = true })).StatusCode);
        Assert.AreEqual(before, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task Patch_with_an_invalid_url_does_not_call_Google()
    {
        var (f, admin) = await WithLinkAsync();
        var before = f.SafeBrowsing.Calls.Count;
        Assert.AreEqual(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"{Route}/patchme", new { url = "ftp://x" })).StatusCode);
        Assert.AreEqual(before, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task Patch_fails_open_when_Google_errors()
    {
        var (f, admin) = await WithLinkAsync();
        f.SafeBrowsing.Respond = _ => FakeSafeBrowsing.Json("nope", HttpStatusCode.InternalServerError);
        Assert.AreEqual(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"{Route}/patchme", new { url = "https://example.com/other" })).StatusCode);
    }

    [TestMethod]
    public async Task Patch_flagged_attempt_uses_budget()
    {
        var f = Factory(extra: new() { ["RateLimits:CreatePerMinute"] = "2" });
        var admin = f.CreateAuthedClient();
        await admin.PostAsJsonAsync(Route, new CreateLinkRequest("https://example.com/start", "patchme")); // permit 1
        f.SafeBrowsing.Flag(u => u == Bad);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"{Route}/patchme", new { url = Bad })).StatusCode); // permit 2
        var calls = f.SafeBrowsing.Calls.Count;
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await admin.PatchAsJsonAsync($"{Route}/patchme", new { url = Bad })).StatusCode);
        Assert.AreEqual(calls, f.SafeBrowsing.Calls.Count);
    }

    // ---- Break it ----

    [TestMethod]
    public async Task Google_reporting_a_differently_normalised_url_still_flags_the_link()
    {
        // Google canonicalises (lowercases the host, drops the fragment, adds a trailing slash). The app must not
        // compare strings against what it sent; any match at all means flagged.
        var f = Factory();
        f.SafeBrowsing.Flag(_ => true, reported: u => "http://evil.example.net/phish/");
        var res = await Post(f.CreateAuthedClient(), "https://EVIL.example.net/phish#frag");
        CollectionAssert.AreEqual(new[] { Message }, (await ErrorsAsync(res))["url"]);
    }

    [TestMethod]
    public async Task Bulk_with_a_differently_normalised_match_flags_some_line_and_creates_nothing()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(u => u.Contains("evil"), reported: _ => "http://evil.example.net/");
        var c = await f.CreateUserClientAsync();
        var res = await Bulk(c, "https://example.com/1", "https://EVIL.example.net/x#f");
        var errors = await ErrorsAsync(res);
        CollectionAssert.AreEqual(new[] { "urls[1]" }, errors.Keys.ToArray());
        CollectionAssert.AreEqual(new[] { Message }, errors["urls[1]"]);
        Assert.AreEqual(0, await CountAsync(f));
    }

    private const string Ours = "Ovi.Api.Security.SafeBrowsingUrlThreatCheck";

    [TestMethod]
    public async Task Bulk_items_with_a_differently_normalised_match_flags_only_that_item()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(u => u.Contains("evil"), reported: _ => "http://evil.example.net/");
        var c = await f.CreateUserClientAsync();
        var res = await c.PostAsJsonAsync(Route + "/bulk", new BulkCreateLinksRequest(null, null,
            [new("https://example.com/1"), new("https://EVIL.example.net/x#f", "my-code")]));
        var errors = await ErrorsAsync(res);
        CollectionAssert.AreEqual(new[] { "items[1].url" }, errors.Keys.ToArray());
        Assert.AreEqual(0, await CountAsync(f));
    }

    [TestMethod]
    public async Task Bulk_same_host_and_path_different_query_flags_only_the_exact_match()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(u => u == "https://a.com/x?id=1");
        var c = await f.CreateUserClientAsync();
        var errors = await ErrorsAsync(await Bulk(c, "https://a.com/x?id=2", "https://a.com/x?id=1", "https://a.com/x?id=3"));
        CollectionAssert.AreEqual(new[] { "urls[1]" }, errors.Keys.ToArray());
    }

    [TestMethod]
    public async Task Bulk_exact_match_on_one_path_leaves_a_clean_sibling_path_alone()
    {
        var f = Factory();
        f.SafeBrowsing.Flag(u => u == "https://a.com/x");
        var c = await f.CreateUserClientAsync();
        var errors = await ErrorsAsync(await Bulk(c, "https://a.com/y", "https://a.com/x"));
        CollectionAssert.AreEqual(new[] { "urls[1]" }, errors.Keys.ToArray());
    }

    [TestMethod]
    public async Task Bulk_with_a_match_that_fits_no_line_fails_closed()
    {
        var f = Factory();
        f.SafeBrowsing.Respond = _ => FakeSafeBrowsing.Json("{\"matches\":[{\"threat\":{\"url\":\"http://unrelated.example.org/zzz\"}}]}");
        var c = await f.CreateUserClientAsync();
        var res = await Bulk(c, "https://example.com/1", "https://example.com/2");
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.AreEqual(0, await CountAsync(f));
    }

    // ---- Timeout setting and Google refusing us ----

    [TestMethod]
    public async Task A_real_timeout_lets_the_link_through_with_a_warning()
    {
        var f = Factory(extra: new() { ["SafeBrowsing:TimeoutSeconds"] = "1" });
        f.SafeBrowsing.RespondAsync = async (_, ct) => { await Task.Delay(Timeout.Infinite, ct); return FakeSafeBrowsing.Json("{}"); };
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var res = await Post(f.CreateAuthedClient(), Bad);
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.IsLessThan(10_000, sw.ElapsedMilliseconds, "the 1 second timeout must apply");
        Assert.IsTrue(f.Logs.Entries.Any(e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning && e.Category == Ours));
    }

    [TestMethod]
    [DataRow("abc")]
    [DataRow("")]
    [DataRow("-5")]
    [DataRow("0")]
    public async Task A_bad_timeout_setting_does_not_break_creating_links(string value)
    {
        var f = Factory(extra: new() { ["SafeBrowsing:TimeoutSeconds"] = value });
        var res = await Post(f.CreateAuthedClient(), "https://example.com/ok");
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
    }

    [TestMethod]
    [DataRow(HttpStatusCode.TooManyRequests)]
    [DataRow(HttpStatusCode.Forbidden)]
    public async Task Google_refusing_our_key_or_quota_creates_the_link_and_logs_an_error_without_the_key(HttpStatusCode status)
    {
        var f = Factory();
        f.SafeBrowsing.Respond = _ => FakeSafeBrowsing.Json("{\"error\":{\"message\":\"key " + Key + " rejected\"}}", status);
        var res = await Post(f.CreateAuthedClient(), Bad);
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode);
        Assert.IsTrue(f.Logs.Entries.Any(e => e.Level == Microsoft.Extensions.Logging.LogLevel.Error && e.Category == Ours),
            "429/403 mean our setup is broken, so log at Error");
        Assert.IsFalse(f.Logs.Entries.Any(e => e.Text.Contains(Key)));
        Assert.IsFalse((await res.Content.ReadAsStringAsync()).Contains(Key));
    }

    [TestMethod]
    public async Task Google_500_stays_a_warning_not_an_error()
    {
        var f = Factory();
        f.SafeBrowsing.Respond = _ => FakeSafeBrowsing.Json("{}", HttpStatusCode.InternalServerError);
        await Post(f.CreateAuthedClient(), Bad);
        var ours = f.Logs.Entries.Where(e => e.Category == Ours).ToList();
        Assert.IsTrue(ours.Any(e => e.Level == Microsoft.Extensions.Logging.LogLevel.Warning));
        Assert.IsFalse(ours.Any(e => e.Level >= Microsoft.Extensions.Logging.LogLevel.Error));
    }

    [TestMethod]
    [DataRow("https://bücher.example/straße")]
    [DataRow("https://xn--bcher-kva.example/")]
    [DataRow("https://例え.jp/パス?q=日本語")]
    [DataRow("https://example.com/a%20b?x=%E2%9C%93")]
    public async Task Unicode_and_punycode_urls_are_checked_and_the_key_survives(string url)
    {
        var f = Factory();
        var res = await Post(f.CreateAuthedClient(), url);
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        var call = f.SafeBrowsing.Calls.Single();
        Assert.AreEqual("?key=" + Key, call.Uri.Query);
        Assert.AreEqual(1, Body(call).GetProperty("threatInfo").GetProperty("threatEntries").GetArrayLength());
    }

    [TestMethod]
    public async Task A_key_with_reserved_characters_is_escaped_in_the_query()
    {
        var f = Factory(key: "a&b=c d+e");
        await Post(f.CreateAuthedClient(), "https://example.com/");
        var q = f.SafeBrowsing.Calls.Single().Uri.Query;
        Assert.AreEqual("a&b=c d+e", System.Web.HttpUtility.ParseQueryString(q)["key"]);
    }

    [TestMethod]
    public async Task A_url_with_json_special_characters_is_sent_as_valid_json()
    {
        var f = Factory();
        var url = "https://example.com/\"quote\\back?x=<>&y='";
        var res = await Post(f.CreateAuthedClient(), url);
        if (res.StatusCode == HttpStatusCode.Created) Assert.AreEqual(1, f.SafeBrowsing.Calls.Count);
        foreach (var call in f.SafeBrowsing.Calls) JsonDocument.Parse(call.Body);
    }

    [TestMethod]
    public async Task A_maximum_length_url_is_checked_once()
    {
        var f = Factory();
        var url = "https://example.com/" + new string('a', LinkEndpoints.MaxUrlLength - "https://example.com/".Length);
        Assert.AreEqual(HttpStatusCode.Created, (await Post(f.CreateAuthedClient(), url)).StatusCode);
        Assert.AreEqual(1, f.SafeBrowsing.Calls.Count);
    }

    [TestMethod]
    public async Task Concurrent_creates_each_get_their_own_check()
    {
        var f = Factory();
        var c = f.CreateAuthedClient();
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => Post(c, $"https://example.com/{i}")));
        Assert.IsTrue(results.All(r => r.StatusCode == HttpStatusCode.Created));
        Assert.AreEqual(10, f.SafeBrowsing.Calls.Count);
    }
}
