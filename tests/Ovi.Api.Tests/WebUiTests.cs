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
        File.WriteAllText(Path.Combine(root, "index.html"),
            "<!doctype html><html><head><title>Ovi</title></head><body><div id=root></div></body></html>");
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
    public async Task Links_page_serves_the_ui_and_its_code_is_reserved()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/links");

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("<div id=root>", await res.Content.ReadAsStringAsync());
        Assert.IsNotNull(res.Headers.GetValues("Content-Security-Policy").Single());

        var create = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com", "links"));
        Assert.AreEqual(HttpStatusCode.BadRequest, create.StatusCode);
    }

    [TestMethod]
    public void Every_ui_page_is_a_reserved_code()
    {
        foreach (var page in Ovi.Api.Infrastructure.WebUiSetup.Pages.Where(p => p != "/"))
            Assert.IsFalse(CodeGenerator.IsValidCustomCode(page.TrimStart('/')), page);
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
    public async Task Home_page_gets_an_absolute_canonical_and_the_other_pages_do_not()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var client = factory.CreateUnauthedClient();

        var home = await client.GetAsync("/");
        var origin = home.RequestMessage!.RequestUri!.GetLeftPart(UriPartial.Authority);
        var body = await home.Content.ReadAsStringAsync();
        Assert.Contains($"<link rel=\"canonical\" href=\"{origin}/\">", body);
        Assert.Contains($"<meta property=\"og:url\" content=\"{origin}/\">", body);

        Assert.DoesNotContain("canonical", await (await client.GetAsync("/links")).Content.ReadAsStringAsync());
    }

    [TestMethod]
    public async Task Only_the_home_page_is_indexable()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var client = factory.CreateUnauthedClient();

        Assert.IsFalse((await client.GetAsync("/")).Headers.Contains("X-Robots-Tag"));

        var links = await client.GetAsync("/links");
        Assert.AreEqual("noindex, follow", links.Headers.GetValues("X-Robots-Tag").Single());
        var admin = await client.GetAsync("/admin");
        Assert.AreEqual("noindex, follow", admin.Headers.GetValues("X-Robots-Tag").Single());
    }

    [TestMethod]
    public async Task Robots_points_at_a_sitemap_on_the_same_origin()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/robots.txt");

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.AreEqual("text/plain", res.Content.Headers.ContentType!.MediaType);
        var origin = res.RequestMessage!.RequestUri!.GetLeftPart(UriPartial.Authority);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("Disallow: /api/", body);
        Assert.Contains($"Sitemap: {origin}/sitemap.xml", body);
    }

    [TestMethod]
    public async Task Sitemap_lists_the_home_page()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/sitemap.xml");

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.AreEqual("application/xml", res.Content.Headers.ContentType!.MediaType);
        var origin = res.RequestMessage!.RequestUri!.GetLeftPart(UriPartial.Authority);
        Assert.Contains($"<loc>{origin}/</loc>", await res.Content.ReadAsStringAsync());
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
