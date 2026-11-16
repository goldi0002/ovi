using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;

namespace Ovi.Api.Links;

public static class LinkEndpoints
{
    public static void MapLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/links").WithTags("Links");

        api.MapPost("/", CreateLink)
            .Produces<LinkResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status409Conflict);

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

        app.MapGet("/{code}", async (string code, AppDbContext db) =>
        {
            var now = DateTime.UtcNow;
            var updated = await db.Links.Where(l => l.Code == code)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(l => l.Clicks, l => l.Clicks + 1)
                    .SetProperty(l => l.LastClickedAt, now));
            if (updated == 0) return Results.NotFound();

            var url = await db.Links.Where(l => l.Code == code).Select(l => l.Url).FirstAsync();
            return Results.Redirect(url);
        })
        .WithTags("Redirect")
        .Produces(StatusCodes.Status302Found)
        .Produces(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> CreateLink(CreateLinkRequest request, AppDbContext db, HttpRequest req)
    {
        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["url"] = ["Url must be an absolute http or https URL."]
            });
        }

        string code;
        if (!string.IsNullOrWhiteSpace(request.CustomCode))
        {
            code = request.CustomCode.Trim();
            if (!CodeGenerator.IsValidCustomCode(code))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["customCode"] = ["Code must be 3-32 characters of letters, digits, '-' or '_', and not a reserved word."]
                });
            }
            if (await db.Links.AnyAsync(l => l.Code == code))
                return Results.Conflict(new { error = $"Code '{code}' is already taken." });
        }
        else
        {
            do { code = CodeGenerator.Generate(); }
            while (await db.Links.AnyAsync(l => l.Code == code));
        }

        var link = new Link { Code = code, Url = uri.ToString() };
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

        var response = LinkResponse.From(link, BaseUrl(req));
        return Results.Created($"/api/links/{code}", response);
    }

    private static string BaseUrl(HttpRequest req) => $"{req.Scheme}://{req.Host}";
}
