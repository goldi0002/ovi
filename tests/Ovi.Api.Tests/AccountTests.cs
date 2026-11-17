using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Accounts;
using Ovi.Api.Data;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class AccountTests : IDisposable
{
    private readonly OviApiFactory _factory = new(new()
    {
        ["Auth:Google:ClientId"] = "google-id",
        ["Auth:Google:ClientSecret"] = "google-secret",
        ["Links:BlockedHosts"] = "spam.example, bad.test",
    });

    public void Dispose() => _factory.Dispose();

    private static async Task<LinkResponse> CreateAsync(HttpClient client, CreateLinkRequest request)
    {
        var res = await client.PostAsJsonAsync("/api/links", request);
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
    }

    private static async Task<string> ErrorFor(HttpResponseMessage res, string field)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, await res.Content.ReadAsStringAsync());
        var problem = await res.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        return problem.GetProperty("errors").GetProperty(field)[0].GetString()!;
    }

    // ---- Session ----

    [TestMethod]
    public async Task Session_lists_enabled_providers_and_the_signed_in_user()
    {
        var anon = await _factory.CreateUnauthedClient().GetFromJsonAsync<SessionResponse>("/api/session");
        Assert.IsNull(anon!.User);
        Assert.IsFalse(anon.Admin);
        CollectionAssert.AreEqual(new[] { "google" }, anon.Providers.ToArray());
        Assert.AreEqual(30, anon.AnonymousLinkDays);

        var user = await (await _factory.CreateUserClientAsync("ada")).GetFromJsonAsync<SessionResponse>("/api/session");
        Assert.AreEqual("User ada", user!.User!.Name);
        Assert.AreEqual("ada@example.com", user.User.Email);

        var admin = await _factory.CreateAuthedClient().GetFromJsonAsync<SessionResponse>("/api/session");
        Assert.IsTrue(admin!.Admin);
    }

    [TestMethod]
    public async Task Signing_in_again_reuses_the_account()
    {
        await _factory.CreateUserClientAsync("same");
        await _factory.CreateUserClientAsync("same");
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.AreEqual(1, await db.Users.CountAsync(u => u.ProviderKey == "same"));
    }

    [TestMethod]
    public async Task Logout_ends_the_session()
    {
        var client = await _factory.CreateUserClientAsync();
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.PostAsync("/api/logout", null)).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/links")).StatusCode);
    }

    [TestMethod]
    public async Task Session_cookie_is_http_only_and_same_site()
    {
        var res = await _factory.CreateUnauthedClient().GetAsync("/test-only/login?key=cookie");
        var cookie = res.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(AuthSetup.CookieName));
        StringAssert.Contains(cookie, "httponly");
        StringAssert.Contains(cookie, "samesite=lax");
    }

    // ---- Login redirects ----

    [TestMethod]
    public async Task Login_redirects_to_the_provider_and_back_to_a_local_page_only()
    {
        var res = await _factory.CreateUnauthedClient().GetAsync("/auth/login/google?returnUrl=/links");
        Assert.AreEqual(HttpStatusCode.Redirect, res.StatusCode);
        var location = res.Headers.Location!;
        Assert.AreEqual("accounts.google.com", location.Host);
        StringAssert.Contains(Uri.UnescapeDataString(location.Query), "redirect_uri=http://localhost/auth/callback/google");
    }

    [TestMethod]
    public async Task Login_with_a_provider_that_is_not_configured_is_404()
    {
        Assert.AreEqual(HttpStatusCode.NotFound, (await _factory.CreateUnauthedClient().GetAsync("/auth/login/github")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await _factory.CreateUnauthedClient().GetAsync("/auth/login/myspace")).StatusCode);
    }

    [TestMethod]
    [DataRow("/links", "/links")]
    [DataRow("/", "/")]
    [DataRow(null, "/")]
    [DataRow("https://evil.example/", "/")]
    [DataRow("//evil.example/", "/")]
    [DataRow("/\\evil.example", "/")]
    [DataRow("links", "/")]
    [DataRow("/\t/evil.example", "/")]
    [DataRow("/\t\\evil.example", "/")]
    [DataRow("/\n/evil.example", "/")]
    [DataRow("/\r\n/evil.example", "/")]
    [DataRow("/ /evil.example", "/")]
    [DataRow("/links\\..\\x", "/")]
    [DataRow("/links?tab=all#top", "/links?tab=all#top")]
    public void Return_urls_stay_on_this_site(string? given, string expected) =>
        Assert.AreEqual(expected, AuthEndpoints.SafeReturnUrl(given));

    // ---- Ownership ----

    [TestMethod]
    public async Task Users_see_and_manage_only_their_own_links_and_the_admin_sees_all()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        var bob = await _factory.CreateUserClientAsync("bob");
        await CreateAsync(ada, new CreateLinkRequest("https://example.com/ada", "adas"));
        await CreateAsync(bob, new CreateLinkRequest("https://example.com/bob", "bobs"));
        await CreateAsync(_factory.CreateUnauthedClient(), new CreateLinkRequest("https://example.com/anon"));

        var adasList = await ada.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links");
        CollectionAssert.AreEqual(new[] { "adas" }, adasList!.Items.Select(l => l.Code).ToArray());
        Assert.AreEqual(1, adasList.Total);

        Assert.AreEqual(HttpStatusCode.NotFound, (await ada.GetAsync("/api/links/bobs")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await ada.GetAsync("/api/links/bobs/stats")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await ada.DeleteAsync("/api/links/bobs")).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await bob.GetAsync("/api/links/bobs")).StatusCode);

        var all = await _factory.CreateAuthedClient().GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links");
        Assert.AreEqual(3, all!.Total);

        Assert.AreEqual(HttpStatusCode.NoContent, (await ada.DeleteAsync("/api/links/adas")).StatusCode);
    }

    [TestMethod]
    public async Task Changes_with_a_session_cookie_need_the_ovi_request_header()
    {
        var client = await _factory.CreateUserClientAsync("csrf", csrfHeader: false);

        var create = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com"));
        Assert.AreEqual(HttpStatusCode.Forbidden, create.StatusCode);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await client.PostAsync("/api/logout", null)).StatusCode);
        // Reading is fine without it.
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/links")).StatusCode);
    }

    // ---- Anonymous links ----

    [TestMethod]
    public async Task Anonymous_links_expire_after_30_days_and_cannot_pick_a_code()
    {
        var anon = _factory.CreateUnauthedClient();
        var now = _factory.Time.GetUtcNow();

        var link = await CreateAsync(anon, new CreateLinkRequest("https://example.com/anon"));
        Assert.AreEqual(now.AddDays(30).UtcDateTime, link.ExpiresAt);

        var sooner = await CreateAsync(anon, new CreateLinkRequest("https://example.com/soon", ExpiresAt: now.AddDays(2)));
        Assert.AreEqual(now.AddDays(2).UtcDateTime, sooner.ExpiresAt);

        StringAssert.Contains(await ErrorFor(await anon.PostAsJsonAsync("/api/links",
            new CreateLinkRequest("https://example.com", "mine")), "customCode"), "Sign in");
        StringAssert.Contains(await ErrorFor(await anon.PostAsJsonAsync("/api/links",
            new CreateLinkRequest("https://example.com", ExpiresAt: now.AddDays(31))), "expiresAt"), "30 days");

        using var scope = _factory.Services.CreateScope();
        var stored = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Links.SingleAsync(l => l.Code == link.Code);
        Assert.IsTrue(stored.Anonymous);
        Assert.IsNull(stored.OwnerId);
    }

    [TestMethod]
    public async Task Signed_in_links_never_expire_unless_asked_and_at_most_10_years_out()
    {
        var user = await _factory.CreateUserClientAsync();
        Assert.IsNull((await CreateAsync(user, new CreateLinkRequest("https://example.com"))).ExpiresAt);
        StringAssert.Contains(await ErrorFor(await user.PostAsJsonAsync("/api/links",
            new CreateLinkRequest("https://example.com", ExpiresAt: _factory.Time.GetUtcNow().AddYears(11))), "expiresAt"), "10 years");
    }

    [TestMethod]
    public async Task Anonymous_creation_has_its_own_hourly_limit()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:AnonymousCreatePerHour"] = "2" }, IPAddress.Parse("203.0.113.9"));
        var anon = factory.CreateUnauthedClient();
        for (var i = 0; i < 2; i++)
            await CreateAsync(anon, new CreateLinkRequest($"https://example.com/{i}"));
        Assert.AreEqual(HttpStatusCode.TooManyRequests,
            (await anon.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/3"))).StatusCode);

        // Signed-in users from the same address aren't affected.
        await CreateAsync(await factory.CreateUserClientAsync(), new CreateLinkRequest("https://example.com/4"));
    }

    // ---- Validation ----

    [TestMethod]
    [DataRow("", "Enter a URL")]
    [DataRow("   ", "Enter a URL")]
    [DataRow("example.com", "full web address")]
    [DataRow("ftp://example.com/file", "full web address")]
    [DataRow("javascript:alert(1)", "full web address")]
    [DataRow("https://exa mple.com", "full web address")]
    [DataRow("https://bank.example@evil.example/login", "user name or password")]
    [DataRow("https://spam.example/buy", "can't be created")]
    [DataRow("https://www.bad.test/", "can't be created")]
    [DataRow("http://localhost/abc", "already an Ovi link")]
    public async Task Bad_urls_get_a_clear_message(string url, string message)
    {
        var res = await _factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest(url));
        StringAssert.Contains(await ErrorFor(res, "url"), message);
    }

    [TestMethod]
    public async Task Urls_are_trimmed()
    {
        var link = await CreateAsync(_factory.CreateAuthedClient(), new CreateLinkRequest("  https://example.com/x  "));
        Assert.AreEqual("https://example.com/x", link.Url);
    }

    [TestMethod]
    public async Task A_missing_or_oversized_body_is_rejected()
    {
        var client = _factory.CreateAuthedClient();
        var empty = await client.PostAsync("/api/links", new StringContent("", System.Text.Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.BadRequest, empty.StatusCode);

        var huge = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/" + new string('a', 100_000)));
        Assert.IsTrue(huge.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge, huge.StatusCode.ToString());
    }
}
