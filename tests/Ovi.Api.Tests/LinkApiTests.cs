using System.Net;
using System.Net.Http.Json;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class LinkApiTests : IDisposable
{
    private readonly OviApiFactory _factory = new();
    private readonly HttpClient _client;

    public LinkApiTests() => _client = _factory.CreateAuthedClient();

    public void Dispose() => _factory.Dispose();

    private async Task<LinkResponse> CreateAsync(string url, string? code = null, DateTimeOffset? expiresAt = null)
    {
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest(url, code, expiresAt));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
    }

    private Task<HttpResponseMessage> PostAsync(CreateLinkRequest request) => _client.PostAsJsonAsync("/api/links", request);

    // ---- Create ----

    [TestMethod]
    public async Task Create_generates_code_and_returns_location()
    {
        var res = await PostAsync(new CreateLinkRequest("https://example.com/a"));

        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode);
        var link = (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
        Assert.AreEqual(7, link.Code.Length);
        Assert.AreEqual($"/api/links/{link.Code}", res.Headers.Location!.ToString());
        Assert.EndsWith("/" + link.Code, link.ShortUrl);
        Assert.AreEqual(DateTimeKind.Utc, link.CreatedAt.Kind);
    }

    [TestMethod]
    public async Task Create_with_custom_code_uses_it()
    {
        var link = await CreateAsync("https://example.com", "my-link");
        Assert.AreEqual("my-link", link.Code);
    }

    [TestMethod]
    [DataRow("not a url")]
    [DataRow("ftp://example.com")]
    [DataRow("javascript:alert(1)")]
    [DataRow("/relative/path")]
    [DataRow("")]
    public async Task Create_rejects_invalid_urls(string url)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, (await PostAsync(new CreateLinkRequest(url))).StatusCode);
    }

    [TestMethod]
    public async Task Create_rejects_overlong_urls()
    {
        var url = "https://example.com/" + new string('a', LinkEndpoints.MaxUrlLength);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await PostAsync(new CreateLinkRequest(url))).StatusCode);
    }

    [TestMethod]
    public async Task Create_rejects_links_back_to_the_shortener()
    {
        // The test server's host is "localhost".
        Assert.AreEqual(HttpStatusCode.BadRequest, (await PostAsync(new CreateLinkRequest("http://localhost/abc"))).StatusCode);
    }

    [TestMethod]
    [DataRow("ab")]
    [DataRow("has space")]
    [DataRow("api")]
    [DataRow("swagger")]
    [DataRow("openapi")]
    [DataRow("QR")]
    [DataRow("assets")]
    public async Task Create_rejects_invalid_custom_codes(string code)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, (await PostAsync(new CreateLinkRequest("https://example.com", code))).StatusCode);
    }

    [TestMethod]
    public async Task Create_duplicate_custom_code_conflicts()
    {
        await CreateAsync("https://example.com", "dupe");
        var res = await PostAsync(new CreateLinkRequest("https://other.com", "dupe"));
        Assert.AreEqual(HttpStatusCode.Conflict, res.StatusCode);
        Assert.AreEqual("application/problem+json", res.Content.Headers.ContentType!.MediaType);
    }

    // ---- Redirect ----

    [TestMethod]
    public async Task Redirect_sends_302_and_counts_clicks()
    {
        await CreateAsync("https://example.com/target", "goto");

        for (var i = 0; i < 3; i++)
        {
            var res = await _client.GetAsync("/goto");
            Assert.AreEqual(HttpStatusCode.Redirect, res.StatusCode);
            Assert.AreEqual("https://example.com/target", res.Headers.Location!.ToString());
        }

        var details = (await _client.GetFromJsonAsync<LinkResponse>("/api/links/goto"))!;
        Assert.AreEqual(3, details.Clicks);
        Assert.IsNotNull(details.LastClickedAt);
    }

    [TestMethod]
    public async Task Unknown_code_returns_404()
    {
        Assert.AreEqual(HttpStatusCode.NotFound, (await _client.GetAsync("/nope123")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await _client.GetAsync("/api/links/nope123")).StatusCode);
    }

    // ---- List / delete ----

    [TestMethod]
    public async Task List_is_paged_newest_first()
    {
        foreach (var c in new[] { "one", "two", "three" })
        {
            await CreateAsync($"https://{c}.com", c);
            _factory.Time.Advance(TimeSpan.FromSeconds(1));
        }

        var first = (await _client.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links?pageSize=2"))!;
        CollectionAssert.AreEqual(new[] { "three", "two" }, first.Items.Select(l => l.Code).ToArray());
        Assert.AreEqual(3, first.Total);

        var second = (await _client.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links?page=2&pageSize=2"))!;
        CollectionAssert.AreEqual(new[] { "one" }, second.Items.Select(l => l.Code).ToArray());
    }

    [TestMethod]
    [DataRow("page=0")]
    [DataRow("pageSize=0")]
    [DataRow("pageSize=101")]
    public async Task List_rejects_bad_paging(string query)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, (await _client.GetAsync($"/api/links?{query}")).StatusCode);
    }

    [TestMethod]
    public async Task Delete_removes_link()
    {
        await CreateAsync("https://example.com", "bye");

        Assert.AreEqual(HttpStatusCode.NoContent, (await _client.DeleteAsync("/api/links/bye")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await _client.GetAsync("/bye")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await _client.DeleteAsync("/api/links/bye")).StatusCode);
    }

    // ---- API key ----

    [TestMethod]
    [DataRow(null)]
    [DataRow("wrong-key")]
    [DataRow("test-key-but-longer")]
    public async Task Management_endpoints_require_api_key(string? key)
    {
        var client = _factory.CreateUnauthedClient();
        if (key is not null) client.DefaultRequestHeaders.Add("X-Api-Key", key);

        Assert.AreEqual(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/links")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com"))).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await client.DeleteAsync("/api/links/abc")).StatusCode);
    }

    [TestMethod]
    public async Task Redirect_and_qr_are_public()
    {
        await CreateAsync("https://example.com", "public");
        var anon = _factory.CreateUnauthedClient();

        Assert.AreEqual(HttpStatusCode.Redirect, (await anon.GetAsync("/public")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await anon.GetAsync("/public/qr")).StatusCode);
    }

    // ---- Expiry ----

    [TestMethod]
    public async Task Expired_link_returns_410_and_does_not_count_click()
    {
        var link = await CreateAsync("https://example.com", "soon", _factory.Time.GetUtcNow().AddHours(1));
        Assert.IsNotNull(link.ExpiresAt);

        Assert.AreEqual(HttpStatusCode.Redirect, (await _client.GetAsync("/soon")).StatusCode);

        _factory.Time.Advance(TimeSpan.FromHours(1));
        Assert.AreEqual(HttpStatusCode.Gone, (await _client.GetAsync("/soon")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Gone, (await _client.GetAsync("/soon/qr")).StatusCode);

        var details = (await _client.GetFromJsonAsync<LinkResponse>("/api/links/soon"))!;
        Assert.AreEqual(1, details.Clicks);
    }

    [TestMethod]
    public async Task Expiry_with_offset_is_stored_as_utc()
    {
        var expires = new DateTimeOffset(2030, 1, 1, 2, 0, 0, TimeSpan.FromHours(2));
        var link = await CreateAsync("https://example.com", "offset", expires);
        Assert.AreEqual(new DateTime(2030, 1, 1, 0, 0, 0, DateTimeKind.Utc), link.ExpiresAt);
    }

    [TestMethod]
    public async Task Create_rejects_expiry_in_the_past()
    {
        var past = _factory.Time.GetUtcNow().AddMinutes(-1);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await PostAsync(new CreateLinkRequest("https://example.com", null, past))).StatusCode);
    }

    // ---- QR ----

    [TestMethod]
    public async Task Qr_returns_png()
    {
        var link = await CreateAsync("https://example.com", "qrme");
        Assert.EndsWith("/qrme/qr", link.QrCodeUrl);

        var res = await _client.GetAsync("/qrme/qr");
        Assert.AreEqual("image/png", res.Content.Headers.ContentType!.MediaType);
        var bytes = await res.Content.ReadAsByteArrayAsync();
        CollectionAssert.AreEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, bytes[..4]);
    }

    [TestMethod]
    public async Task Qr_for_unknown_code_is_404()
    {
        Assert.AreEqual(HttpStatusCode.NotFound, (await _client.GetAsync("/nope123/qr")).StatusCode);
    }

    // ---- Health / docs ----

    [TestMethod]
    public async Task Health_checks_database()
    {
        Assert.AreEqual(HttpStatusCode.OK, (await _client.GetAsync("/health")).StatusCode);
    }

    [TestMethod]
    public async Task OpenApi_document_describes_api_key()
    {
        // WebApplicationFactory runs in the Development environment, where docs are on by default.
        var json = await _client.GetStringAsync("/openapi/v1.json");
        Assert.Contains("X-Api-Key", json);
        Assert.AreEqual(HttpStatusCode.OK, (await _client.GetAsync("/swagger/index.html")).StatusCode);
    }
}
