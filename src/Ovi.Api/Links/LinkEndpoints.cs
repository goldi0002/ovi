using Npgsql;
using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;
using Ovi.Api.Infrastructure;
using Ovi.Api.Security;
using QRCoder;

namespace Ovi.Api.Links;

public static class LinkEndpoints
{
    public const int MaxUrlLength = 2048;
    public const int MaxPageSize = 100;
    public const int MaxStatsDays = 365;
    public const int TopN = 8;
    public const string DirectReferrer = "Direct";

    // Codes never contain dots, so files like /favicon.svg don't match and reach the static-file middleware.
    private const string CodeRoute = "{code:regex(^[A-Za-z0-9_-]+$)}";

    public static void MapLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/links")
            .WithTags("Links")
            .WithMetadata(new RequiresApiKey())
            .AddEndpointFilter<ApiKeyFilter>();

        api.MapPost("/", CreateLink)
            .RequireRateLimiting(RateLimits.Create)
            .Produces<LinkResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status409Conflict)
            .Produces(StatusCodes.Status429TooManyRequests);

        api.MapGet("/", ListLinks)
            .Produces<PagedResponse<LinkResponse>>()
            .ProducesValidationProblem();

        api.MapGet("/{code}", async (string code, AppDbContext db, ShortUrlBuilder urls) =>
            await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code) is { } link
                ? Results.Ok(LinkResponse.From(link, urls))
                : Results.NotFound())
            .Produces<LinkResponse>()
            .Produces(StatusCodes.Status404NotFound);

        api.MapGet("/{code}/stats", LinkStats)
            .Produces<LinkStatsResponse>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound);

        // Soft delete: the row stays, marked deleted, and disappears from every other endpoint.
        api.MapDelete("/{code}", async (string code, AppDbContext db, TimeProvider time) =>
            await db.Links.Where(l => l.Code == code)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.DeletedAt, time.GetUtcNow().UtcDateTime)) > 0
                ? Results.NoContent()
                : Results.NotFound())
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound);

        var pub = app.MapGroup("/").WithTags("Public").RequireRateLimiting(RateLimits.Redirect);

        pub.MapGet("/" + CodeRoute, async (string code, HttpRequest request, AppDbContext db, TimeProvider time) =>
        {
            var now = time.GetUtcNow().UtcDateTime;
            var link = await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code);
            if (link is null) return Results.NotFound();
            if (link.IsExpired(now)) return Expired();

            await db.Links.Where(l => l.Id == link.Id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(l => l.Clicks, l => l.Clicks + 1)
                    .SetProperty(l => l.LastClickedAt, now));

            var (device, browser) = ClientInfo.ParseUserAgent(request.Headers.UserAgent);
            db.Clicks.Add(new Click
            {
                LinkId = link.Id,
                At = now,
                Referrer = ClientInfo.ParseReferrer(request.Headers.Referer),
                Device = device,
                Browser = browser,
            });
            await db.SaveChangesAsync();
            return Results.Redirect(link.Url);
        })
        .Produces(StatusCodes.Status302Found)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status410Gone)
        .Produces(StatusCodes.Status429TooManyRequests);

        pub.MapGet("/" + CodeRoute + "/qr", async (string code, AppDbContext db, ShortUrlBuilder urls, TimeProvider time) =>
        {
            var link = await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code);
            if (link is null) return Results.NotFound();
            if (link.IsExpired(time.GetUtcNow().UtcDateTime)) return Expired();

            using var data = QRCodeGenerator.GenerateQrCode(urls.For(link.Code), QRCodeGenerator.ECCLevel.M);
            var png = new PngByteQRCode(data).GetGraphic(10);
            return Results.File(png, "image/png");
        })
        .Produces(StatusCodes.Status200OK, contentType: "image/png")
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status410Gone)
        .Produces(StatusCodes.Status429TooManyRequests);
    }

    private static IResult Expired() =>
        Results.Problem(statusCode: StatusCodes.Status410Gone, title: "This link has expired.");

    private static async Task<IResult> LinkStats(string code, AppDbContext db, TimeProvider time, int days = 30)
    {
        if (days < 1 || days > MaxStatsDays)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["days"] = [$"days must be between 1 and {MaxStatsDays}."]
            });
        }

        var link = await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code);
        if (link is null) return Results.NotFound();

        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        var firstDay = today.AddDays(1 - days);
        var from = firstDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var clicks = db.Clicks.Where(c => c.LinkId == link.Id && c.At >= from);

        var perDay = await clicks
            .GroupBy(c => c.At.Date)
            .Select(g => new { Day = g.Key, Clicks = g.Count() })
            .ToDictionaryAsync(x => DateOnly.FromDateTime(x.Day), x => x.Clicks);
        var daily = Enumerable.Range(0, days)
            .Select(i => firstDay.AddDays(i))
            .Select(d => new DailyClicks(d, perDay.GetValueOrDefault(d)))
            .ToList();

        var referrers = await CountByAsync(clicks.Select(c => c.Referrer), TopN);
        var devices = await CountByAsync(clicks.Select(c => c.Device), take: null);
        var browsers = await CountByAsync(clicks.Where(c => c.Browser != null).Select(c => c.Browser), TopN);

        return Results.Ok(new LinkStatsResponse(
            link.Code,
            link.Clicks,
            days,
            daily.Sum(d => d.Clicks),
            daily,
            referrers.Select(r => r with { Name = r.Name ?? DirectReferrer }).ToList(),
            devices,
            browsers));
    }

    /// <summary>Counts each distinct value, most common first (ties alphabetical, null last), optionally keeping only the top few.</summary>
    private static async Task<List<NamedCount>> CountByAsync(IQueryable<string?> values, int? take)
    {
        var grouped = values
            .GroupBy(v => v)
            .Select(g => new { Name = g.Key, Clicks = g.Count() })
            .OrderByDescending(x => x.Clicks).ThenBy(x => x.Name);
        var rows = await (take is { } n ? grouped.Take(n) : grouped).ToListAsync();
        return rows.Select(r => new NamedCount(r.Name!, r.Clicks)).ToList();
    }

    private static async Task<IResult> ListLinks(AppDbContext db, ShortUrlBuilder urls, int page = 1, int pageSize = 50)
    {
        if (page < 1 || pageSize < 1 || pageSize > MaxPageSize)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["paging"] = [$"page must be >= 1 and pageSize between 1 and {MaxPageSize}."]
            });
        }

        var total = await db.Links.CountAsync();
        var links = await db.Links.AsNoTracking()
            .OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        return Results.Ok(new PagedResponse<LinkResponse>(links.Select(l => LinkResponse.From(l, urls)).ToList(), page, pageSize, total));
    }

    private static async Task<IResult> CreateLink(CreateLinkRequest request, AppDbContext db, ShortUrlBuilder urls, TimeProvider time)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var errors = new Dictionary<string, string[]>();

        Uri? uri = null;
        if (string.IsNullOrWhiteSpace(request.Url) || request.Url.Length > MaxUrlLength ||
            !Uri.TryCreate(request.Url, UriKind.Absolute, out uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            errors["url"] = [$"Url must be an absolute http or https URL of at most {MaxUrlLength} characters."];
        }
        else if (urls.IsSelf(uri))
        {
            errors["url"] = ["Url can't point at this shortener."];
        }

        var code = request.CustomCode?.Trim();
        if (!string.IsNullOrEmpty(code) && !CodeGenerator.IsValidCustomCode(code))
        {
            errors["customCode"] = ["Code must be 3-32 characters of letters, digits, '-' or '_', and not a reserved word."];
        }

        var expiresAt = request.ExpiresAt?.UtcDateTime;
        if (expiresAt is { } e && e <= now)
        {
            errors["expiresAt"] = ["ExpiresAt must be in the future."];
        }

        if (errors.Count > 0) return Results.ValidationProblem(errors);

        // Deleted links keep their code, so check against every row, deleted or not.
        var allLinks = db.Links.IgnoreQueryFilters();
        if (!string.IsNullOrEmpty(code))
        {
            if (await allLinks.Where(l => l.Code == code).Select(l => new { l.DeletedAt }).FirstOrDefaultAsync() is { } existing)
                return existing.DeletedAt is null ? Taken(code) : TakenByDeleted(code);
        }
        else
        {
            do { code = CodeGenerator.Generate(); }
            while (await allLinks.AnyAsync(l => l.Code == code));
        }

        var link = new Link { Code = code, Url = uri!.ToString(), CreatedAt = now, ExpiresAt = expiresAt };
        db.Links.Add(link);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Lost a race with a concurrent request that took the same code.
            return Taken(code);
        }

        return Results.Created($"/api/links/{code}", LinkResponse.From(link, urls));
    }

    private static IResult Taken(string code) =>
        Results.Problem(statusCode: StatusCodes.Status409Conflict, title: $"Code '{code}' is already taken.");

    private static IResult TakenByDeleted(string code) =>
        Results.Problem(statusCode: StatusCodes.Status409Conflict,
            title: $"Code '{code}' belonged to a deleted link and can't be reused.");
}
