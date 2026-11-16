using System.Net;
using System.Net.Http.Json;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

/// <summary>Configuration that matters when the app is deployed.</summary>
[TestClass]
public sealed class DeploymentTests
{
    private static readonly IPAddress Proxy = IPAddress.Parse("10.0.0.5");

    [TestMethod]
    public async Task PublicBaseUrl_is_used_instead_of_host_header()
    {
        using var factory = new OviApiFactory(new() { ["App:PublicBaseUrl"] = "https://ovi.example/" });
        var client = factory.CreateAuthedClient();

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/links") { Content = JsonContent.Create(new CreateLinkRequest("https://example.com", "brand")) };
        req.Headers.Host = "evil.example";
        var link = (await (await client.SendAsync(req)).Content.ReadFromJsonAsync<LinkResponse>())!;

        Assert.AreEqual("https://ovi.example/brand", link.ShortUrl);
        Assert.AreEqual("https://ovi.example/brand/qr", link.QrCodeUrl);
    }

    [TestMethod]
    public async Task Render_external_url_is_used_when_PublicBaseUrl_is_not_set()
    {
        using var factory = new OviApiFactory(new() { ["RENDER_EXTERNAL_URL"] = "https://ovi-abc1.onrender.com" });
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", "render"));
        var link = (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
        Assert.AreEqual("https://ovi-abc1.onrender.com/render", link.ShortUrl);
    }

    [TestMethod]
    public async Task PublicBaseUrl_overrides_render_external_url()
    {
        using var factory = new OviApiFactory(new()
        {
            ["RENDER_EXTERNAL_URL"] = "https://ovi-abc1.onrender.com",
            ["App:PublicBaseUrl"] = "https://short.example"
        });
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", "custom"));
        var link = (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
        Assert.AreEqual("https://short.example/custom", link.ShortUrl);
    }

    [TestMethod]
    public async Task PublicBaseUrl_blocks_self_links()
    {
        using var factory = new OviApiFactory(new() { ["App:PublicBaseUrl"] = "https://ovi.example" });
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest("https://OVI.example/abc"));
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [TestMethod]
    public void Invalid_PublicBaseUrl_fails_at_startup()
    {
        using var factory = new OviApiFactory(new() { ["App:PublicBaseUrl"] = "not-a-url" });
        Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());
    }

    [TestMethod]
    public async Task Swagger_can_be_disabled()
    {
        using var factory = new OviApiFactory(new() { ["Swagger:Enabled"] = "false" });
        var client = factory.CreateUnauthedClient();
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync("/openapi/v1.json")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync("/swagger/index.html")).StatusCode);
    }

    [TestMethod]
    public async Task Trusted_proxy_rate_limits_each_real_client_separately()
    {
        using var factory = new OviApiFactory(new()
        {
            ["RateLimits:RedirectPerMinute"] = "1",
            ["ReverseProxy:KnownProxies:0"] = Proxy.ToString()
        }, remoteIp: Proxy);
        var client = await ClientWithLink(factory);

        Assert.AreEqual(HttpStatusCode.Redirect, await Hit(client, "203.0.113.1"));
        Assert.AreEqual(HttpStatusCode.Redirect, await Hit(client, "203.0.113.2"));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, await Hit(client, "203.0.113.1"));
    }

    [TestMethod]
    public async Task Forwarded_header_is_ignored_from_untrusted_sender()
    {
        // No KnownProxies configured: clients can't dodge the limit by faking X-Forwarded-For.
        using var factory = new OviApiFactory(new() { ["RateLimits:RedirectPerMinute"] = "1" }, remoteIp: Proxy);
        var client = await ClientWithLink(factory);

        Assert.AreEqual(HttpStatusCode.Redirect, await Hit(client, "203.0.113.1"));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, await Hit(client, "203.0.113.2"));
    }

    [TestMethod]
    public async Task Custom_client_ip_header_is_used_when_trusting_platform_proxy()
    {
        using var factory = new OviApiFactory(new()
        {
            ["RateLimits:RedirectPerMinute"] = "1",
            ["ReverseProxy:TrustAllProxies"] = "true",
            ["ReverseProxy:ClientIpHeader"] = "X-Client-IP"
        }, remoteIp: Proxy);
        var client = await ClientWithLink(factory);

        Assert.AreEqual(HttpStatusCode.Redirect, await Hit(client, "203.0.113.1", "X-Client-IP"));
        Assert.AreEqual(HttpStatusCode.Redirect, await Hit(client, "203.0.113.2", "X-Client-IP"));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, await Hit(client, "203.0.113.1", "X-Client-IP"));
    }

    [TestMethod]
    public async Task X_forwarded_for_is_ignored_when_another_client_ip_header_is_configured()
    {
        using var factory = new OviApiFactory(new()
        {
            ["RateLimits:RedirectPerMinute"] = "1",
            ["ReverseProxy:TrustAllProxies"] = "true",
            ["ReverseProxy:ClientIpHeader"] = "X-Client-IP"
        }, remoteIp: Proxy);
        var client = await ClientWithLink(factory);

        Assert.AreEqual(HttpStatusCode.Redirect, await Hit(client, "203.0.113.1"));
        Assert.AreEqual(HttpStatusCode.TooManyRequests, await Hit(client, "203.0.113.2"));
    }

    [TestMethod]
    public async Task Create_is_rate_limited()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "2" });
        var client = factory.CreateAuthedClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 3; i++)
            statuses.Add((await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com"))).StatusCode);

        CollectionAssert.AreEqual(new[] { HttpStatusCode.Created, HttpStatusCode.Created, HttpStatusCode.TooManyRequests }, statuses);
    }

    private static async Task<HttpClient> ClientWithLink(OviApiFactory factory)
    {
        var client = factory.CreateAuthedClient();
        var res = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", "lim"));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode);
        return client;
    }

    private static async Task<HttpStatusCode> Hit(HttpClient client, string clientIp, string header = "X-Forwarded-For")
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/lim");
        req.Headers.Add(header, clientIp);
        return (await client.SendAsync(req)).StatusCode;
    }
}
