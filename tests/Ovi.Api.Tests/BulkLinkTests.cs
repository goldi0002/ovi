using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Data;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

/// <summary>Bulk create (POST /api/links/bulk): the happy path, per-item validation and basic access. Limits, the budget, codes and every other edge case are in BulkLinkEdgeTests.</summary>
[TestClass]
public sealed class BulkLinkTests : IDisposable
{
    private const string Route = "/api/links/bulk";
    private readonly OviApiFactory _factory = new();

    public void Dispose() => _factory.Dispose();

    private static Task<HttpResponseMessage> PostAsync(HttpClient client, IEnumerable<string?> urls, DateTimeOffset? expiresAt = null) =>
        client.PostAsJsonAsync(Route, new BulkCreateLinksRequest(urls.ToList(), expiresAt));

    private static async Task<List<LinkResponse>> CreatedAsync(HttpResponseMessage res)
    {
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<BulkCreateLinksResponse>())!.Items.ToList();
    }

    private static async Task<IDictionary<string, string[]>> ErrorsAsync(HttpResponseMessage res)
    {
        Assert.AreEqual(HttpStatusCode.BadRequest, res.StatusCode, await res.Content.ReadAsStringAsync());
        return (await res.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors;
    }

    private async Task<int> LinkCountAsync()
    {
        using var scope = _factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Links.IgnoreQueryFilters().CountAsync();
    }

    // ---- Success ----

    [TestMethod]
    public async Task Creates_every_link_in_input_order_with_random_codes()
    {
        var client = await _factory.CreateUserClientAsync();
        string[] input = ["https://example.com/1", "https://example.com/2", "https://example.com/1"];

        var res = await PostAsync(client, input);
        var links = await CreatedAsync(res);

        CollectionAssert.AreEqual(input, links.Select(l => l.Url).ToArray());
        Assert.AreEqual(3, links.Select(l => l.Code).Distinct().Count(), "repeats get their own link");
        Assert.IsTrue(links.All(l => l.Code.Length == 7 && l.ShortUrl.EndsWith("/" + l.Code) && l.QrCodeUrl == l.ShortUrl + "/qr"));
        Assert.IsTrue(links.All(l => l.ExpiresAt is null && l.Clicks == 0));
        Assert.AreEqual(1, links.Select(l => l.CreatedAt).Distinct().Count(), "one time for the whole batch");
        Assert.IsNull(res.Headers.Location);

        foreach (var link in links)
        {
            var visit = await client.GetAsync("/" + link.Code);
            Assert.AreEqual(HttpStatusCode.Redirect, visit.StatusCode);
            Assert.AreEqual(link.Url, visit.Headers.Location!.ToString());
        }
    }

    [TestMethod]
    public async Task Links_belong_to_the_user_and_show_in_their_list_only()
    {
        var user = await _factory.CreateUserClientAsync("bulk-owner");
        var links = await CreatedAsync(await PostAsync(user, ["https://example.com/a", "https://example.com/b"]));

        var mine = (await user.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links"))!;
        CollectionAssert.AreEquivalent(links.Select(l => l.Code).ToList(), mine.Items.Select(l => l.Code).ToList());

        var other = await _factory.CreateUserClientAsync("someone-else");
        Assert.AreEqual(0, (await other.GetFromJsonAsync<PagedResponse<LinkResponse>>("/api/links"))!.Total);
        Assert.AreEqual(HttpStatusCode.NotFound, (await other.GetAsync($"/api/links/{links[0].Code}")).StatusCode);
    }


    [TestMethod]
    public async Task Expiry_applies_to_every_link()
    {
        var expiresAt = _factory.Time.GetUtcNow().AddDays(7);
        var links = await CreatedAsync(await PostAsync(_factory.CreateAuthedClient(), ["https://example.com/1", "https://example.com/2"], expiresAt));

        Assert.IsTrue(links.All(l => l.ExpiresAt == expiresAt.UtcDateTime));
    }

    [TestMethod]
    public async Task Urls_are_stored_like_single_create_does()
    {
        var links = await CreatedAsync(await PostAsync(_factory.CreateAuthedClient(), ["  https://bücher.example/straße  "]));

        Assert.AreEqual("https://xn--bcher-kva.example/stra%C3%9Fe", links[0].Url);
        Assert.AreEqual(HttpStatusCode.Redirect, (await _factory.CreateUnauthedClient().GetAsync("/" + links[0].Code)).StatusCode);
    }

    [TestMethod]
    public async Task Single_create_and_edit_also_store_punycode_hosts()
    {
        var client = _factory.CreateAuthedClient();
        var res = await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://bücher.example/a"));
        var created = (await res.Content.ReadFromJsonAsync<LinkResponse>())!;
        Assert.AreEqual("https://xn--bcher-kva.example/a", created.Url);

        var edited = await client.PatchAsJsonAsync($"/api/links/{created.Code}", new UpdateLinkRequest("https://日本.example/b"));
        Assert.AreEqual("https://xn--wgv71a.example/b", (await edited.Content.ReadFromJsonAsync<LinkResponse>())!.Url);
    }



    // ---- Validation ----

    [TestMethod]
    public async Task Every_bad_url_is_reported_by_position_with_the_single_create_message_and_nothing_is_created()
    {
        var res = await PostAsync(_factory.CreateAuthedClient(),
        [
            "https://example.com/ok",
            "",
            null,
            "example.com",
            "https://bank.example@evil.example/login",
            "http://localhost/abc",
            "https://example.com/" + new string('a', LinkRules.MaxUrlLength),
            "https://example.com/‮gpj.exe",
        ]);

        var errors = await ErrorsAsync(res);
        Assert.AreEqual(7, errors.Count);
        Assert.IsFalse(errors.ContainsKey("urls[0]"));
        Assert.AreEqual("Enter a URL to shorten.", errors["urls[1]"].Single());
        Assert.AreEqual("Enter a URL to shorten.", errors["urls[2]"].Single());
        Assert.AreEqual("Enter a full web address starting with http:// or https://.", errors["urls[3]"].Single());
        Assert.AreEqual("URLs with a user name or password in them can't be shortened.", errors["urls[4]"].Single());
        Assert.AreEqual("That URL is already an Ovi link.", errors["urls[5]"].Single());
        StringAssert.Contains(errors["urls[6]"].Single(), "too long");
        Assert.AreEqual("The URL contains characters that can't be shortened.", errors["urls[7]"].Single());
        Assert.AreEqual(0, await LinkCountAsync());
    }

    [TestMethod]
    public async Task Blocked_hosts_are_refused()
    {
        using var factory = new OviApiFactory(new() { ["Links:BlockedHosts"] = "spam.example" });
        var res = await PostAsync(factory.CreateAuthedClient(), ["https://ok.example/", "https://www.spam.example/x"]);

        var errors = await ErrorsAsync(res);
        Assert.AreEqual("Links to this site can't be created.", errors["urls[1]"].Single());
        Assert.AreEqual(1, errors.Count);
    }

    [TestMethod]
    public async Task Bad_expiry_is_reported_with_the_url_errors()
    {
        var res = await PostAsync(_factory.CreateAuthedClient(), ["nope"], _factory.Time.GetUtcNow().AddHours(-1));

        var errors = await ErrorsAsync(res);
        Assert.AreEqual("The expiry date must be in the future.", errors["expiresAt"].Single());
        Assert.IsTrue(errors.ContainsKey("urls[0]"));
    }

    [TestMethod]
    public async Task Expiry_more_than_ten_years_away_is_refused()
    {
        var res = await PostAsync(_factory.CreateAuthedClient(), ["https://example.com"], _factory.Time.GetUtcNow().AddYears(11));
        StringAssert.Contains((await ErrorsAsync(res))["expiresAt"].Single(), "10 years");
    }





    // ---- Access ----

    [TestMethod]
    public async Task Anonymous_callers_must_sign_in_and_nothing_is_created()
    {
        var res = await PostAsync(_factory.CreateUnauthedClient(), ["https://example.com"]);

        Assert.AreEqual(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.AreEqual("Sign in to shorten many links at once.", (await res.Content.ReadFromJsonAsync<ProblemDetails>())!.Title);
        Assert.AreEqual(0, await LinkCountAsync());
    }

    [TestMethod]
    public async Task Cookie_requests_need_the_csrf_header()
    {
        var client = await _factory.CreateUserClientAsync(csrfHeader: false);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await PostAsync(client, ["https://example.com"])).StatusCode);
        Assert.AreEqual(0, await LinkCountAsync());
    }

    [TestMethod]
    public async Task Wrong_api_key_is_refused()
    {
        var client = _factory.CreateUnauthedClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", "wrong");
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await PostAsync(client, ["https://example.com"])).StatusCode);
    }
}
