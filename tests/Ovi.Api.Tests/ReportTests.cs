using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Data;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

/// <summary>Report a link (POST /api/reports) and the admin queue (GET /api/admin/reports, POST .../resolve).</summary>
[TestClass]
public sealed class ReportTests : IDisposable
{
    private readonly OviApiFactory _factory = new(new()
    {
        ["Auth:AdminEmails"] = "boss@example.com",
        ["RateLimits:ReportPerHour"] = "1000",
    });

    public void Dispose() => _factory.Dispose();

    private const string LinkError = "Enter an Ovi short link or its code.";
    private const string ReasonError = "Choose a reason.";
    private const string DetailsError = "Keep the details under 500 characters.";

    // ---- helpers ----

    private static async Task<LinkResponse> CreateAsync(HttpClient client, string url, string? code = null, DateTimeOffset? expiresAt = null)
    {
        var res = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest(url, code, expiresAt));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
    }

    /// <summary>Posts a report the way the web UI does (with X-Ovi-Request) unless <paramref name="csrf"/> is false.</summary>
    private static Task<HttpResponseMessage> ReportAsync(HttpClient client, string? link, string? reason = "spam", string? details = null, bool csrf = true)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/reports") { Content = JsonContent.Create(new { link, reason, details }) };
        if (csrf && !client.DefaultRequestHeaders.Contains(Ovi.Api.Security.CallerFilter.CsrfHeader))
            req.Headers.Add(Ovi.Api.Security.CallerFilter.CsrfHeader, "1");
        return client.SendAsync(req);
    }

    private static Task<HttpResponseMessage> RawReportAsync(HttpClient client, string body)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/reports") { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
        req.Headers.Add(Ovi.Api.Security.CallerFilter.CsrfHeader, "1");
        return client.SendAsync(req);
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage res)
    {
        var text = await res.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    private static async Task<Dictionary<string, string[]>> ErrorsAsync(HttpResponseMessage res)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, await res.Content.ReadAsStringAsync());
        var json = await JsonAsync(res);
        return json.GetProperty("errors").EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.EnumerateArray().Select(e => e.GetString()!).ToArray());
    }

    private async Task<JsonElement> QueueAsync(string query = "")
    {
        var res = await _factory.CreateAuthedClient().GetAsync("/api/admin/reports" + query);
        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode, await res.Content.ReadAsStringAsync());
        return await JsonAsync(res);
    }

    private async Task<List<LinkReport>> StoredAsync(string code)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var id = await db.Links.IgnoreQueryFilters().Where(l => l.Code == code).Select(l => l.Id).SingleAsync();
        return await db.Set<LinkReport>().AsNoTracking().Where(r => r.LinkId == id).OrderBy(r => r.Id).ToListAsync();
    }

    private async Task<HttpClient> AdminAsync() => await _factory.CreateUserClientAsync("boss");

    // ---- Reporting: success ----

    [TestMethod]
    public async Task Anyone_can_report_a_code_with_202_and_an_empty_body()
    {
        var link = await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/bad", "bad1");
        var res = await ReportAsync(_factory.CreateUnauthedClient(), link.Code, "phishing", "Fake bank login");

        Assert.AreEqual(HttpStatusCode.Accepted, res.StatusCode);
        Assert.AreEqual("", await res.Content.ReadAsStringAsync());
        var stored = await StoredAsync("bad1");
        Assert.HasCount(1, stored);
        Assert.AreEqual("phishing", stored[0].Reason);
        Assert.AreEqual("Fake bank login", stored[0].Details);
        Assert.IsNull(stored[0].ResolvedAt);
        Assert.IsNull(stored[0].Resolution);
        Assert.AreEqual(_factory.Time.GetUtcNow().UtcDateTime, stored[0].CreatedAt);
    }

    [TestMethod]
    [DataRow("phishing")]
    [DataRow("malware")]
    [DataRow("spam")]
    [DataRow("other")]
    public async Task Every_listed_reason_is_accepted(string reason)
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "reas");
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "reas", reason)).StatusCode);
        Assert.AreEqual(reason, (await StoredAsync("reas")).Single().Reason);
    }

    [TestMethod]
    public async Task A_full_short_url_on_ovis_own_host_works_like_a_code()
    {
        var link = await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "full1");
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), link.ShortUrl)).StatusCode);
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "  " + link.ShortUrl + "  ")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "  full1  ")).StatusCode);
        Assert.HasCount(3, await StoredAsync("full1"));
    }

    [TestMethod]
    public async Task A_url_on_another_host_is_a_link_error_even_with_a_real_code()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "real1");
        foreach (var link in new[] { "https://evil.example/real1", "https://real1.example/real1", "https://localhost.evil.example/real1" })
        {
            var errors = await ErrorsAsync(await ReportAsync(_factory.CreateUnauthedClient(), link));
            CollectionAssert.AreEqual(new[] { LinkError }, errors["link"], link);
        }
        Assert.IsEmpty(await StoredAsync("real1"));
    }

    [TestMethod]
    public async Task Expired_links_can_still_be_reported()
    {
        var link = await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "old1", _factory.Time.GetUtcNow().AddMinutes(5));
        _factory.Time.Advance(TimeSpan.FromMinutes(5)); // expires exactly now
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), link.Code)).StatusCode);
        _factory.Time.Advance(TimeSpan.FromDays(3));
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), link.Code)).StatusCode);
        Assert.HasCount(2, await StoredAsync("old1"));
    }

    [TestMethod]
    public async Task Links_of_a_suspended_owner_can_still_be_reported()
    {
        var owner = await _factory.CreateUserClientAsync("spammer");
        await CreateAsync(owner, "https://example.com/x", "susp1");
        var users = await _factory.CreateAuthedClient().GetFromJsonAsync<PagedResponse<Ovi.Api.Admin.AdminUser>>("/api/admin/users?q=spammer");
        var id = users!.Items.Single().Id;
        Assert.AreEqual(HttpStatusCode.NoContent, (await _factory.CreateAuthedClient().PostAsync($"/api/admin/users/{id}/block", null)).StatusCode);

        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "susp1")).StatusCode);
    }

    [TestMethod]
    public async Task Signed_in_users_and_the_api_key_can_report_too()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "who1");
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(await _factory.CreateUserClientAsync("rep"), "who1")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateAuthedClient(), "who1")).StatusCode);
    }

    // ---- Reporting: not found ----

    [TestMethod]
    public async Task An_unknown_code_is_404_with_a_friendly_title()
    {
        var res = await ReportAsync(_factory.CreateUnauthedClient(), "nope123");
        Assert.AreEqual(HttpStatusCode.NotFound, res.StatusCode);
        Assert.AreEqual("We couldn't find that Ovi link.", (await JsonAsync(res)).GetProperty("title").GetString());
    }

    [TestMethod]
    public async Task A_deleted_link_is_404_and_nothing_is_stored()
    {
        var owner = await _factory.CreateUserClientAsync("ada");
        await CreateAsync(owner, "https://example.com/x", "gone1");
        Assert.AreEqual(HttpStatusCode.NoContent, (await owner.DeleteAsync("/api/links/gone1")).StatusCode);

        Assert.AreEqual(HttpStatusCode.NotFound, (await ReportAsync(_factory.CreateUnauthedClient(), "gone1")).StatusCode);
        Assert.IsEmpty(await StoredAsync("gone1"));
    }

    // ---- Reporting: validation ----

    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   ")]
    [DataRow("not a code")]
    [DataRow("javascript:alert(1)")]
    [DataRow("ftp://localhost/abc")]
    [DataRow("https://")]
    [DataRow("../etc/passwd")]
    [DataRow("a\u0000b")]
    [DataRow("ab‮cd")]
    public async Task A_bad_link_is_a_link_error(string? link)
    {
        var errors = await ErrorsAsync(await ReportAsync(_factory.CreateUnauthedClient(), link));
        CollectionAssert.AreEqual(new[] { LinkError }, errors["link"]);
        Assert.IsFalse(errors.ContainsKey("reason"));
    }

    [TestMethod]
    public async Task A_very_long_link_is_a_link_error_not_a_500()
    {
        var errors = await ErrorsAsync(await ReportAsync(_factory.CreateUnauthedClient(), new string('a', 5000)));
        CollectionAssert.AreEqual(new[] { LinkError }, errors["link"]);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   ")]
    [DataRow("bogus")]
    [DataRow("phishing,spam")]
    public async Task A_bad_reason_is_a_reason_error(string? reason)
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "val1");
        var errors = await ErrorsAsync(await ReportAsync(_factory.CreateUnauthedClient(), "val1", reason));
        CollectionAssert.AreEqual(new[] { ReasonError }, errors["reason"]);
        Assert.IsEmpty(await StoredAsync("val1"));
    }

    [TestMethod]
    public async Task All_field_errors_come_back_together()
    {
        var errors = await ErrorsAsync(await ReportAsync(_factory.CreateUnauthedClient(), "", "", new string('x', 501)));
        CollectionAssert.AreEqual(new[] { LinkError }, errors["link"]);
        CollectionAssert.AreEqual(new[] { ReasonError }, errors["reason"]);
        CollectionAssert.AreEqual(new[] { DetailsError }, errors["details"]);
    }

    [TestMethod]
    public async Task Details_are_trimmed_and_limited_to_500_characters()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "det1");
        var anon = _factory.CreateUnauthedClient();

        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "det1", "spam", new string('a', 500))).StatusCode);
        // 500 characters after trimming is fine even if the raw text is longer.
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "det1", "spam", "  " + new string('b', 500) + "\n ")).StatusCode);
        var errors = await ErrorsAsync(await ReportAsync(anon, "det1", "spam", new string('c', 501)));
        CollectionAssert.AreEqual(new[] { DetailsError }, errors["details"]);

        var stored = await StoredAsync("det1");
        Assert.HasCount(2, stored);
        Assert.AreEqual(new string('a', 500), stored[0].Details);
        Assert.AreEqual(new string('b', 500), stored[1].Details);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   \n\t ")]
    public async Task Empty_details_are_stored_as_null(string? details)
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "nul1");
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "nul1", "other", details)).StatusCode);
        Assert.IsNull((await StoredAsync("nul1")).Single().Details);
    }

    [TestMethod]
    [DataRow("bell\u0007")]
    [DataRow("null\u0000byte")]
    [DataRow("reversed ‮ text")]
    [DataRow("isolate ⁦ text")]
    public async Task Control_and_bidi_characters_in_details_are_rejected(string details)
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "ctl1");
        var errors = await ErrorsAsync(await ReportAsync(_factory.CreateUnauthedClient(), "ctl1", "spam", details));
        CollectionAssert.AreEqual(new[] { "The details contain characters that can't be saved." }, errors["details"]);
        Assert.IsEmpty(await StoredAsync("ctl1"));
    }

    [TestMethod]
    [DataRow("line one\nline two", "line one\nline two")]
    [DataRow("line one\r\nline two", "line one\nline two")]
    [DataRow("line one\rline two", "line one\nline two")]
    [DataRow("a\n\nb", "a\n\nb")]
    [DataRow("col1\tcol2", "col1\tcol2")]
    public async Task Newlines_and_tabs_inside_details_are_accepted_and_line_breaks_stored_as_LF(string details, string expected)
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "nl1");
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "nl1", "spam", details)).StatusCode);
        Assert.AreEqual(expected, (await StoredAsync("nl1")).Single().Details);
    }

    [TestMethod]
    public async Task The_500_character_limit_counts_after_line_breaks_are_normalised()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "nl2");
        var anon = _factory.CreateUnauthedClient();
        var fits = new string('a', 499) + "\r\n" + "b"; // 502 raw, 501 normalised: rejected
        var errors = await ErrorsAsync(await ReportAsync(anon, "nl2", "spam", fits));
        CollectionAssert.AreEqual(new[] { DetailsError }, errors["details"]);

        var crlf = string.Concat(Enumerable.Repeat("\r\n", 250)); // 500 raw, 250 normalised: accepted either way
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "nl2", "spam", "x" + crlf)).StatusCode);
        // 498 chars + CRLF + 1 = 501 raw but 500 normalised: accepted only if the limit applies after normalising.
        var edge = new string('a', 498) + "\r\n" + "b";
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "nl2", "spam", edge)).StatusCode);
        var stored = await StoredAsync("nl2");
        Assert.AreEqual(500, stored[^1].Details!.Length);
        Assert.AreEqual(new string('a', 498) + "\nb", stored[^1].Details);
    }

    [TestMethod]
    public async Task Unicode_details_are_stored_as_written()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "uni1");
        var text = "Phishing: éè 日本語 مرحبا \U0001F600";
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "uni1", "phishing", text)).StatusCode);
        Assert.AreEqual(text, (await StoredAsync("uni1")).Single().Details);

        // 500 CJK characters fit.
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "uni1", "phishing", new string('日', 500))).StatusCode);
    }

    [TestMethod]
    public async Task Details_are_data_not_markup_and_come_back_unchanged()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "xss1");
        const string text = "<script>alert(1)</script> & \"quotes\"";
        await ReportAsync(_factory.CreateUnauthedClient(), "xss1", "spam", text);
        var item = (await QueueAsync()).GetProperty("items")[0];
        Assert.AreEqual(text, item.GetProperty("details")[0].GetString());
    }

    [TestMethod]
    public async Task A_missing_or_malformed_body_is_400_not_500()
    {
        var anon = _factory.CreateUnauthedClient();
        Assert.AreEqual(HttpStatusCode.BadRequest, (await RawReportAsync(anon, "")).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await RawReportAsync(anon, "{nope")).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await RawReportAsync(anon, "{\"link\":5,\"reason\":[]}")).StatusCode);
    }

    // ---- CSRF ----

    [TestMethod]
    public async Task Reports_without_the_ovi_request_header_are_403_for_everyone()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "csrf0");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await ReportAsync(_factory.CreateUnauthedClient(), "csrf0", csrf: false)).StatusCode);
        Assert.IsEmpty(await StoredAsync("csrf0"));
    }

    [TestMethod]
    public async Task Reason_is_trimmed_and_case_insensitive_and_stored_lowercase()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "case1");
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(_factory.CreateUnauthedClient(), "case1", " Phishing ")).StatusCode);
        Assert.AreEqual("phishing", (await StoredAsync("case1")).Single().Reason);
    }

    [TestMethod]
    public async Task A_signed_in_cookie_caller_needs_the_ovi_request_header()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "csrf1");
        var noHeader = await _factory.CreateUserClientAsync("nohdr", csrfHeader: false);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await ReportAsync(noHeader, "csrf1", csrf: false)).StatusCode);
        Assert.IsEmpty(await StoredAsync("csrf1"));

        var withHeader = await _factory.CreateUserClientAsync("withhdr");
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(withHeader, "csrf1")).StatusCode);
    }

    // ---- Rate limit ----

    [TestMethod]
    public async Task Reports_are_limited_to_10_an_hour_per_client_by_default()
    {
        using var factory = new OviApiFactory(null, IPAddress.Parse("203.0.113.20"));
        await CreateAsync(factory.CreateAuthedClient(), "https://example.com/x", "lim1");
        var anon = factory.CreateUnauthedClient();
        for (var i = 0; i < 10; i++)
            Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "lim1")).StatusCode, $"report {i + 1}");
        var refused = await ReportAsync(anon, "lim1");
        Assert.AreEqual(HttpStatusCode.TooManyRequests, refused.StatusCode);
    }

    [TestMethod]
    public async Task The_report_limit_is_configurable_per_client_and_counts_invalid_requests()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:ReportPerHour"] = "3" }, IPAddress.Parse("203.0.113.21"));
        await CreateAsync(factory.CreateAuthedClient(), "https://example.com/x", "lim2");
        var anon = factory.CreateUnauthedClient();
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "lim2")).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await ReportAsync(anon, "")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await ReportAsync(anon, "missing")).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await ReportAsync(anon, "lim2")).StatusCode);
        Assert.HasCount(1, await StoredAsync2(factory, "lim2"));
    }

    [TestMethod]
    public async Task Reporting_does_not_use_up_the_redirect_or_create_budgets_and_vice_versa()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:ReportPerHour"] = "1" }, IPAddress.Parse("203.0.113.22"));
        await CreateAsync(factory.CreateAuthedClient(), "https://example.com/x", "lim3");
        var anon = factory.CreateUnauthedClient();
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "lim3")).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await ReportAsync(anon, "lim3")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Redirect, (await anon.GetAsync("/lim3")).StatusCode);
    }

    private static async Task<List<LinkReport>> StoredAsync2(OviApiFactory factory, string code)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var id = await db.Links.IgnoreQueryFilters().Where(l => l.Code == code).Select(l => l.Id).SingleAsync();
        return await db.Set<LinkReport>().AsNoTracking().Where(r => r.LinkId == id).ToListAsync();
    }

    // ---- The 50-open-reports cap ----

    [TestMethod]
    public async Task At_most_50_open_reports_are_stored_per_link_but_the_rest_still_get_202()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "cap1");
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/y", "cap2");
        var anon = _factory.CreateUnauthedClient();
        for (var i = 0; i < 55; i++)
            Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "cap1", "spam", "n" + i)).StatusCode, $"report {i + 1}");

        Assert.HasCount(50, await StoredAsync("cap1"));
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "cap2")).StatusCode, "another link is unaffected");
        Assert.HasCount(1, await StoredAsync("cap2"));

        var item = (await QueueAsync()).GetProperty("items").EnumerateArray().Single(i => i.GetProperty("code").GetString() == "cap1");
        Assert.AreEqual(50, item.GetProperty("openReports").GetInt32());
    }

    [TestMethod]
    public async Task Resolving_frees_the_cap_because_only_open_reports_count()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "cap3");
        var anon = _factory.CreateUnauthedClient();
        for (var i = 0; i < 50; i++) await ReportAsync(anon, "cap3");
        Assert.AreEqual(HttpStatusCode.NoContent, (await ResolveAsync("cap3", "dismissed")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Accepted, (await ReportAsync(anon, "cap3")).StatusCode);
        Assert.HasCount(51, await StoredAsync("cap3"));
    }

    // ---- Privacy ----

    [TestMethod]
    public void A_report_row_has_no_column_that_could_identify_the_reporter()
    {
        var names = typeof(LinkReport).GetProperties().Select(p => p.Name).Order().ToArray();
        var allowed = new[] { "CreatedAt", "Details", "Id", "LinkId", "Reason", "ResolvedAt", "Resolution" };
        CollectionAssert.AreEquivalent(allowed, names, "LinkReport may only hold what the contract lists (no IP, user agent or user id).");

        using var scope = _factory.Services.CreateScope();
        var entity = scope.ServiceProvider.GetRequiredService<AppDbContext>().Model.FindEntityType(typeof(LinkReport))!;
        var columns = entity.GetProperties().Select(p => p.Name).Order().ToArray();
        CollectionAssert.AreEquivalent(allowed, columns);
        // The only foreign key points at the link.
        Assert.AreEqual(1, entity.GetForeignKeys().Count());
        Assert.AreEqual(typeof(Link), entity.GetForeignKeys().Single().PrincipalEntityType.ClrType);
    }

    [TestMethod]
    public async Task The_reporters_address_agent_and_account_are_not_in_the_database_or_the_queue()
    {
        using var factory = new OviApiFactory(new() { ["Auth:AdminEmails"] = "boss@example.com" }, IPAddress.Parse("198.51.100.77"));
        await CreateAsync(factory.CreateAuthedClient(), "https://example.com/x", "priv1");
        var user = await factory.CreateUserClientAsync("reporter-person");
        user.DefaultRequestHeaders.UserAgent.ParseAdd("SecretBrowser/9.9");
        user.DefaultRequestHeaders.Referrer = new Uri("https://referrer.example/secret");
        await ReportAsync(user, "priv1", "spam", "plain");

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "select row_to_json(r)::text from \"" + db.Model.FindEntityType(typeof(LinkReport))!.GetTableName() + "\" r";
        var row = (string)(await cmd.ExecuteScalarAsync())!;
        foreach (var secret in new[] { "198.51.100.77", "SecretBrowser", "referrer.example", "reporter-person", "reporter-person@example.com" })
            Assert.DoesNotContain(secret, row);

        var queue = await (await factory.CreateAuthedClient().GetAsync("/api/admin/reports")).Content.ReadAsStringAsync();
        foreach (var secret in new[] { "198.51.100.77", "SecretBrowser", "reporter-person" })
            Assert.DoesNotContain(secret, queue);
    }

    // ---- Admin: who gets in ----

    [TestMethod]
    public async Task Admin_report_routes_are_admin_only()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "auth1");
        await ReportAsync(_factory.CreateUnauthedClient(), "auth1");
        var anon = _factory.CreateUnauthedClient();
        var user = await _factory.CreateUserClientAsync("pleb");
        var body = JsonContent.Create(new { resolution = "dismissed" });

        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/admin/reports")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await user.GetAsync("/api/admin/reports")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anon.PostAsync("/api/admin/reports/auth1/resolve", body)).StatusCode);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await user.PostAsync("/api/admin/reports/auth1/resolve", JsonContent.Create(new { resolution = "dismissed" }))).StatusCode);

        Assert.IsNull((await StoredAsync("auth1")).Single().ResolvedAt, "a non-admin must not resolve reports");
        Assert.AreEqual(HttpStatusCode.OK, (await _factory.CreateAuthedClient().GetAsync("/api/admin/reports")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await (await AdminAsync()).GetAsync("/api/admin/reports")).StatusCode);
    }

    [TestMethod]
    public async Task A_wrong_api_key_is_401_on_the_admin_report_routes()
    {
        var client = _factory.CreateUnauthedClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", "wrong");
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/reports")).StatusCode);
    }

    [TestMethod]
    public async Task Resolving_as_an_admin_cookie_needs_the_ovi_request_header()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "auth2");
        await ReportAsync(_factory.CreateUnauthedClient(), "auth2");
        var boss = await _factory.CreateUserClientAsync("boss", csrfHeader: false);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await boss.PostAsJsonAsync("/api/admin/reports/auth2/resolve", new { resolution = "dismissed" })).StatusCode);
        Assert.IsNull((await StoredAsync("auth2")).Single().ResolvedAt);
    }

    // ---- Admin: the queue ----

    [TestMethod]
    public async Task An_empty_queue_is_an_empty_page()
    {
        var q = await QueueAsync();
        Assert.AreEqual(0, q.GetProperty("items").GetArrayLength());
        Assert.AreEqual(0, q.GetProperty("total").GetInt32());
        Assert.AreEqual(1, q.GetProperty("page").GetInt32());
        Assert.AreEqual(20, q.GetProperty("pageSize").GetInt32());
    }

    [TestMethod]
    public async Task Reports_are_grouped_by_link_with_counts_reasons_owner_and_details()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        var link = await CreateAsync(ada, "https://example.com/phish", "grp1");
        var anon = _factory.CreateUnauthedClient();
        await ReportAsync(anon, "grp1", "phishing", "first");
        _factory.Time.Advance(TimeSpan.FromMinutes(1));
        await ReportAsync(anon, "grp1", "phishing", null);
        _factory.Time.Advance(TimeSpan.FromMinutes(1));
        await ReportAsync(anon, "grp1", "spam", "third");
        var latest = _factory.Time.GetUtcNow();

        var q = await QueueAsync();
        Assert.AreEqual(1, q.GetProperty("total").GetInt32());
        var item = q.GetProperty("items").EnumerateArray().Single();
        Assert.AreEqual("grp1", item.GetProperty("code").GetString());
        Assert.AreEqual(link.ShortUrl, item.GetProperty("shortUrl").GetString());
        Assert.AreEqual("https://example.com/phish", item.GetProperty("url").GetString());
        Assert.AreEqual(3, item.GetProperty("openReports").GetInt32());
        Assert.IsFalse(item.GetProperty("anonymous").GetBoolean());
        Assert.AreEqual("ada@example.com", item.GetProperty("owner").GetProperty("email").GetString());
        Assert.AreEqual(JsonValueKind.Number, item.GetProperty("owner").GetProperty("id").ValueKind);
        var reasons = item.GetProperty("reasons");
        Assert.AreEqual(2, reasons.GetProperty("phishing").GetInt32());
        Assert.AreEqual(0, reasons.GetProperty("malware").GetInt32());
        Assert.AreEqual(1, reasons.GetProperty("spam").GetInt32());
        Assert.AreEqual(0, reasons.GetProperty("other").GetInt32());
        Assert.AreEqual(latest, item.GetProperty("latestAt").GetDateTimeOffset());
        // Only non-empty details, newest first.
        CollectionAssert.AreEqual(new[] { "third", "first" }, item.GetProperty("details").EnumerateArray().Select(d => d.GetString()).ToArray());
    }

    [TestMethod]
    public async Task Details_are_the_latest_five_non_empty_ones()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "five1");
        var anon = _factory.CreateUnauthedClient();
        for (var i = 1; i <= 7; i++)
        {
            await ReportAsync(anon, "five1", "other", "detail " + i);
            await ReportAsync(anon, "five1", "other", null);
            _factory.Time.Advance(TimeSpan.FromSeconds(1));
        }
        var item = (await QueueAsync()).GetProperty("items")[0];
        Assert.AreEqual(14, item.GetProperty("openReports").GetInt32());
        var details = item.GetProperty("details").EnumerateArray().Select(d => d.GetString()).ToArray();
        CollectionAssert.AreEqual(new[] { "detail 7", "detail 6", "detail 5", "detail 4", "detail 3" }, details);
    }

    [TestMethod]
    public async Task Anonymous_and_api_key_links_have_no_owner()
    {
        var anonLink = await CreateAsync(_factory.CreateUnauthedClient(), "https://example.com/a");
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/k", "key1");
        var anon = _factory.CreateUnauthedClient();
        await ReportAsync(anon, anonLink.Code);
        await ReportAsync(anon, "key1");

        var items = (await QueueAsync()).GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("code").GetString()!);
        Assert.AreEqual(JsonValueKind.Null, items[anonLink.Code].GetProperty("owner").ValueKind);
        Assert.IsTrue(items[anonLink.Code].GetProperty("anonymous").GetBoolean());
        Assert.AreEqual(JsonValueKind.Null, items["key1"].GetProperty("owner").ValueKind);
        Assert.IsFalse(items["key1"].GetProperty("anonymous").GetBoolean());
    }

    [TestMethod]
    public async Task The_queue_is_sorted_by_open_count_then_latest_report()
    {
        var owner = _factory.CreateAuthedClient();
        foreach (var code in new[] { "aaa", "bbb", "ccc", "ddd" }) await CreateAsync(owner, "https://example.com/" + code, code);
        var anon = _factory.CreateUnauthedClient();
        async Task Rep(string code) { await ReportAsync(anon, code); _factory.Time.Advance(TimeSpan.FromMinutes(1)); }

        await Rep("aaa");               // 1 report, oldest
        await Rep("bbb"); await Rep("bbb"); await Rep("bbb"); // 3, but older than ccc's
        await Rep("ccc"); await Rep("ccc"); await Rep("ccc"); // 3, newest of the 3-group
        await Rep("ddd");               // 1 report, newest overall

        var codes = (await QueueAsync()).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("code").GetString()).ToArray();
        CollectionAssert.AreEqual(new[] { "ccc", "bbb", "ddd", "aaa" }, codes);
    }

    [TestMethod]
    public async Task The_queue_pages_and_reports_the_total()
    {
        var owner = _factory.CreateAuthedClient();
        var anon = _factory.CreateUnauthedClient();
        for (var i = 0; i < 5; i++)
        {
            await CreateAsync(owner, "https://example.com/" + i, "pg" + i);
            await ReportAsync(anon, "pg" + i);
            _factory.Time.Advance(TimeSpan.FromMinutes(1));
        }
        var page1 = await QueueAsync("?page=1&pageSize=2");
        var page3 = await QueueAsync("?page=3&pageSize=2");
        var page4 = await QueueAsync("?page=4&pageSize=2");
        Assert.AreEqual(5, page1.GetProperty("total").GetInt32());
        Assert.AreEqual(2, page1.GetProperty("pageSize").GetInt32());
        CollectionAssert.AreEqual(new[] { "pg4", "pg3" }, page1.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("code").GetString()).ToArray());
        CollectionAssert.AreEqual(new[] { "pg0" }, page3.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("code").GetString()).ToArray());
        Assert.AreEqual(0, page4.GetProperty("items").GetArrayLength());
    }

    [TestMethod]
    [DataRow("?page=0")]
    [DataRow("?page=-1")]
    [DataRow("?pageSize=0")]
    [DataRow("?pageSize=-5")]
    public async Task Bad_paging_is_a_400(string query)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, (await _factory.CreateAuthedClient().GetAsync("/api/admin/reports" + query)).StatusCode);
    }

    [TestMethod]
    public async Task Paging_limits_match_the_other_admin_lists()
    {
        var admin = _factory.CreateAuthedClient();
        var tooBig = LinkEndpoints.MaxPageSize + 1;
        Assert.AreEqual(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/admin/reports?pageSize={tooBig}")).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/admin/links?pageSize={tooBig}")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await admin.GetAsync($"/api/admin/reports?pageSize={LinkEndpoints.MaxPageSize}")).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/admin/reports?page={LinkEndpoints.MaxPage + 1}")).StatusCode);
    }

    [TestMethod]
    public async Task The_overview_counts_open_reports()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "ov1");
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/y", "ov2");
        var anon = _factory.CreateUnauthedClient();
        await ReportAsync(anon, "ov1"); await ReportAsync(anon, "ov1"); await ReportAsync(anon, "ov2");

        async Task<int> Open() => (await JsonAsync(await _factory.CreateAuthedClient().GetAsync("/api/admin/overview"))).GetProperty("openReports").GetInt32();
        Assert.AreEqual(3, await Open());
        await ResolveAsync("ov1", "actioned");
        Assert.AreEqual(1, await Open());
    }

    // ---- Admin: resolve ----

    private Task<HttpResponseMessage> ResolveAsync(string code, string? resolution) =>
        _factory.CreateAuthedClient().PostAsJsonAsync($"/api/admin/reports/{code}/resolve", new { resolution });

    [TestMethod]
    [DataRow("dismissed")]
    [DataRow("actioned")]
    public async Task Resolving_closes_every_open_report_of_that_link_and_only_that_link(string resolution)
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "res1");
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/y", "res2");
        var anon = _factory.CreateUnauthedClient();
        for (var i = 0; i < 3; i++) await ReportAsync(anon, "res1");
        await ReportAsync(anon, "res2");
        _factory.Time.Advance(TimeSpan.FromHours(1));

        var res = await ResolveAsync("res1", resolution);
        Assert.AreEqual(HttpStatusCode.NoContent, res.StatusCode);
        Assert.AreEqual("", await res.Content.ReadAsStringAsync());

        foreach (var r in await StoredAsync("res1"))
        {
            Assert.AreEqual(resolution, r.Resolution);
            Assert.AreEqual(_factory.Time.GetUtcNow().UtcDateTime, r.ResolvedAt);
        }
        var other = (await StoredAsync("res2")).Single();
        Assert.IsNull(other.ResolvedAt);
        Assert.IsNull(other.Resolution);

        var codes = (await QueueAsync()).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("code").GetString()).ToArray();
        CollectionAssert.AreEqual(new[] { "res2" }, codes);
        Assert.AreEqual(1, (await QueueAsync()).GetProperty("total").GetInt32());
    }

    [TestMethod]
    public async Task Resolving_does_not_touch_the_link_itself()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "keep1");
        await ReportAsync(_factory.CreateUnauthedClient(), "keep1");
        await ResolveAsync("keep1", "dismissed");
        Assert.AreEqual(HttpStatusCode.Redirect, (await _factory.CreateUnauthedClient().GetAsync("/keep1")).StatusCode);
    }

    [TestMethod]
    public async Task A_new_report_after_resolving_reopens_the_link_and_keeps_the_old_resolution()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "again1");
        var anon = _factory.CreateUnauthedClient();
        await ReportAsync(anon, "again1", "spam", "old");
        await ResolveAsync("again1", "dismissed");
        _factory.Time.Advance(TimeSpan.FromMinutes(5));
        await ReportAsync(anon, "again1", "malware", "new");

        var item = (await QueueAsync()).GetProperty("items").EnumerateArray().Single();
        Assert.AreEqual(1, item.GetProperty("openReports").GetInt32());
        Assert.AreEqual(0, item.GetProperty("reasons").GetProperty("spam").GetInt32());
        CollectionAssert.AreEqual(new[] { "new" }, item.GetProperty("details").EnumerateArray().Select(d => d.GetString()).ToArray());
        var stored = await StoredAsync("again1");
        Assert.AreEqual("dismissed", stored[0].Resolution);
        Assert.IsNull(stored[1].Resolution);
    }

    [TestMethod]
    public async Task Resolving_twice_does_not_rewrite_the_first_resolution()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "twice1");
        await ReportAsync(_factory.CreateUnauthedClient(), "twice1");
        await ResolveAsync("twice1", "dismissed");
        var first = (await StoredAsync("twice1")).Single();
        _factory.Time.Advance(TimeSpan.FromHours(2));

        var second = await ResolveAsync("twice1", "actioned");
        Assert.AreEqual(HttpStatusCode.NoContent, second.StatusCode);
        var after = (await StoredAsync("twice1")).Single();
        Assert.AreEqual("dismissed", after.Resolution);
        Assert.AreEqual(first.ResolvedAt, after.ResolvedAt);
    }

    [TestMethod]
    public async Task Resolving_an_unknown_link_is_404()
    {
        Assert.AreEqual(HttpStatusCode.NotFound, (await ResolveAsync("missing1", "dismissed")).StatusCode);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("deleted")]
    [DataRow("dismissed,actioned")]
    public async Task A_bad_resolution_is_400_and_changes_nothing(string? resolution)
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "badres");
        await ReportAsync(_factory.CreateUnauthedClient(), "badres");
        Assert.AreEqual(HttpStatusCode.BadRequest, (await ResolveAsync("badres", resolution)).StatusCode);
        Assert.IsNull((await StoredAsync("badres")).Single().ResolvedAt);
    }

    [TestMethod]
    public async Task A_missing_resolve_body_is_400()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "nobody");
        var res = await _factory.CreateAuthedClient().PostAsync("/api/admin/reports/nobody/resolve", null);
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode);
    }

    // ---- Deleting links ----

    [TestMethod]
    public async Task Deleting_a_link_removes_it_from_the_queue()
    {
        var owner = await _factory.CreateUserClientAsync("ada");
        await CreateAsync(owner, "https://example.com/x", "del1");
        await CreateAsync(owner, "https://example.com/y", "del2");
        var anon = _factory.CreateUnauthedClient();
        await ReportAsync(anon, "del1"); await ReportAsync(anon, "del2");

        Assert.AreEqual(HttpStatusCode.NoContent, (await _factory.CreateAuthedClient().DeleteAsync("/api/links/del1")).StatusCode);

        var q = await QueueAsync();
        CollectionAssert.AreEqual(new[] { "del2" }, q.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("code").GetString()).ToArray());
        Assert.AreEqual(1, q.GetProperty("total").GetInt32());
        Assert.AreEqual(HttpStatusCode.NotFound, (await ResolveAsync("del1", "actioned")).StatusCode);
    }

    [TestMethod]
    public async Task Removing_a_link_row_cascades_to_its_reports()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "casc1");
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/y", "casc2");
        var anon = _factory.CreateUnauthedClient();
        await ReportAsync(anon, "casc1"); await ReportAsync(anon, "casc1"); await ReportAsync(anon, "casc2");

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.AreEqual(1, await db.Links.IgnoreQueryFilters().Where(l => l.Code == "casc1").ExecuteDeleteAsync());
            Assert.AreEqual(1, await db.Set<LinkReport>().CountAsync(), "only the other link's report is left");
        }
        Assert.HasCount(1, await StoredAsync("casc2"));
    }

    [TestMethod]
    public async Task Deleting_the_owner_account_keeps_the_report_queue_working()
    {
        var owner = await _factory.CreateUserClientAsync("gone-user");
        await CreateAsync(owner, "https://example.com/x", "own1");
        await ReportAsync(_factory.CreateUnauthedClient(), "own1");
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Users.Where(u => u.ProviderKey == "gone-user").ExecuteDeleteAsync();
        }
        var item = (await QueueAsync()).GetProperty("items").EnumerateArray().Single();
        Assert.AreEqual(JsonValueKind.Null, item.GetProperty("owner").ValueKind);
    }

    // ---- Concurrency ----

    [TestMethod]
    public async Task Concurrent_reports_never_store_more_than_50_open_reports()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "race1");
        // Fill to 40 first, then send 30 at once: a check-then-insert race pushes the total past 50.
        for (var i = 0; i < 40; i++) await ReportAsync(_factory.CreateUnauthedClient(), "race1");
        var results = await Task.WhenAll(Enumerable.Range(0, 30)
            .Select(_ => ReportAsync(_factory.CreateUnauthedClient(), "race1")));
        Assert.IsTrue(results.All(r => r.StatusCode == HttpStatusCode.Accepted), "every report gets 202");
        var stored = (await StoredAsync("race1")).Count;
        Assert.IsLessThanOrEqualTo(50, stored, $"stored {stored} open reports for one link");
        Assert.IsGreaterThanOrEqualTo(1, stored);
    }

    [TestMethod]
    public async Task Resolving_while_reports_arrive_never_fails()
    {
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/x", "race2");
        await ReportAsync(_factory.CreateUnauthedClient(), "race2");
        var tasks = Enumerable.Range(0, 8).Select(_ => ReportAsync(_factory.CreateUnauthedClient(), "race2")).ToList<Task<HttpResponseMessage>>();
        tasks.Add(ResolveAsync("race2", "dismissed"));
        foreach (var r in await Task.WhenAll(tasks))
            Assert.IsTrue((int)r.StatusCode is 202 or 204, r.StatusCode.ToString());
    }
}
