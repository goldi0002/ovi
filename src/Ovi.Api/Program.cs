using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;
using Ovi.Api.Infrastructure;
using Ovi.Api.Links;
using Ovi.Api.Security;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=ovi.db"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ShortUrlBuilder>();
builder.Services.AddOviRateLimits(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.AddOviOpenApi();
var behindProxy = builder.Services.ConfigureReverseProxy(builder.Configuration);

var app = builder.Build();

// Fail fast on bad config, and warn about insecure defaults.
var publicBaseUrl = ShortUrlBuilder.ParseBaseUrl(app.Configuration["App:PublicBaseUrl"]);
if (string.IsNullOrEmpty(app.Configuration["Auth:ApiKey"]))
    app.Logger.LogWarning("Auth:ApiKey is not set; all /api/links requests will be rejected.");
if (publicBaseUrl is null && !app.Environment.IsDevelopment())
    app.Logger.LogWarning("App:PublicBaseUrl is not set; short URLs will be built from the request Host header.");

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

if (behindProxy) app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment()) app.UseHsts();
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
app.MapLinkEndpoints();

app.Run();

public partial class Program;
