using Microsoft.EntityFrameworkCore;
using Ovi.Api.Accounts;
using Ovi.Api.Admin;
using Ovi.Api.Data;
using Ovi.Api.Infrastructure;
using Ovi.Api.Links;
using Ovi.Api.Security;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(DatabaseConfig.AppConnectionString(builder.Configuration)));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ShortUrlBuilder>();
builder.Services.AddSingleton<CodeSource>();
builder.Services.AddSingleton<ClickRecorder>();
builder.Services.AddHostedService<ClickRetentionService>();
builder.Services.AddOviRateLimits(builder.Configuration);
builder.Services.AddOviAuth(builder.Configuration, builder.Environment);
// Requests are small JSON bodies; refuse anything big before reading it.
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 64 * 1024);
builder.Services.AddProblemDetails();
builder.Services.AddOviOpenApi();
// The client's default logging would write request URIs; the Safe Browsing key is in the query string, so none of it.
builder.Services.AddHttpClient(SafeBrowsingUrlThreatCheck.HttpClientName, c => c.Timeout = Timeout.InfiniteTimeSpan) // the check bounds each call itself
    .RemoveAllLoggers();
builder.Services.AddSingleton<IUrlThreatCheck, SafeBrowsingUrlThreatCheck>();
var behindProxy = builder.Services.ConfigureReverseProxy(builder.Configuration);
if (builder.Configuration.GetValue("KeepAlive:Enabled", false))
{
    builder.Services.AddHttpClient(KeepAliveService.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(30));
    builder.Services.AddHostedService<KeepAliveService>();
}

var app = builder.Build();

// Fail fast on bad config, and warn about insecure defaults.
var publicBaseUrl = ShortUrlBuilder.ParseBaseUrl(ShortUrlBuilder.ConfiguredValue(app.Configuration));
var apiKey = app.Configuration["Auth:ApiKey"];
if (ApiKeyRules.Problem(apiKey, app.Environment.IsDevelopment()) is { } apiKeyProblem)
    throw new InvalidOperationException(apiKeyProblem);
if (string.IsNullOrEmpty(apiKey))
    app.Logger.LogWarning("Auth:ApiKey is not set; admin access with an API key is turned off.");
if (!AuthSetup.KeysAreEncrypted(app.Configuration) && !app.Environment.IsDevelopment())
    app.Logger.LogWarning("DataProtection:CertificatePath is not set; the sign-in key ring is stored unencrypted in the database.");
if (AuthSetup.EnabledProviders(app.Configuration).Count == 0)
    app.Logger.LogWarning("No sign-in provider is configured (Auth:Google / Auth:GitHub); only anonymous links can be made in the UI.");
if (publicBaseUrl is null && !app.Environment.IsDevelopment())
    app.Logger.LogWarning("App:PublicBaseUrl is not set; short URLs will be built from the request Host header.");

// Migrate over the direct (unpooled) connection, as Neon recommends for schema changes.
await using (var migrationDb = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
    .UseNpgsql(DatabaseConfig.MigrationConnectionString(app.Configuration)).Options))
{
    await migrationDb.Database.MigrateAsync();
}

if (behindProxy) app.UseForwardedHeaders();
// Baseline headers on every response (the UI's HTML adds a Content-Security-Policy on top).
app.Use((ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    ctx.Response.Headers.XFrameOptions = "DENY";
    return next(ctx);
});
// A body that can't be read (bad JSON, wrong types, too large) is the client's mistake: answer with its own status
// (400, 413), not 500. In Development the framework throws these instead of answering itself.
app.UseExceptionHandler(new ExceptionHandlerOptions
{
    StatusCodeSelector = ex => ex is BadHttpRequestException bad ? bad.StatusCode : StatusCodes.Status500InternalServerError,
});
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment()) app.UseHsts();
app.UseOviWebUi();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

if (app.Configuration.GetValue("Swagger:Enabled", app.Environment.IsDevelopment()))
{
    app.MapOpenApi();
    app.UseSwaggerUI(o => o.SwaggerEndpoint("/openapi/v1.json", "Ovi v1"));
}

app.MapGet("/health", async (AppDbContext db) =>
        await db.Database.CanConnectAsync()
            ? Results.Ok(new { status = "ok" })
            : Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Database unavailable"))
    .WithTags("Health");
// Liveness only: answers without touching the database, so keep-alive pings don't wake Neon.
app.MapGet("/health/live", () => Results.Ok(new { status = "ok" })).WithTags("Health");
app.MapAuthEndpoints();
app.MapLinkEndpoints();
app.MapAdminEndpoints();

await app.RunAsync();

public partial class Program;
