using System.Net;
using System.Net.Http.Json;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class WebUiTests
{
    private static string FakeBuiltUi()
    {
        var root = Directory.CreateTempSubdirectory("ovi-ui-").FullName;
        File.WriteAllText(Path.Combine(root, "index.html"), "<!doctype html><title>Ovi</title><div id=root></div>");
        File.WriteAllText(Path.Combine(root, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
        Directory.CreateDirectory(Path.Combine(root, "assets"));
        File.WriteAllText(Path.Combine(root, "assets", "index-abc123.js"), "console.log('ovi')");
        return root;
    }

    [TestMethod]
    public async Task Root_serves_the_ui_with_security_headers()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/");

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.AreEqual("text/html", res.Content.Headers.ContentType!.MediaType);
        Assert.Contains("<div id=root>", await res.Content.ReadAsStringAsync());
        var csp = res.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("script-src 'self'", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.AreEqual("no-cache", res.Headers.CacheControl!.ToString());
    }

    [TestMethod]
    public async Task Csp_allows_qr_images_from_the_public_base_url()
    {
        using var factory = new OviApiFactory(new() { ["App:PublicBaseUrl"] = "https://short.example" }, webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/");
        Assert.Contains("img-src 'self' data: https://short.example", res.Headers.GetValues("Content-Security-Policy").Single());
    }

    [TestMethod]
    public async Task Hashed_assets_are_cached_long_term()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/assets/index-abc123.js");

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.AreEqual("public, max-age=31536000, immutable", res.Headers.CacheControl!.ToString());
    }

    [TestMethod]
    public async Task Top_level_files_are_served_not_treated_as_short_codes()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/favicon.svg");

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.AreEqual("image/svg+xml", res.Content.Headers.ContentType!.MediaType);
    }

    [TestMethod]
    public async Task Without_a_built_ui_root_is_not_found()
    {
        using var factory = new OviApiFactory();
        Assert.AreEqual(HttpStatusCode.NotFound, (await factory.CreateUnauthedClient().GetAsync("/")).StatusCode);
    }

    [TestMethod]
    public async Task Short_links_still_redirect_when_the_ui_is_served()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var client = factory.CreateAuthedClient();
        await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", "beside-ui"));

        Assert.AreEqual(HttpStatusCode.Redirect, (await client.GetAsync("/beside-ui")).StatusCode);
    }
}
