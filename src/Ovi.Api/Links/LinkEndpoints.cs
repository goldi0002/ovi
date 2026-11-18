using Npgsql;
using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;
using Ovi.Api.Infrastructure;
using Ovi.Api.Security;
using QRCoder;

namespace Ovi.Api.Links;

public static class LinkEndpoints
{
    public const int MaxUrlLength = LinkRules.MaxUrlLength;
    public const int MaxPageSize = 100;
    public const int MaxPage = 100_000;
    public const int MaxStatsDays = 365;
    public const int TopN = 8;
    public const string DirectReferrer = "Direct";

    // Codes never contain dots, so files like /favicon.svg don't match and reach the static-file middleware.
    private const string CodeRoute = "{code:regex(^[A-Za-z0-9_-]+$)}";

    public static void MapLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/links")
            .WithTags("Links")
            .WithMetadata(new AcceptsApiKey())
            .AddEndpointFilter<CallerFilter>();

        api.MapPost("/", CreateLink)
            .RequireRateLimiting(RateLimits.Create)
            .Produces<LinkResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status409Conflict)
            .Produces(StatusCodes.Status429TooManyRequests);

        api.MapGet("/", ListLinks)
            .Produces<PagedResponse<LinkResponse>>()
            .ProducesValidationProblem();

        api.MapGet("/{code}", async (string code, HttpContext http, AppDbContext db, ShortUrlBuilder urls) =>
            Caller.From(http) is not { SignedIn: true } caller ? SignInRequired()
            : await db.Links.AsNoTracking().VisibleTo(caller).FirstOrDefaultAsync(l => l.Code == code) is { } link
                ? Results.Ok(LinkResponse.From(link, urls))
                : Results.NotFound())
            .Produces<LinkResponse>()
            .Produces(StatusCodes.Status404NotFound);

        api.MapGet("/{code}/stats", LinkStats)
            .RequireRateLimiting(RateLimits.Stats)
            .Produces<LinkStatsResponse>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound);

        api.MapPatch("/{code}", UpdateLink)
            .RequireRateLimiting(RateLimits.Create)
            .Produces<LinkResponse>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status429TooManyRequests);

        // Soft delete: the row stays, marked deleted, and disappears from every other endpoint.
        api.MapDelete("/{code}", async (string code, HttpContext http, AppDbContext db, TimeProvider time) =>
            Caller.From(http) is not { SignedIn: true } caller ? SignInRequired()
            : await db.Links.VisibleTo(caller).Where(l => l.Code == code)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.DeletedAt, time.GetUtcNow().UtcDateTime)) > 0
                ? Results.NoContent()
                : Results.NotFound())
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound);

        var pub = app.MapGroup("/").WithTags("Public").RequireRateLimiting(RateLimits.Redirect);

        pub.MapGet("/" + CodeRoute, async (string code, HttpRequest request, AppDbContext db, TimeProvider time,
            IConfiguration config, ClickRecorder recorder, ILogger<Link> log) =>
        {
            var now = time.GetUtcNow().UtcDateTime;
            var link = await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code);
            if (link is null) return Results.NotFound();
            if (link.IsExpired(now)) return Expired();
            if (await UnavailableAsync(db, link, config)) return Disabled();

            var (device, browser) = ClientInfo.ParseUserAgent(request.Headers.UserAgent);
            if (recorder.ShouldRecord(ClientKey.For(request.HttpContext.Connection.RemoteIpAddress), link.Id, device))
            {
                try
                {
                    await db.Links.Where(l => l.Id == link.Id)
                        .ExecuteUpdateAsync(s => s
                            .SetProperty(l => l.Clicks, l => l.Clicks + 1)
                            .SetProperty(l => l.LastClickedAt, now));
                    db.Clicks.Add(new Click
                    {
                        LinkId = link.Id,
                        At = now,
                        Referrer = ClientInfo.ParseReferrer(request.Headers.Referer),
                        Device = device,
                        Browser = browser,
                    });
                    await db.SaveChangesAsync();
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Counting is secondary: a full or struggling database must not stop the link from working.
                    log.LogWarning(ex, "Couldn't record a click on {Code}", code);
                }
            }
            return Results.Redirect(link.Url);
        })
        .Produces(StatusCodes.Status302Found)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status410Gone)
        .Produces(StatusCodes.Status429TooManyRequests);

        pub.MapGet("/" + CodeRoute + "/qr", async (string code, AppDbContext db, ShortUrlBuilder urls, TimeProvider time, IConfiguration config) =>
        {
            var link = await db.Links.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code);
            if (link is null) return Results.NotFound();
            if (link.IsExpired(time.GetUtcNow().UtcDateTime)) return Expired();
            if (await UnavailableAsync(db, link, config)) return Disabled();

            using var data = QRCodeGenerator.GenerateQrCode(urls.For(link.Code), QRCodeGenerator.ECCLevel.M);
            var png = new PngByteQRCode(data).GetGraphic(10);
            return Results.File(png, "image/png");
        })
        .Produces(StatusCodes.Status200OK, contentType: "image/png")
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status410Gone)
        .Produces(StatusCodes.Status429TooManyRequests);
    }

    private static IResult SignInRequired() =>
        Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign in to see and manage your links.");

    /// <summary>
    /// Links stop working when their site is on the blocklist (including links made before it was blocked) or their
    /// owner is suspended, so an admin can stop abuse in one step.
    /// </summary>
    private static async Task<bool> UnavailableAsync(AppDbContext db, Link link, IConfiguration config) =>
        LinkRules.IsBlockedUrl(link.Url, config) ||
        (link.OwnerId is { } owner && await db.Users.AnyAsync(u => u.Id == owner && u.BlockedAt != null));

    private static IResult Disabled() =>
        Results.Problem(statusCode: StatusCodes.Status410Gone, title: "This link has been disabled.");

    private static IResult Expired() =>
        Results.Problem(statusCode: StatusCodes.Status410Gone, title: "This link has expired.");

    private static async Task<IResult> LinkStats(string code, HttpContext http, AppDbContext db, TimeProvider time, int days = 30)
    {
        if (Caller.From(http) is not { SignedIn: true } caller) return SignInRequired();

        if (days < 1 || days > MaxStatsDays)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["days"] = [$"days must be between 1 and {MaxStatsDays}."]
            });
        }

        var link = await db.Links.AsNoTracking().VisibleTo(caller).FirstOrDefaultAsync(l => l.Code == code);
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

    /// <param name="q">Optional search: links whose code or destination contains this, ignoring case (max 100 characters).</param>
    /// <param name="status">"all" (the default), "active" (not expired) or "expired".</param>
    private static async Task<IResult> ListLinks(HttpContext http, AppDbContext db, ShortUrlBuilder urls, TimeProvider time,
        int page = 1, int pageSize = 50, string? q = null, string? status = null)
    {
        if (Caller.From(http) is not { SignedIn: true } caller) return SignInRequired();

        var errors = new Dictionary<string, string[]>();
        if (page < 1 || page > MaxPage || pageSize < 1 || pageSize > MaxPageSize)
            errors["paging"] = [$"page must be between 1 and {MaxPage} and pageSize between 1 and {MaxPageSize}."];
        if (q?.Trim().Length > Search.MaxLength)
            errors["q"] = [$"The search can be at most {Search.MaxLength} characters."];
        var filter = status?.Trim().ToLowerInvariant() switch
        {
            null or "" or "all" => StatusFilter.All,
            "active" => StatusFilter.Active,
            "expired" => StatusFilter.Expired,
            _ => (StatusFilter?)null,
        };
        if (filter is null)
            errors["status"] = ["status must be all, active or expired."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var visible = db.Links.AsNoTracking().VisibleTo(caller);
        if (Search.ContainsPattern(q) is { } pattern)
            visible = visible.Where(l => EF.Functions.ILike(l.Code, pattern, "\\") || EF.Functions.ILike(l.Url, pattern, "\\"));
        var now = time.GetUtcNow().UtcDateTime;
        // The same rule as Link.IsExpired, written so it runs in the database.
        visible = filter switch
        {
            StatusFilter.Active => visible.Where(l => l.ExpiresAt == null || l.ExpiresAt > now),
            StatusFilter.Expired => visible.Where(l => l.ExpiresAt != null && l.ExpiresAt <= now),
            _ => visible,
        };

        var total = await visible.CountAsync();
        var links = await visible
            .OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        return Results.Ok(new PagedResponse<LinkResponse>(links.Select(l => LinkResponse.From(l, urls)).ToList(), page, pageSize, total));
    }

    private static async Task<IResult> CreateLink(
        CreateLinkRequest? request, HttpContext http, AppDbContext db, ShortUrlBuilder urls, TimeProvider time, IConfiguration config)
    {
        if (request is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["Send a JSON body with a url."] });

        var caller = Caller.From(http);
        var anonymous = caller is Caller.Anonymous;
        var now = time.GetUtcNow().UtcDateTime;
        var errors = new Dictionary<string, string[]>();

        if (LinkRules.UrlProblem(request.Url, urls, config, out var uri) is { } urlProblem)
            errors["url"] = [urlProblem];

        var code = request.CustomCode?.Trim();
        if (!string.IsNullOrEmpty(code))
        {
            if (anonymous)
                errors["customCode"] = ["Sign in to choose a custom code."];
            else if (!CodeGenerator.IsValidCustomCode(code))
                errors["customCode"] = ["Code must be 3-32 characters of letters, digits, '-' or '_', and not a reserved word."];
        }

        var expiresAt = request.ExpiresAt?.UtcDateTime;
        if (LinkRules.ExpiryProblem(expiresAt, now, anonymous) is { } expiryProblem)
            errors["expiresAt"] = [expiryProblem];
        if (anonymous) expiresAt ??= LinkRules.LatestExpiry(now, anonymous);

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

        var link = new Link
        {
            Code = code,
            // AbsoluteUri stays ASCII: punycode hosts and percent-encoded paths. ToString() decodes them, and Kestrel
            // refuses to send a non-ASCII Location header, so such links would 500 on every visit.
            Url = uri!.AbsoluteUri,
            CreatedAt = now,
            ExpiresAt = expiresAt,
            OwnerId = caller.AccountId,
            Anonymous = anonymous,
        };
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

    private enum StatusFilter { All, Active, Expired }

    /// <summary>
    /// Changes where a link goes and when it expires. The code, clicks and stats stay. Who may do it follows the same rule
    /// as delete: the owner or the admin; anyone else gets 404.
    /// </summary>
    private static async Task<IResult> UpdateLink(
        string code, UpdateLinkRequest? request, HttpContext http, AppDbContext db, ShortUrlBuilder urls, TimeProvider time,
        IConfiguration config)
    {
        if (Caller.From(http) is not { SignedIn: true } caller) return SignInRequired();
        if (request is null || (request.Url is null && request.ExpiresAt is null && !request.ClearExpiry))
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["body"] = ["Send a JSON body with a url, an expiresAt, or clearExpiry: true."]
            });

        var link = await db.Links.VisibleTo(caller).FirstOrDefaultAsync(l => l.Code == code);
        if (link is null) return Results.NotFound();

        var now = time.GetUtcNow().UtcDateTime;
        var errors = new Dictionary<string, string[]>();

        Uri? uri = null;
        if (request.Url is not null && LinkRules.UrlProblem(request.Url, urls, config, out uri) is { } urlProblem)
            errors["url"] = [urlProblem];

        var expiresAt = request.ExpiresAt?.UtcDateTime;
        if (request.ClearExpiry && expiresAt is not null)
            errors["expiresAt"] = ["Send either an expiresAt or clearExpiry, not both."];
        else if (request.ClearExpiry && link.Anonymous)
            errors["expiresAt"] = ["Links made without signing in always expire."];
        else if (LinkRules.ExpiryProblem(expiresAt, now, link.Anonymous) is { } expiryProblem)
            errors["expiresAt"] = [expiryProblem];

        if (errors.Count > 0) return Results.ValidationProblem(errors);

        if (uri is not null) link.Url = uri.AbsoluteUri;
        if (request.ClearExpiry) link.ExpiresAt = null;
        else if (expiresAt is not null) link.ExpiresAt = expiresAt;
        // Only the changed columns are written, so clicks counted meanwhile aren't lost.
        await db.SaveChangesAsync();

        return Results.Ok(LinkResponse.From(link, urls));
    }

    private static IResult Taken(string code) =>
        Results.Problem(statusCode: StatusCodes.Status409Conflict, title: $"Code '{code}' is already taken.");

    private static IResult TakenByDeleted(string code) =>
        Results.Problem(statusCode: StatusCodes.Status409Conflict,
            title: $"Code '{code}' belonged to a deleted link and can't be reused.");
}
