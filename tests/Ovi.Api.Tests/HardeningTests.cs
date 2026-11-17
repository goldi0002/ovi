using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Accounts;
using Ovi.Api.Data;
using Ovi.Api.Links;
using Ovi.Api.Security;

namespace Ovi.Api.Tests;

/// <summary>
/// The remaining findings from the security review: #15 self-links, #16 URL storage and paging, #17 revoked sessions,
/// #18 encrypted key ring and #19 API key strength and throttling.
/// </summary>
[TestClass]
public sealed class HardeningTests
{
    // ---- #15: the self-link check covers every hostname the app answers on ----

    [TestMethod]
    public async Task Links_to_any_hostname_the_app_answers_on_are_refused()
    {
        using var factory = new OviApiFactory(new()
        {
            ["App:PublicBaseUrl"] = "https://short.example",
            ["RENDER_EXTERNAL_URL"] = "https://ovi-abc1.onrender.com"
        });
        var client = factory.CreateAuthedClient();

        foreach (var url in new[] { "https://OVI-abc1.onrender.com./x", "https://short.example/x", "http://localhost/x" })
        {
            var res = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest(url));
            Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, url);
        }
    }

    // ---- #16: URLs are stored in their ASCII form, and paging can't overflow ----

    [TestMethod]
    public async Task Non_ascii_urls_are_stored_encoded_and_redirect_cleanly()
    {
        using var factory = new OviApiFactory();
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links",
            new CreateLinkRequest("https://example.com/%C3%A9", "encoded"));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stored = (await db.Links.SingleAsync(l => l.Code == "encoded")).Url;
            StringAssert.Contains(stored, "%C3%A9");
            Assert.IsFalse(stored.Contains('\u00E9'), "the URL was decoded before storage");
        }

        var visit = await factory.CreateUnauthedClient().GetAsync("/encoded");
        Assert.AreEqual(HttpStatusCode.Redirect, visit.StatusCode);
        Assert.AreEqual("https://example.com/%C3%A9", visit.Headers.Location!.OriginalString);
    }

    [TestMethod]
    [DataRow("https://example.com/\u202Eevil")]
    [DataRow("https://example.com/a\u0000b")]
    public async Task Urls_with_bidi_or_control_characters_are_refused(string url)
    {
        using var factory = new OviApiFactory();
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest(url));
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [TestMethod]
    [DataRow("/api/links?page=30000000&pageSize=100")]
    [DataRow("/api/links?page=100001")]
    public async Task Huge_page_numbers_are_refused(string path)
    {
        using var factory = new OviApiFactory();
        Assert.AreEqual(HttpStatusCode.BadRequest, (await factory.CreateAuthedClient().GetAsync(path)).StatusCode);
    }

    [TestMethod]
    public async Task Admin_paging_has_the_same_cap()
    {
        using var factory = new OviApiFactory();
        var admin = factory.CreateAuthedClient();
        foreach (var path in new[] { "/api/admin/users?page=30000000", "/api/admin/links?page=30000000" })
            Assert.AreEqual(HttpStatusCode.BadRequest, (await admin.GetAsync(path)).StatusCode, path);
    }

    // ---- #17: logging out revokes the session, even a copied cookie ----

    [TestMethod]
    public async Task Logging_out_revokes_a_copied_cookie()
    {
        using var factory = new OviApiFactory();
        var login = await factory.CreateUnauthedClient().GetAsync("/test-only/login?key=copied");
        var cookie = login.Headers.GetValues("Set-Cookie")
            .Single(c => c.StartsWith(AuthSetup.CookieName)).Split(';')[0];

        var user = factory.CreateUnauthedClient();
        user.DefaultRequestHeaders.Add("Cookie", cookie);
        user.DefaultRequestHeaders.Add(CallerFilter.CsrfHeader, "1");
        Assert.AreEqual(HttpStatusCode.OK, (await user.GetAsync("/api/session")).StatusCode);

        Assert.AreEqual(HttpStatusCode.NoContent, (await user.PostAsync("/api/logout", null)).StatusCode);

        var replay = factory.CreateUnauthedClient();
        replay.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await replay.GetAsync("/api/links")).StatusCode);
        Assert.IsNull((await replay.GetFromJsonAsync<SessionResponse>("/api/session"))!.User);
    }

    // ---- #18: the key ring is encrypted when a certificate is configured ----

    [TestMethod]
    public async Task Key_ring_is_encrypted_when_a_certificate_is_configured()
    {
        const string password = "test-password";
        var path = Path.Combine(Path.GetTempPath(), "ovi-dp-" + Guid.NewGuid().ToString("N") + ".pfx");
        using (var rsa = RSA.Create(2048))
        {
            var request = new CertificateRequest("CN=ovi-test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            using var certificate = request.CreateSelfSigned(
                DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
            await File.WriteAllBytesAsync(path, certificate.Export(X509ContentType.Pfx, password));
        }

        try
        {
            using var factory = new OviApiFactory(new()
            {
                [AuthSetup.CertificatePathKey] = path,
                [AuthSetup.CertificatePasswordKey] = password
            });
            await factory.CreateUserClientAsync("protected");

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var keys = await db.DataProtectionKeys.Select(k => k.Xml).ToListAsync();
            Assert.IsNotEmpty(keys);
            foreach (var xml in keys)
            {
                // Certificate protection wraps the secret in XML encryption keyed by the certificate, which is embedded
                // (public half only) so the app can still find the right key.
                StringAssert.Contains(xml, "X509Data");
                StringAssert.Contains(xml, "CipherValue");
                Assert.IsFalse(xml.Contains("masterKey", StringComparison.Ordinal), "key material was stored in the clear");
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    // ---- #19: the dev key can't run in production, and wrong keys are throttled ----

    [TestMethod]
    public void Api_keys_must_be_strong_outside_development()
    {
        Assert.IsNotNull(ApiKeyRules.Problem(ApiKeyRules.DevelopmentKey, isDevelopment: false));
        Assert.IsNotNull(ApiKeyRules.Problem("short-key", isDevelopment: false));
        Assert.IsNull(ApiKeyRules.Problem(new string('a', ApiKeyRules.MinLength), isDevelopment: false));
        Assert.IsNull(ApiKeyRules.Problem(ApiKeyRules.DevelopmentKey, isDevelopment: true));
        Assert.IsNull(ApiKeyRules.Problem(null, isDevelopment: false));
    }

    [TestMethod]
    public async Task Wrong_api_keys_are_throttled_per_client()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:ApiKeyFailuresPerMinute"] = "2" });
        var client = factory.CreateUnauthedClient();
        client.DefaultRequestHeaders.Add(CallerFilter.ApiKeyHeader, "guess");

        Assert.AreEqual(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/session")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/session")).StatusCode);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/session")).StatusCode);
    }
}
