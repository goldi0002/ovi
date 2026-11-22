using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Ovi.Api.Data;
using Ovi.Api.Links;

namespace Ovi.Api.Tests;

/// <summary>Redirects remember a link briefly, so a popular link doesn't query the database on every visit.</summary>
[TestClass]
public sealed class RedirectCacheTests
{
    private static OviApiFactory Cached() => new(new() { ["Links:RedirectCacheSeconds"] = "15" });

    private static async Task CreateAsync(OviApiFactory factory, string url, string code)
    {
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links", new CreateLinkRequest(url, code));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
    }

    private static async Task<string?> VisitAsync(OviApiFactory factory, string code) =>
        (await factory.CreateUnauthedClient().GetAsync("/" + code)).Headers.Location?.ToString();

    private static async Task SetUrlInDatabaseAsync(OviApiFactory factory, string code, string url)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Links.Where(l => l.Code == code).ExecuteUpdateAsync(s => s.SetProperty(l => l.Url, url));
    }

    [TestMethod]
    public async Task A_followed_link_is_served_from_memory_until_it_goes_stale()
    {
        using var factory = Cached();
        await CreateAsync(factory, "https://example.com/old", "cached");
        Assert.AreEqual("https://example.com/old", await VisitAsync(factory, "cached"));

        await SetUrlInDatabaseAsync(factory, "cached", "https://example.com/new");
        Assert.AreEqual("https://example.com/old", await VisitAsync(factory, "cached"), "still fresh");

        factory.Time.Advance(TimeSpan.FromSeconds(16));
        Assert.AreEqual("https://example.com/new", await VisitAsync(factory, "cached"), "stale, so read again");
    }

    [TestMethod]
    public async Task Editing_a_link_takes_effect_at_once()
    {
        using var factory = Cached();
        await CreateAsync(factory, "https://example.com/old", "edited");
        await VisitAsync(factory, "edited");

        var res = await factory.CreateAuthedClient().PatchAsJsonAsync("/api/links/edited", new UpdateLinkRequest("https://example.com/new"));
        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.AreEqual("https://example.com/new", await VisitAsync(factory, "edited"));
    }

    [TestMethod]
    public async Task Deleting_a_link_takes_effect_at_once()
    {
        using var factory = Cached();
        await CreateAsync(factory, "https://example.com", "gone");
        await VisitAsync(factory, "gone");

        Assert.AreEqual(HttpStatusCode.NoContent, (await factory.CreateAuthedClient().DeleteAsync("/api/links/gone")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await factory.CreateUnauthedClient().GetAsync("/gone")).StatusCode);
    }

    [TestMethod]
    public async Task An_expired_link_stops_working_even_while_cached()
    {
        using var factory = Cached();
        var res = await factory.CreateAuthedClient().PostAsJsonAsync("/api/links",
            new CreateLinkRequest("https://example.com", "soon", factory.Time.GetUtcNow().AddSeconds(5)));
        Assert.AreEqual(HttpStatusCode.Created, res.StatusCode, await res.Content.ReadAsStringAsync());
        Assert.AreEqual(HttpStatusCode.Redirect, (await factory.CreateUnauthedClient().GetAsync("/soon")).StatusCode);

        factory.Time.Advance(TimeSpan.FromSeconds(6));
        Assert.AreEqual(HttpStatusCode.Gone, (await factory.CreateUnauthedClient().GetAsync("/soon")).StatusCode);
    }
}
