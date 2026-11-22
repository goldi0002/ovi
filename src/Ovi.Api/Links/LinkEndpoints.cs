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

    /// <summary>The most URLs one bulk request may shorten (25 x 2048 characters fits the 64 KB body limit).</summary>
    public const int MaxBulkUrls = 25;

    /// <summary>Rounds of picking new random codes before giving up (each round replaces only the taken ones).</summary>
    public const int MaxCodeRounds = 5;

    // Codes never contain dots, so files like /favicon.svg don't match and reach the static-file middleware.
    private const string CodeRoute = "{code:regex(^[A-Za-z0-9_-]+$)}";

    public static void MapLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/links")
            .WithTags("Links")
            .WithMetadata(new AcceptsApiKey())
            .AddEndpointFilter<CallerFilter>();

        api.MapPost("/", CreateLink)
            .RequireCreateBudget()
            .Produces<LinkResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status409Conflict)
            .Produces(StatusCodes.Status503ServiceUnavailable);

        // No per-request limit: the handler charges one permit per URL from the same budget, after validating.
        api.MapPost("/bulk", CreateLinks)
            .Produces<BulkCreateLinksResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status413PayloadTooLarge)
            .Produces(StatusCodes.Status429TooManyRequests)
            .Produces(StatusCodes.Status503ServiceUnavailable);

        api.MapGet("/", ListLinks)
            .RequireRateLimiting(RateLimits.Read)
            .Produces<PagedResponse<LinkResponse>>()
            .ProducesValidationProblem();

        api.MapGet("/{code}", async (string code, HttpContext http, AppDbContext db, ShortUrlBuilder urls) =>
            Caller.From(http) is not { SignedIn: true } caller ? SignInRequired()
            : await db.Links.AsNoTracking().VisibleTo(caller).FirstOrDefaultAsync(l => l.Code == code) is { } link
                ? Results.Ok(LinkResponse.From(link, urls))
                : Results.NotFound())
            .RequireRateLimiting(RateLimits.Read)
            .Produces<LinkResponse>()
            .Produces(StatusCodes.Status404NotFound);

        api.MapGet("/{code}/stats", LinkStats)
            .RequireRateLimiting(RateLimits.Stats)
            .Produces<LinkStatsResponse>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound);

        api.MapPatch("/{code}", UpdateLink)
            .RequireCreateBudget()
            .Produces<LinkResponse>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound);

        // Soft delete: the row stays, marked deleted, and disappears from every other endpoint. Each delete is a write,
        // so it is charged to the same per-caller budget as making and editing links.
        api.MapDelete("/{code}", async (string code, HttpContext http, AppDbContext db, TimeProvider time) =>
            Caller.From(http) is not { SignedIn: true } caller ? SignInRequired()
            : await db.Links.VisibleTo(caller).Where(l => l.Code == code)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.DeletedAt, time.GetUtcNow().UtcDateTime)) > 0
                ? Results.NoContent()
                : Results.NotFound())
            .RequireCreateBudget()
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
            return Results.Redirect(LinkRules.RedirectTarget(link.Url));
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
        CreateLinkRequest? request, HttpContext http, AppDbContext db, ShortUrlBuilder urls, TimeProvider time, IConfiguration config,
        CodeSource codeSource, IUrlThreatCheck threats)
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

        // After local validation and after the create budget (the route's filter), so this is no free lookup service.
        if ((await threats.FindUnsafeAsync([uri!.AbsoluteUri], http.RequestAborted)).Count > 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["url"] = [SafeBrowsingUrlThreatCheck.FlaggedMessage] });

        // Deleted links keep their code, so check against every row, deleted or not.
        var allLinks = db.Links.IgnoreQueryFilters();
        if (!string.IsNullOrEmpty(code))
        {
            if (await allLinks.Where(l => l.Code == code).Select(l => new { l.DeletedAt }).FirstOrDefaultAsync() is { } existing)
                return existing.DeletedAt is null ? Taken(code) : TakenByDeleted(code);
        }
        else if (await NewCodesAsync(db, 1, codeSource.Next) is [var generated])
            code = generated;
        else
            return NoCodes();

        var link = NewLink(uri!, code, now, expiresAt, caller);
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

    /// <summary>
    /// Shortens up to <see cref="MaxBulkUrls"/> URLs, all or nothing, for signed-in callers. Checks run in a fixed order:
    /// caller, body shape, every URL and the expiry (all errors reported), then the create budget (one permit per URL,
    /// none taken unless all are granted), then one transaction. See docs/decisions/0002-bulk-link-creation.md.
    /// </summary>
    private static async Task<IResult> CreateLinks(
        BulkCreateLinksRequest? request, HttpContext http, AppDbContext db, ShortUrlBuilder urls, TimeProvider time,
        IConfiguration config, CreateBudget budget, CodeSource codeSource, IUrlThreatCheck threats)
    {
        var caller = Caller.From(http);
        if (!caller.SignedIn)
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign in to shorten many links at once.");

        if (request is { Urls: not null, Items: not null })
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["items"] = ["Send either urls or items, not both."] });

        // Both shapes become one list: a URL, an optional custom code and an optional expiry per link.
        var usingItems = request?.Items is not null;
        var rows = usingItems
            ? request!.Items!.Select(it => (Url: it?.Url, Code: it?.CustomCode?.Trim(), Expiry: it?.ExpiresAt?.UtcDateTime)).ToList()
            : request?.Urls?.Select(u => (Url: u, Code: (string?)null, Expiry: (DateTime?)null)).ToList();
        var listKey = usingItems ? "items" : "urls";
        if (rows is not { Count: > 0 })
            return Results.ValidationProblem(new Dictionary<string, string[]> { [listKey] = ["Add at least one URL."] });
        // A batch can never take more permits than the budget holds, so a lower configured limit lowers the batch size.
        var max = Math.Min(MaxBulkUrls, budget.PermitLimit);
        if (rows.Count > max)
            return Results.ValidationProblem(new Dictionary<string, string[]> { [listKey] = [$"You can shorten at most {max} URLs at once."] });

        var now = time.GetUtcNow().UtcDateTime;
        var errors = new Dictionary<string, string[]>();
        var uris = new Uri[rows.Count];
        var expiries = new DateTime?[rows.Count];
        var wanted = new Dictionary<string, int>(StringComparer.Ordinal);
        var requestExpiry = request!.ExpiresAt?.UtcDateTime;
        for (var i = 0; i < rows.Count; i++)
        {
            var urlKey = usingItems ? $"items[{i}].url" : $"urls[{i}]";
            if (LinkRules.UrlProblem(rows[i].Url, urls, config, out var uri) is { } urlProblem)
                errors[urlKey] = [urlProblem];
            else
                uris[i] = uri!;

            expiries[i] = rows[i].Expiry ?? requestExpiry;
            if (LinkRules.ExpiryProblem(expiries[i], now, anonymous: false) is { } itemExpiryProblem)
                errors[rows[i].Expiry is null ? "expiresAt" : $"items[{i}].expiresAt"] = [itemExpiryProblem];

            if (string.IsNullOrEmpty(rows[i].Code)) continue;
            if (!CodeGenerator.IsValidCustomCode(rows[i].Code!))
                errors[$"items[{i}].customCode"] = ["Code must be 3-32 characters of letters, digits, '-' or '_', and not a reserved word."];
            else if (!wanted.TryAdd(rows[i].Code!, i))
                errors[$"items[{i}].customCode"] = [$"Code '{rows[i].Code}' is used twice in this batch."];
        }
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        // Chosen codes must be free, deleted links included (they keep their codes). One query, before any budget is used.
        if (wanted.Count > 0)
        {
            var codes = wanted.Keys.ToList();
            var taken = await db.Links.IgnoreQueryFilters().Where(l => codes.Contains(l.Code))
                .Select(l => new { l.Code, l.DeletedAt }).ToListAsync();
            foreach (var t in taken)
                errors[$"items[{wanted[t.Code]}].customCode"] = [t.DeletedAt is null
                    ? $"Code '{t.Code}' is already taken."
                    : $"Code '{t.Code}' belonged to a deleted link and can't be reused."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);
        }

        if (!budget.TryAcquire(http, rows.Count, out var retryAfter))
            return CreateBudget.TooMany(http, retryAfter);

        // One lookup for the whole batch, only after the budget is taken. Flagged lines are reported like any other.
        var flagged = await threats.FindUnsafeAsync(uris.Select(u => u.AbsoluteUri).ToList(), http.RequestAborted);
        if (flagged.Count > 0)
        {
            for (var i = 0; i < uris.Length; i++)
                if (flagged.Contains(uris[i].AbsoluteUri))
                    errors[usingItems ? $"items[{i}].url" : $"urls[{i}]"] = [SafeBrowsingUrlThreatCheck.FlaggedMessage];
            return Results.ValidationProblem(errors);
        }

        var random = rows.Count - wanted.Count;
        var generated = random > 0 ? await NewCodesAsync(db, random, codeSource.Next) : [];
        if (generated.Count < random) return NoCodes();
        // A random code can land on a code someone chose in this batch; the chosen one wins, so draw again.
        if (generated.Any(wanted.ContainsKey)) return NoCodes();

        var next = 0;
        var links = uris.Select((uri, i) =>
            NewLink(uri, string.IsNullOrEmpty(rows[i].Code) ? generated[next++] : rows[i].Code!, now, expiries[i], caller)).ToList();
        db.Links.AddRange(links);
        try
        {
            // One SaveChanges is one transaction: either every link is stored or none is.
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent request took one of the codes after it was checked. Nothing was stored, so a retry is safe.
            return NoCodes();
        }

        return Results.Json(new BulkCreateLinksResponse(links.Select(l => LinkResponse.From(l, urls)).ToList()),
            statusCode: StatusCodes.Status201Created);
    }

    /// <summary>
    /// Picks <paramref name="count"/> distinct random codes that no link uses, deleted links included (they keep their
    /// codes). Each round checks the whole set in one query and replaces only the taken ones. Returns fewer than
    /// <paramref name="count"/> codes if it gives up after <see cref="MaxCodeRounds"/> rounds.
    /// </summary>
    /// <param name="generate">Makes one candidate code; <see cref="CodeGenerator.Generate"/> unless a test supplies one.</param>
    public static async Task<List<string>> NewCodesAsync(AppDbContext db, int count, Func<string>? generate = null)
    {
        generate ??= () => CodeGenerator.Generate();
        var free = new List<string>(count);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var allLinks = db.Links.IgnoreQueryFilters();
        for (var round = 0; round < MaxCodeRounds && free.Count < count; round++)
        {
            var candidates = new List<string>();
            // Repeats within the batch are dropped; a bounded number of tries keeps a broken generator from spinning.
            for (var tries = 0; candidates.Count < count - free.Count && tries < 4 * count; tries++)
            {
                var c = generate();
                if (seen.Add(c)) candidates.Add(c);
            }
            if (candidates.Count == 0) continue;
            var taken = await allLinks.Where(l => candidates.Contains(l.Code)).Select(l => l.Code).ToListAsync();
            free.AddRange(candidates.Except(taken, StringComparer.Ordinal));
        }
        return free;
    }

    /// <summary>A new link row, built the same way for single and bulk create.</summary>
    private static Link NewLink(Uri uri, string code, DateTime now, DateTime? expiresAt, Caller caller) => new()
    {
        Code = code,
        // LinkRules.UrlProblem gives a punycode host, and AbsoluteUri percent-encodes the rest, so this is ASCII. Kestrel
        // refuses to send a non-ASCII Location header, so such links would 500 on every visit.
        Url = uri.AbsoluteUri,
        CreatedAt = now,
        ExpiresAt = expiresAt,
        OwnerId = caller.AccountId,
        Anonymous = caller is Caller.Anonymous,
    };

    private static IResult NoCodes() =>
        Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Couldn't make short codes; try again.");

    private enum StatusFilter { All, Active, Expired }

    /// <summary>
    /// Changes where a link goes and when it expires. The code, clicks and stats stay. Who may do it follows the same rule
    /// as delete: the owner or the admin; anyone else gets 404.
    /// </summary>
    private static async Task<IResult> UpdateLink(
        string code, UpdateLinkRequest? request, HttpContext http, AppDbContext db, ShortUrlBuilder urls, TimeProvider time,
        IConfiguration config, IUrlThreatCheck threats)
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

        // Only a changed destination is looked up, after the route's create budget has been taken.
        if (uri is not null && uri.AbsoluteUri != link.Url
            && (await threats.FindUnsafeAsync([uri.AbsoluteUri], http.RequestAborted)).Count > 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["url"] = [SafeBrowsingUrlThreatCheck.FlaggedMessage] });

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
