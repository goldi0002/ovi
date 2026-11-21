using System.Collections.Concurrent;
using System.Net;
using System.Text;
using Microsoft.Extensions.Logging;

namespace Ovi.Api.Tests;

/// <summary>A recorded call to the fake Google Safe Browsing endpoint.</summary>
public sealed record SafeBrowsingCall(Uri Uri, string Body);

/// <summary>
/// Fake Google Safe Browsing: records every request and answers from <see cref="Respond"/>. By default every URL is
/// clean. <see cref="Flag"/> marks URLs as flagged.
/// </summary>
public sealed class FakeSafeBrowsing : HttpMessageHandler
{
    private readonly ConcurrentQueue<SafeBrowsingCall> _calls = new();

    public IReadOnlyList<SafeBrowsingCall> Calls => _calls.ToArray();

    /// <summary>Decides the response; takes the request body. Default: <c>{}</c> (nothing flagged).</summary>
    public Func<string, HttpResponseMessage> Respond { get; set; } = _ => Json("{}");

    /// <summary>When set, used instead of <see cref="Respond"/>; gets the body and the cancellation token (for timeout tests).</summary>
    public Func<string, CancellationToken, Task<HttpResponseMessage>>? RespondAsync { get; set; }

    public static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    /// <summary>Answers "flagged" for each URL in <paramref name="flagged"/> that appears in the request; clean otherwise.</summary>
    /// <param name="reported">Maps a requested URL to the URL Google reports (default: the same one).</param>
    public void Flag(Func<string, bool> flagged, Func<string, string>? reported = null) =>
        Respond = body =>
        {
            var urls = System.Text.Json.JsonDocument.Parse(body).RootElement
                .GetProperty("threatInfo").GetProperty("threatEntries").EnumerateArray()
                .Select(e => e.GetProperty("url").GetString()!).Where(flagged).ToList();
            if (urls.Count == 0) return Json("{}");
            var matches = urls.Select(u => new
            {
                threatType = "MALWARE", platformType = "ANY_PLATFORM", threatEntryType = "URL",
                threat = new { url = reported?.Invoke(u) ?? u }, cacheDuration = "300s",
            });
            return Json(System.Text.Json.JsonSerializer.Serialize(new { matches }));
        };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        _calls.Enqueue(new SafeBrowsingCall(request.RequestUri!, body));
        return RespondAsync is { } a ? await a(body, cancellationToken) : Respond(body);
    }
}

/// <summary>Collects every log line (category, level, formatted message and exception text).</summary>
public sealed class CapturingLoggerProvider : ILoggerProvider
{
    public sealed record Entry(string Category, LogLevel Level, string Text);

    private readonly ConcurrentQueue<Entry> _entries = new();
    public IReadOnlyList<Entry> Entries => _entries.ToArray();

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, _entries);
    public void Dispose() { }

    private sealed class Logger(string category, ConcurrentQueue<Entry> sink) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            sink.Enqueue(new Entry(category, logLevel, formatter(state, exception) + (exception is null ? "" : "\n" + exception)));
    }
}
