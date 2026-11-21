using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Data;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

/// <summary>Bulk create with per-link custom codes and expiries (the <c>items</c> shape of POST /api/links/bulk).</summary>
[TestClass]
public sealed class BulkItemsTests : IDisposable
{
    private const string Route = "/api/links/bulk";
    private readonly OviApiFactory _factory = new();

    public void Dispose() => _factory.Dispose();

    private static Task<HttpResponseMessage> PostAsync(HttpClient client, List<BulkLinkItem?> items, DateTimeOffset? expiresAt = null) =>
        client.PostAsJsonAsync(Route, new BulkCreateLinksRequest(null, expiresAt, items));

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

    [TestMethod]
    public async Task Mixes_custom_and_random_codes_and_per_link_expiry_in_input_order()
    {
        var client = await _factory.CreateUserClientAsync();
        var soon = _factory.Time.GetUtcNow().AddDays(2);
        var later = _factory.Time.GetUtcNow().AddDays(9);

        var res = await PostAsync(client,
        [
            new("https://example.com/a", "spring-sale", soon),
            new("https://example.com/b"),
            new("https://example.com/c", " menu ", null),
        ], later);

        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        var items = (await res.Content.ReadFromJsonAsync<BulkCreateLinksResponse>())!.Items;
        CollectionAssert.AreEqual(new[] { "https://example.com/a", "https://example.com/b", "https://example.com/c" }, items.Select(i => i.Url).ToArray());
        Assert.AreEqual("spring-sale", items[0].Code);
        Assert.AreEqual(7, items[1].Code.Length);
        Assert.AreEqual("menu", items[2].Code, "codes are trimmed");
        Assert.IsTrue((soon.UtcDateTime - items[0].ExpiresAt!.Value).Duration() < TimeSpan.FromSeconds(1));
        Assert.IsTrue((later.UtcDateTime - items[1].ExpiresAt!.Value).Duration() < TimeSpan.FromSeconds(1), "the request's expiry fills in");
        Assert.IsTrue((later.UtcDateTime - items[2].ExpiresAt!.Value).Duration() < TimeSpan.FromSeconds(1));
        Assert.AreEqual((HttpStatusCode)302, (await _factory.CreateClient(new() { AllowAutoRedirect = false }).GetAsync("/spring-sale")).StatusCode);
    }

    [TestMethod]
    public async Task Sending_both_urls_and_items_is_a_400()
    {
        var client = await _factory.CreateUserClientAsync();
        var res = await client.PostAsJsonAsync(Route, new BulkCreateLinksRequest(["https://example.com"], null, [new("https://example.com")]));
        Assert.IsTrue((await ErrorsAsync(res)).ContainsKey("items"));
        Assert.AreEqual(0, await LinkCountAsync());
    }

    [TestMethod]
    public async Task An_empty_or_oversized_items_list_is_a_400_under_items()
    {
        var client = await _factory.CreateUserClientAsync();
        Assert.IsTrue((await ErrorsAsync(await PostAsync(client, []))).ContainsKey("items"));
        var many = Enumerable.Range(0, 26).Select(i => (BulkLinkItem?)new($"https://example.com/{i}")).ToList();
        Assert.IsTrue((await ErrorsAsync(await PostAsync(client, many))).ContainsKey("items"));
        Assert.AreEqual(0, await LinkCountAsync());
    }

    [TestMethod]
    public async Task Every_bad_item_is_reported_and_nothing_is_created()
    {
        var client = await _factory.CreateUserClientAsync();
        var past = _factory.Time.GetUtcNow().AddDays(-1);

        var errors = await ErrorsAsync(await PostAsync(client,
        [
            new("https://example.com/ok", "fine-one"),
            new("not a url"),
            new("https://example.com/x", "a!"),
            new("https://example.com/y", "api"),
            new("https://example.com/z", null, past),
            null,
            new("https://example.com/dup", "fine-one"),
        ]));

        CollectionAssert.AreEquivalent(
            new[] { "items[1].url", "items[2].customCode", "items[3].customCode", "items[4].expiresAt", "items[5].url", "items[6].customCode" },
            errors.Keys.ToArray());
        StringAssert.Contains(errors["items[6].customCode"][0], "twice");
        Assert.AreEqual(0, await LinkCountAsync());
    }

    [TestMethod]
    public async Task A_taken_or_deleted_code_fails_the_batch_and_costs_nothing()
    {
        using var factory = new OviApiFactory(new() { ["RateLimits:CreatePerMinute"] = "3" });
        var client = await factory.CreateUserClientAsync();
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/1", "taken1"))).StatusCode);
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/2", "gone1"))).StatusCode);
        // These two used 2 of 3 permits.

        var res = await client.PostAsJsonAsync(Route, new BulkCreateLinksRequest(null, null, [new("https://example.com/a", "taken1"), new("https://example.com/b", "gone1")]));
        var errors = await ErrorsAsync(res);
        StringAssert.Contains(errors["items[0].customCode"][0], "already taken");
        StringAssert.Contains(errors["items[1].customCode"][0], "already taken");

        // A refused batch used no permits, so the one left still works.
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync(Route, new BulkCreateLinksRequest(null, null, [new("https://example.com/c", "fresh1")]))).StatusCode);
    }

    [TestMethod]
    public async Task A_deleted_links_code_cannot_be_reused()
    {
        var client = await _factory.CreateUserClientAsync();
        Assert.AreEqual(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/links", new CreateLinkRequest("https://example.com/1", "oldone"))).StatusCode);
        Assert.AreEqual(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/links/oldone")).StatusCode);

        var errors = await ErrorsAsync(await PostAsync(client, [new("https://example.com/2", "oldone")]));
        StringAssert.Contains(errors["items[0].customCode"][0], "deleted");
    }

    [TestMethod]
    public async Task Anonymous_callers_still_get_401()
    {
        var res = await _factory.CreateClient().PostAsJsonAsync(Route, new BulkCreateLinksRequest(null, null, [new("https://example.com", "mine")]));
        Assert.AreEqual(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
