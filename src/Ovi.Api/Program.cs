using Microsoft.EntityFrameworkCore;
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
builder.Services.AddOviRateLimits(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.AddOviOpenApi();
var behindProxy = builder.Services.ConfigureReverseProxy(builder.Configuration);
if (builder.Configuration.GetValue("KeepAlive:Enabled", false))
{
    builder.Services.AddHttpClient(KeepAliveService.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(30));
    builder.Services.AddHostedService<KeepAliveService>();
}

var app = builder.Build();

// Fail fast on bad config, and warn about insecure defaults.
var publicBaseUrl = ShortUrlBuilder.ParseBaseUrl(ShortUrlBuilder.ConfiguredValue(app.Configuration));
if (string.IsNullOrEmpty(app.Configuration["Auth:ApiKey"]))
    app.Logger.LogWarning("Auth:ApiKey is not set; all /api/links requests will be rejected.");
if (publicBaseUrl is null && !app.Environment.IsDevelopment())
    app.Logger.LogWarning("App:PublicBaseUrl is not set; short URLs will be built from the request Host header.");

// Migrate over the direct (unpooled) connection, as Neon recommends for schema changes.
await using (var migrationDb = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
    .UseNpgsql(DatabaseConfig.MigrationConnectionString(app.Configuration)).Options))
{
    await migrationDb.Database.MigrateAsync();
}

if (behindProxy) app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment()) app.UseHsts();
app.UseOviWebUi();
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
app.MapLinkEndpoints();

await app.RunAsync();

public partial class Program;
