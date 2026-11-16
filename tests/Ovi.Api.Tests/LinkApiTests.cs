using System.Net;
using System.Net.Http.Json;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

public class LinkApiTests : IDisposable
{
    private readonly OviApiFactory _factory = new();
    private readonly HttpClient _client;

    public LinkApiTests()
    {
        _client = _factory.CreateAuthedClient();
    }

    public void Dispose() => _factory.Dispose();

    private async Task<LinkResponse> CreateAsync(string url, string? code = null, DateTime? expiresAt = null)
    {
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest(url, code, expiresAt));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
    }

    [Fact]
    public async Task Create_generates_code_and_returns_location()
    {
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/a", null));

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var link = await res.Content.ReadFromJsonAsync<LinkResponse>();
        Assert.Equal(7, link!.Code.Length);
        Assert.Equal($"/api/links/{link.Code}", res.Headers.Location!.ToString());
        Assert.EndsWith("/" + link.Code, link.ShortUrl);
    }

    [Fact]
    public async Task Create_with_custom_code_uses_it()
    {
        var link = await CreateAsync("https://example.com", "my-link");
        Assert.Equal("my-link", link.Code);
    }

    [Theory]
    [InlineData("not a url")]
    [InlineData("ftp://example.com")]
    [InlineData("javascript:alert(1)")]
    [InlineData("/relative/path")]
    public async Task Create_rejects_invalid_urls(string url)
    {
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest(url, null));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("has space")]
    [InlineData("api")]
    [InlineData("swagger")]
    [InlineData("qr")]
    public async Task Create_rejects_invalid_custom_codes(string code)
    {
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", code));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Create_duplicate_custom_code_conflicts()
    {
        await CreateAsync("https://example.com", "dupe");
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://other.com", "dupe"));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Redirect_sends_302_and_counts_clicks()
    {
        var link = await CreateAsync("https://example.com/target", "goto");

        for (var i = 0; i < 3; i++)
        {
            var res = await _client.GetAsync("/goto");
            Assert.Equal(HttpStatusCode.Redirect, res.StatusCode);
            Assert.Equal("https://example.com/target", res.Headers.Location!.ToString());
        }

        var details = await _client.GetFromJsonAsync<LinkResponse>("/api/links/goto");
        Assert.Equal(3, details!.Clicks);
        Assert.NotNull(details.LastClickedAt);
        Assert.Equal(DateTimeKind.Utc, details.CreatedAt.Kind);
    }

    [Fact]
    public async Task Unknown_code_returns_404()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/nope123")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/links/nope123")).StatusCode);
    }

    [Fact]
    public async Task List_returns_created_links()
    {
        await CreateAsync("https://one.com", "one");
        await CreateAsync("https://two.com", "two");

        var links = await _client.GetFromJsonAsync<List<LinkResponse>>("/api/links");
        Assert.Equal(["one", "two"], links!.Select(l => l.Code).Order());
    }

    [Fact]
    public async Task Delete_removes_link()
    {
        await CreateAsync("https://example.com", "bye");

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync("/api/links/bye")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/bye")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync("/api/links/bye")).StatusCode);
    }

    [Fact]
    public async Task Health_is_ok()
    {
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/health")).StatusCode);
    }

    // ---- API key ----

    [Theory]
    [InlineData(null)]
    [InlineData("wrong-key")]
    public async Task Management_endpoints_require_api_key(string? key)
    {
        var client = _factory.CreateUnauthedClient();
        if (key is not null) client.DefaultRequestHeaders.Add("X-Api-Key", key);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/links")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync("/api/links/abc")).StatusCode);
    }

    [Fact]
    public async Task Redirect_and_qr_are_public()
    {
        await CreateAsync("https://example.com", "public");
        var anon = _factory.CreateUnauthedClient();

        Assert.Equal(HttpStatusCode.Redirect, (await anon.GetAsync("/public")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync("/public/qr")).StatusCode);
    }

    // ---- Expiry ----

    [Fact]
    public async Task Expired_link_returns_410_and_does_not_count_click()
    {
        var link = await CreateAsync("https://example.com", "soon", _factory.Time.GetUtcNow().UtcDateTime.AddHours(1));
        Assert.NotNull(link.ExpiresAt);

        Assert.Equal(HttpStatusCode.Redirect, (await _client.GetAsync("/soon")).StatusCode);

        _factory.Time.Advance(TimeSpan.FromHours(1));
        Assert.Equal(HttpStatusCode.Gone, (await _client.GetAsync("/soon")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await _client.GetAsync("/soon/qr")).StatusCode);

        var details = await _client.GetFromJsonAsync<LinkResponse>("/api/links/soon");
        Assert.Equal(1, details!.Clicks);
    }

    [Fact]
    public async Task Create_rejects_expiry_in_the_past()
    {
        var past = _factory.Time.GetUtcNow().UtcDateTime.AddMinutes(-1);
        var res = await _client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", null, past));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    // ---- QR ----

    [Fact]
    public async Task Qr_returns_png()
    {
        var link = await CreateAsync("https://example.com", "qrme");
        Assert.EndsWith("/qrme/qr", link.QrCodeUrl);

        var res = await _client.GetAsync("/qrme/qr");
        Assert.Equal("image/png", res.Content.Headers.ContentType!.MediaType);
        var bytes = await res.Content.ReadAsByteArrayAsync();
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, bytes[..4]);
    }

    [Fact]
    public async Task Qr_for_unknown_code_is_404()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/nope123/qr")).StatusCode);
    }
}

public class RateLimitTests
{
    [Fact]
    public async Task Create_is_rate_limited()
    {
        using var factory = new OviApiFactory(createPerMinute: 2);
        var client = factory.CreateAuthedClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 3; i++)
            statuses.Add((await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com"))).StatusCode);

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created, HttpStatusCode.TooManyRequests], statuses);
    }

    [Fact]
    public async Task Redirect_is_rate_limited()
    {
        using var factory = new OviApiFactory(redirectPerMinute: 1);
        var client = factory.CreateAuthedClient();
        await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", "lim"));

        Assert.Equal(HttpStatusCode.Redirect, (await client.GetAsync("/lim")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/lim")).StatusCode);
    }
}
