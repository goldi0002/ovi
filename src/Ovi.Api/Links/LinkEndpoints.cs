using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;
using Ovi.Api.Security;
using QRCoder;

namespace Ovi.Api.Links;

public static class LinkEndpoints
{
    public static void MapLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/links")
            .WithTags("Links")
            .AddEndpointFilter<ApiKeyFilter>()
            .WithOpenApi(op => { op.Responses.TryAdd("401", new() { Description = "Missing or invalid API key" }); return op; });

        api.MapPost("/", CreateLink)
            .RequireRateLimiting(RateLimits.Create)
            .Produces<LinkResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status409Conflict)
            .Produces(StatusCodes.Status429TooManyRequests);

        api.MapGet("/", async (AppDbContext db, HttpRequest req) =>
        {
            var links = await db.Links.AsNoTracking().OrderByDescending(l => l.CreatedAt).ToListAsync();
            return links.Select(l => LinkResponse.From(l, BaseUrl(req)));
        });

        api.MapGet("/{code}", async (string code, AppDbContext db, HttpRequest req) =>
            await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code) is { } link
                ? Results.Ok(LinkResponse.From(link, BaseUrl(req)))
                : Results.NotFound())
            .Produces<LinkResponse>()
            .Produces(StatusCodes.Status404NotFound);

        api.MapDelete("/{code}", async (string code, AppDbContext db) =>
            await db.Links.Where(l => l.Code == code).ExecuteDeleteAsync() > 0
                ? Results.NoContent()
                : Results.NotFound());

        var pub = app.MapGroup("/").RequireRateLimiting(RateLimits.Redirect);

        pub.MapGet("/{code}", async (string code, AppDbContext db, TimeProvider time) =>
        {
            var now = time.GetUtcNow().UtcDateTime;
            var link = await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code);
            if (link is null) return Results.NotFound();
            if (link.IsExpired(now)) return Results.Problem(statusCode: StatusCodes.Status410Gone, title: "This link has expired.");

            await db.Links.Where(l => l.Id == link.Id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(l => l.Clicks, l => l.Clicks + 1)
                    .SetProperty(l => l.LastClickedAt, now));
            return Results.Redirect(link.Url);
        })
        .WithTags("Public")
        .Produces(StatusCodes.Status302Found)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status410Gone);

        pub.MapGet("/{code}/qr", async (string code, AppDbContext db, HttpRequest req, TimeProvider time) =>
        {
            var link = await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code);
            if (link is null) return Results.NotFound();
            if (link.IsExpired(time.GetUtcNow().UtcDateTime)) return Results.Problem(statusCode: StatusCodes.Status410Gone, title: "This link has expired.");

            using var data = QRCodeGenerator.GenerateQrCode($"{BaseUrl(req)}/{link.Code}", QRCodeGenerator.ECCLevel.M);
            var png = new PngByteQRCode(data).GetGraphic(10);
            return Results.File(png, "image/png");
        })
        .WithTags("Public")
        .Produces(StatusCodes.Status200OK, contentType: "image/png")
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status410Gone);
    }

    private static async Task<IResult> CreateLink(CreateLinkRequest request, AppDbContext db, HttpRequest req, TimeProvider time)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var errors = new Dictionary<string, string[]>();

        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            errors["url"] = ["Url must be an absolute http or https URL."];
        }

        var code = request.CustomCode?.Trim();
        if (!string.IsNullOrEmpty(code) && !CodeGenerator.IsValidCustomCode(code))
        {
            errors["customCode"] = ["Code must be 3-32 characters of letters, digits, '-' or '_', and not a reserved word."];
        }

        DateTime? expiresAt = request.ExpiresAt?.ToUniversalTime();
        if (expiresAt is { } e && e <= now)
        {
            errors["expiresAt"] = ["ExpiresAt must be in the future."];
        }

        if (errors.Count > 0) return Results.ValidationProblem(errors);

        if (!string.IsNullOrEmpty(code))
        {
            if (await db.Links.AnyAsync(l => l.Code == code))
                return Results.Conflict(new { error = $"Code '{code}' is already taken." });
        }
        else
        {
            do { code = CodeGenerator.Generate(); }
            while (await db.Links.AnyAsync(l => l.Code == code));
        }

        var link = new Link { Code = code, Url = uri!.ToString(), CreatedAt = now, ExpiresAt = expiresAt };
        db.Links.Add(link);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Lost a race with a concurrent request that took the same code.
            return Results.Conflict(new { error = $"Code '{code}' is already taken." });
        }

        return Results.Created($"/api/links/{code}", LinkResponse.From(link, BaseUrl(req)));
    }

    private static string BaseUrl(HttpRequest req) => $"{req.Scheme}://{req.Host}";
}
