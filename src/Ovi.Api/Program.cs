using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using Ovi.Api.Data;
using Ovi.Api.Links;
using Ovi.Api.Security;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=ovi.db"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddOviRateLimits(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    var scheme = new OpenApiSecurityScheme
    {
        Name = ApiKeyFilter.HeaderName,
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "ApiKey" }
    };
    c.AddSecurityDefinition("ApiKey", scheme);
    c.AddSecurityRequirement(new OpenApiSecurityRequirement { [scheme] = [] });
});

var app = builder.Build();

if (string.IsNullOrEmpty(app.Configuration["Auth:ApiKey"]))
{
    app.Logger.LogWarning("Auth:ApiKey is not set; all /api/links requests will be rejected.");
}

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

app.UseExceptionHandler();
app.UseRateLimiter();
app.UseSwagger();
app.UseSwaggerUI();

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).WithTags("Health");
app.MapLinkEndpoints();

app.Run();

public partial class Program;
