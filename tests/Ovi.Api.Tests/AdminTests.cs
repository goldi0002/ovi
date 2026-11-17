using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Accounts;
using Ovi.Api.Admin;
using Ovi.Api.Links;
using Ovi.Api.Security;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class AdminTests : IDisposable
{
    private readonly OviApiFactory _factory = new(new() { ["Auth:AdminEmails"] = "boss@example.com, Second@Example.com" });

    public void Dispose() => _factory.Dispose();

    private static readonly string[] AdminGets = ["/api/admin/overview", "/api/admin/users", "/api/admin/links"];

    private static async Task<LinkResponse> CreateAsync(HttpClient client, string url, string? code = null)
    {
        var res = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest(url, code));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
    }

    private async Task<int> UserIdAsync(string providerKey)
    {
        var users = await _factory.CreateAuthedClient().GetFromJsonAsync<PagedResponse<AdminUser>>($"/api/admin/users?q={providerKey}");
        return users!.Items.Single(u => u.Email == providerKey + "@example.com").Id;
    }

    // ---- Who gets in ----

    [TestMethod]
    public void Every_admin_route_is_guarded()
    {
        var endpoints = _factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText!.StartsWith("/api/admin", StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.IsGreaterThanOrEqualTo(5, endpoints.Count);
        foreach (var e in endpoints)
            Assert.IsNotNull(e.Metadata.GetMetadata<RequiresAdmin>(), $"{e.RoutePattern.RawText} has no admin guard");
    }

    [TestMethod]
    public async Task Visitors_get_401_and_users_get_403()
    {
        var anon = _factory.CreateUnauthedClient();
        var user = await _factory.CreateUserClientAsync("pleb");
        foreach (var path in AdminGets)
        {
            Assert.AreEqual(HttpStatusCode.Unauthorized, (await anon.GetAsync(path)).StatusCode, path);
            Assert.AreEqual(HttpStatusCode.Forbidden, (await user.GetAsync(path)).StatusCode, path);
        }
        Assert.AreEqual(HttpStatusCode.Forbidden, (await user.PostAsync("/api/admin/users/1/block", null)).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anon.PostAsync("/api/admin/users/1/block", null)).StatusCode);
    }

    [TestMethod]
    public async Task The_api_key_and_listed_verified_emails_are_admins()
    {
        var key = _factory.CreateAuthedClient();
        var boss = await _factory.CreateUserClientAsync("boss");
        var second = await _factory.CreateUserClientAsync("second"); // listed as Second@Example.com: case doesn't matter
        foreach (var path in AdminGets)
        {
            Assert.AreEqual(HttpStatusCode.OK, (await key.GetAsync(path)).StatusCode, path);
            Assert.AreEqual(HttpStatusCode.OK, (await boss.GetAsync(path)).StatusCode, path);
            Assert.AreEqual(HttpStatusCode.OK, (await second.GetAsync(path)).StatusCode, path);
        }
        var session = await boss.GetFromJsonAsync<SessionResponse>("/api/session");
        Assert.IsTrue(session!.Admin);
        Assert.IsTrue(session.User!.IsAdmin);
    }

    [TestMethod]
    public async Task A_listed_email_that_is_not_verified_is_not_an_admin()
    {
        var impostor = await _factory.CreateUserClientAsync("boss", emailVerified: false);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await impostor.GetAsync("/api/admin/overview")).StatusCode);
        Assert.IsFalse((await impostor.GetFromJsonAsync<SessionResponse>("/api/session"))!.Admin);
    }

    [TestMethod]
    public async Task Request_headers_cannot_make_a_user_an_admin()
    {
        var user = await _factory.CreateUserClientAsync("sneaky");
        user.DefaultRequestHeaders.Add("X-Api-Key", "guess");
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await user.GetAsync("/api/admin/overview")).StatusCode);

        var other = await _factory.CreateUserClientAsync("sneaky2");
        other.DefaultRequestHeaders.Add("X-Role", "admin");
        other.DefaultRequestHeaders.Add("X-Forwarded-User", "boss@example.com");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await other.GetAsync("/api/admin/overview")).StatusCode);
    }

    [TestMethod]
    public async Task Admin_changes_with_a_cookie_need_the_ovi_request_header()
    {
        await _factory.CreateUserClientAsync("victim");
        var boss = await _factory.CreateUserClientAsync("boss", csrfHeader: false);
        var id = await UserIdAsync("victim");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await boss.PostAsync($"/api/admin/users/{id}/block", null)).StatusCode);
    }

    [TestMethod]
    public void Admin_rights_come_only_from_a_verified_listed_email()
    {
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:AdminEmails"] = "a@x.test" }).Build();
        Assert.IsTrue(AdminAccess.IsAdmin("A@X.test", true, config));
        Assert.IsFalse(AdminAccess.IsAdmin("a@x.test", false, config));
        Assert.IsFalse(AdminAccess.IsAdmin("a@x.test.evil", true, config));
        Assert.IsFalse(AdminAccess.IsAdmin(null, true, config));
        Assert.IsFalse(AdminAccess.IsAdmin("", true, new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build()));
    }

    // ---- What admins see ----

    [TestMethod]
    public async Task Admins_see_and_delete_other_users_links()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        await CreateAsync(ada, "https://example.com/ada", "adas");
        var boss = await _factory.CreateUserClientAsync("boss");

        Assert.AreEqual(HttpStatusCode.OK, (await boss.GetAsync("/api/links/adas/stats")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NoContent, (await boss.DeleteAsync("/api/links/adas")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await ada.GetAsync("/api/links/adas")).StatusCode);
    }

    [TestMethod]
    public async Task Overview_counts_users_links_and_clicks()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        await CreateAsync(ada, "https://example.com/1", "top");
        await CreateAsync(_factory.CreateUnauthedClient(), "https://example.com/2");
        await _factory.CreateUnauthedClient().GetAsync("/top");
        await _factory.CreateUnauthedClient().GetAsync("/top");

        var o = await _factory.CreateAuthedClient().GetFromJsonAsync<AdminOverview>("/api/admin/overview");
        Assert.AreEqual(1, o!.Users);
        Assert.AreEqual(2, o.Links);
        Assert.AreEqual(1, o.AnonymousLinks);
        Assert.AreEqual(2L, o.TotalClicks);
        Assert.AreEqual(AdminEndpoints.OverviewDays, o.DailyClicks.Count);
        Assert.AreEqual(2, o.DailyClicks[^1].Count);
        Assert.AreEqual(1, o.DailySignups[^1].Count);
        Assert.AreEqual("top", o.TopLinks[0].Code);
        Assert.AreEqual("User ada", o.TopLinks[0].OwnerName);
    }

    [TestMethod]
    public async Task Users_list_shows_link_counts_roles_and_searches()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        await CreateAsync(ada, "https://example.com/1");
        await CreateAsync(ada, "https://example.com/2");
        await _factory.CreateUserClientAsync("boss");

        var all = await _factory.CreateAuthedClient().GetFromJsonAsync<PagedResponse<AdminUser>>("/api/admin/users");
        Assert.AreEqual(2, all!.Total);
        var adaRow = all.Items.Single(u => u.Name == "User ada");
        Assert.AreEqual(2, adaRow.Links);
        Assert.IsFalse(adaRow.IsAdmin);
        Assert.IsTrue(all.Items.Single(u => u.Name == "User boss").IsAdmin);

        var found = await _factory.CreateAuthedClient().GetFromJsonAsync<PagedResponse<AdminUser>>("/api/admin/users?q=ADA");
        CollectionAssert.AreEqual(new[] { "User ada" }, found!.Items.Select(u => u.Name).ToArray());
        var wildcard = await _factory.CreateAuthedClient().GetFromJsonAsync<PagedResponse<AdminUser>>("/api/admin/users?q=%25");
        Assert.AreEqual(0, wildcard!.Total, "% is searched literally, not as a wildcard");
    }

    [TestMethod]
    public async Task Links_list_shows_owners_and_filters()
    {
        var ada = await _factory.CreateUserClientAsync("ada");
        await CreateAsync(ada, "https://example.com/ada", "adas");
        await CreateAsync(_factory.CreateUnauthedClient(), "https://example.com/anon");
        await CreateAsync(_factory.CreateAuthedClient(), "https://example.com/key", "keys");
        var admin = _factory.CreateAuthedClient();

        var all = await admin.GetFromJsonAsync<PagedResponse<AdminLink>>("/api/admin/links");
        Assert.AreEqual(3, all!.Total);
        Assert.AreEqual("User ada", all.Items.Single(l => l.Link.Code == "adas").Owner!.Name);

        async Task<string[]> Codes(string query) =>
            (await admin.GetFromJsonAsync<PagedResponse<AdminLink>>("/api/admin/links?" + query))!.Items.Select(l => l.Link.Code).ToArray();
        Assert.AreEqual(1, (await Codes("owner=anonymous")).Length);
        CollectionAssert.AreEqual(new[] { "keys" }, await Codes("owner=apikey"));
        CollectionAssert.AreEqual(new[] { "adas" }, await Codes($"owner={await UserIdAsync("ada")}"));
        CollectionAssert.AreEqual(new[] { "adas" }, await Codes("q=example.com/ada"));
        Assert.AreEqual(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/admin/links?owner=bogus")).StatusCode);
    }

    // ---- Suspending accounts ----

    [TestMethod]
    public async Task Suspending_a_user_locks_them_out_and_disables_their_links_until_unblocked()
    {
        var spammer = await _factory.CreateUserClientAsync("spammer");
        await CreateAsync(spammer, "https://example.com/spam", "spam1");
        var id = await UserIdAsync("spammer");
        var boss = await _factory.CreateUserClientAsync("boss");

        Assert.AreEqual(HttpStatusCode.NoContent, (await boss.PostAsync($"/api/admin/users/{id}/block", null)).StatusCode);

        Assert.AreEqual(HttpStatusCode.Forbidden, (await spammer.GetAsync("/api/links")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Gone, (await _factory.CreateUnauthedClient().GetAsync("/spam1")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Gone, (await _factory.CreateUnauthedClient().GetAsync("/spam1/qr")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await _factory.CreateUnauthedClient().GetAsync("/test-only/login?key=spammer")).StatusCode);

        Assert.AreEqual(HttpStatusCode.NoContent, (await boss.PostAsync($"/api/admin/users/{id}/unblock", null)).StatusCode);
        Assert.AreEqual(HttpStatusCode.Redirect, (await _factory.CreateUnauthedClient().GetAsync("/spam1")).StatusCode);
    }

    [TestMethod]
    public async Task Admins_cannot_suspend_themselves_or_other_admins()
    {
        var boss = await _factory.CreateUserClientAsync("boss");
        await _factory.CreateUserClientAsync("second");
        Assert.AreEqual(HttpStatusCode.BadRequest, (await boss.PostAsync($"/api/admin/users/{await UserIdAsync("boss")}/block", null)).StatusCode);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await boss.PostAsync($"/api/admin/users/{await UserIdAsync("second")}/block", null)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await boss.PostAsync("/api/admin/users/99999/block", null)).StatusCode);
    }
}
