using System.Collections.Concurrent;
using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Ovi.Api.Infrastructure;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class KeepAliveTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [TestMethod]
    public void Url_defaults_to_the_public_base_url_liveness_endpoint()
    {
        Assert.AreEqual("https://ovi-abc1.onrender.com/health/live",
            KeepAliveService.ResolveUrl(Config(new() { ["RENDER_EXTERNAL_URL"] = "https://ovi-abc1.onrender.com" }))!.ToString());
        Assert.AreEqual("https://ovi.example/health/live",
            KeepAliveService.ResolveUrl(Config(new() { ["App:PublicBaseUrl"] = "https://ovi.example/" }))!.ToString());
        Assert.AreEqual("https://elsewhere.example/ping",
            KeepAliveService.ResolveUrl(Config(new() { ["KeepAlive:Url"] = "https://elsewhere.example/ping", ["App:PublicBaseUrl"] = "https://ovi.example" }))!.ToString());
        Assert.IsNull(KeepAliveService.ResolveUrl(Config(new())));
    }

    [TestMethod]
    public void Interval_defaults_to_ten_minutes()
    {
        Assert.AreEqual(TimeSpan.FromMinutes(10), KeepAliveService.ResolveInterval(Config(new())));
        Assert.AreEqual(TimeSpan.FromMinutes(5), KeepAliveService.ResolveInterval(Config(new() { ["KeepAlive:IntervalMinutes"] = "5" })));
        Assert.AreEqual(TimeSpan.FromMinutes(10), KeepAliveService.ResolveInterval(Config(new() { ["KeepAlive:IntervalMinutes"] = "0" })));
    }

    [TestMethod]
    public async Task Pings_the_url_once_per_interval_and_survives_failures()
    {
        var time = new FakeTimeProvider();
        var handler = new RecordingHandler(failFirst: true);
        using var service = new KeepAliveService(new SingleClientFactory(handler),
            Config(new() { ["App:PublicBaseUrl"] = "https://ovi.example" }), time, NullLogger<KeepAliveService>.Instance);

        await service.StartAsync(CancellationToken.None);
        Assert.IsTrue(handler.Requests.IsEmpty, "no ping before the first interval");

        time.Advance(TimeSpan.FromMinutes(10));
        await handler.WaitForAsync(1);
        time.Advance(TimeSpan.FromMinutes(10));
        await handler.WaitForAsync(2);

        await service.StopAsync(CancellationToken.None);
        CollectionAssert.AreEqual(
            new[] { "https://ovi.example/health/live", "https://ovi.example/health/live" },
            handler.Requests.ToArray());
    }

    [TestMethod]
    public async Task Health_live_answers_without_the_database()
    {
        using var factory = new OviApiFactory();
        var res = await factory.CreateUnauthedClient().GetAsync("/health/live");
        Assert.AreEqual(HttpStatusCode.OK, res.StatusCode);
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class RecordingHandler(bool failFirst) : HttpMessageHandler
    {
        public ConcurrentQueue<string> Requests { get; } = new();
        private readonly SemaphoreSlim _signal = new(0);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Enqueue(request.RequestUri!.ToString());
            _signal.Release();
            if (failFirst && Requests.Count == 1) throw new HttpRequestException("simulated network error");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }

        public async Task WaitForAsync(int count)
        {
            Assert.IsTrue(await _signal.WaitAsync(TimeSpan.FromSeconds(10)), $"expected ping #{count}");
        }
    }
}
