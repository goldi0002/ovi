using System.Net;
using System.Net.Http.Json;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class WebUiTests
{
    private static string FakeBuiltUi(string? indexHtml = null)
    {
        var root = Directory.CreateTempSubdirectory("ovi-ui-").FullName;
        File.WriteAllText(Path.Combine(root, "index.html"),
            indexHtml ?? "<!doctype html><html><head><title>Ovi</title></head><body><div id=root></div></body></html>");
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
    [DataRow("/sw.js", "text/javascript")]
    [DataRow("/manifest.webmanifest", "application/manifest+json")]
    public async Task Service_worker_and_manifest_are_served_and_always_revalidated(string path, string contentType)
    {
        var root = FakeBuiltUi();
        File.WriteAllText(Path.Combine(root, "sw.js"), "self.addEventListener('fetch', () => {})");
        File.WriteAllText(Path.Combine(root, "manifest.webmanifest"), "{\"name\":\"Ovi\"}");
        using var factory = new OviApiFactory(webRoot: root);
        var res = await factory.CreateUnauthedClient().GetAsync(path);

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.AreEqual(contentType, res.Content.Headers.ContentType!.MediaType);
        Assert.AreEqual("no-cache", res.Headers.CacheControl!.ToString());
        Assert.AreEqual("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [TestMethod]
    [DataRow("/links/analytics")]
    [DataRow("/links/qr-codes")]
    public async Task Pages_under_links_serve_the_ui_without_being_indexed(string path)
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync(path);

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("<div id=root>", await res.Content.ReadAsStringAsync());
        Assert.Contains("script-src 'self'", res.Headers.GetValues("Content-Security-Policy").Single());
        Assert.AreEqual("noindex, follow", res.Headers.GetValues("X-Robots-Tag").Single());
    }

    [TestMethod]
    [DataRow("/privacy")]
    [DataRow("/terms")]
    public async Task Legal_pages_serve_the_ui_and_may_be_indexed(string path)
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync(path);

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("<div id=root>", await res.Content.ReadAsStringAsync());
        Assert.IsFalse(res.Headers.Contains("X-Robots-Tag"));
        var robots = await (await factory.CreateUnauthedClient().GetAsync("/robots.txt")).Content.ReadAsStringAsync();
        Assert.DoesNotContain($"Disallow: {path}", robots);
    }

    [TestMethod]
    [DataRow("/qr-code-generator")]
    [DataRow("/self-host")]
    public async Task Guide_pages_are_indexable_and_describe_themselves(string path)
    {
        // The real page, as Vite writes it, so a change to its head that breaks the swap is caught here.
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi(File.ReadAllText(Path.Combine(RepoRoot(), "web", "index.html"))));
        var client = factory.CreateUnauthedClient();
        var res = await client.GetAsync(path);
        var origin = res.RequestMessage!.RequestUri!.GetLeftPart(UriPartial.Authority);
        var body = await res.Content.ReadAsStringAsync();
        var meta = Ovi.Api.Infrastructure.WebUiSetup.GuidePages[path];

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.IsFalse(res.Headers.Contains("X-Robots-Tag"));
        Assert.Contains($"<title>{System.Net.WebUtility.HtmlEncode(meta.Title)}</title>", body);
        Assert.DoesNotContain("Short links with QR codes and click stats</title>", body);
        Assert.Contains($"name=\"description\" content=\"{System.Net.WebUtility.HtmlEncode(meta.Description)}\"", body);
        Assert.Contains($"property=\"og:title\" content=\"{System.Net.WebUtility.HtmlEncode(meta.Title)}\"", body);
        Assert.Contains($"<link rel=\"canonical\" href=\"{origin}{path}\">", body);
        Assert.AreEqual(1, System.Text.RegularExpressions.Regex.Matches(body, "<title>").Count);
        Assert.AreEqual(1, System.Text.RegularExpressions.Regex.Matches(body, "name=\"description\"").Count);
        var robots = await (await client.GetAsync("/robots.txt")).Content.ReadAsStringAsync();
        Assert.DoesNotContain($"Disallow: {path}", robots);
    }

    [TestMethod]
    public async Task Every_page_names_an_absolute_share_image_that_is_served()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var client = factory.CreateUnauthedClient();
        foreach (var path in new[] { "/", "/self-host", "/privacy" })
        {
            var res = await client.GetAsync(path);
            var origin = res.RequestMessage!.RequestUri!.GetLeftPart(UriPartial.Authority);
            var body = await res.Content.ReadAsStringAsync();
            Assert.Contains($"<meta property=\"og:image\" content=\"{origin}/og.png\">", body, path);
            Assert.Contains($"<meta name=\"twitter:image\" content=\"{origin}/og.png\">", body, path);
        }
    }

    [TestMethod]
    public void The_share_image_exists_and_is_1200_by_630()
    {
        var bytes = File.ReadAllBytes(Path.Combine(RepoRoot(), "web", "public", "og.png"));
        // A PNG's IHDR chunk holds the width and height as big-endian integers at bytes 16 and 20.
        Assert.AreEqual(1200, System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16)));
        Assert.AreEqual(630, System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20)));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Ovi.sln"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("Ovi.sln not found above the test output.");
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
    public async Task Sitemap_lists_the_home_page_the_guides_and_the_legal_pages()
    {
        using var factory = new OviApiFactory(webRoot: FakeBuiltUi());
        var res = await factory.CreateUnauthedClient().GetAsync("/sitemap.xml");

        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
        Assert.AreEqual("application/xml", res.Content.Headers.ContentType!.MediaType);
        var origin = res.RequestMessage!.RequestUri!.GetLeftPart(UriPartial.Authority);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains($"<loc>{origin}/</loc>", body);
        Assert.Contains($"<loc>{origin}/privacy</loc>", body);
        Assert.Contains($"<loc>{origin}/terms</loc>", body);
        Assert.Contains($"<loc>{origin}/qr-code-generator</loc>", body);
        Assert.Contains($"<loc>{origin}/self-host</loc>", body);
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
