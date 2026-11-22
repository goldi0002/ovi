using Microsoft.EntityFrameworkCore;
using Ovi.Api.Accounts;
using Ovi.Api.Data;
using Ovi.Api.Infrastructure;
using Ovi.Api.Links;
using Ovi.Api.Security;

namespace Ovi.Api.Admin;

public record DailyCount(DateOnly Date, int Count);

public record AdminTopLink(string Code, string ShortUrl, string Url, int Clicks, string? OwnerName);

public record AdminOverview(
    int Users,
    int BlockedUsers,
    int Links,
    int AnonymousLinks,
    int ExpiredLinks,
    int DeletedLinks,
    long TotalClicks,
    IReadOnlyList<DailyCount> DailyClicks,
    IReadOnlyList<DailyCount> DailySignups,
    IReadOnlyList<AdminTopLink> TopLinks,
    int OpenReports);

public record AdminUser(
    int Id,
    string Name,
    string? Email,
    bool EmailVerified,
    string Provider,
    bool IsAdmin,
    DateTime? BlockedAt,
    DateTime CreatedAt,
    DateTime LastLoginAt,
    int Links,
    int Clicks);

public record ReasonCounts(int Phishing, int Malware, int Spam, int Other);

/// <summary>The open reports on one link, as the admin sees them.</summary>
/// <param name="Details">The latest (up to 5) non-empty details people wrote.</param>
public record AdminReport(
    string Code, string ShortUrl, string Url, LinkOwner? Owner, bool Anonymous, int OpenReports,
    ReasonCounts Reasons, DateTime LatestAt, IReadOnlyList<string> Details);

public record ResolveReportsRequest(string? Resolution);

public record LinkOwner(int Id, string Name, string? Email);

/// <param name="Owner">The account that made the link; null for anonymous and API-key links.</param>
public record AdminLink(LinkResponse Link, LinkOwner? Owner, bool Anonymous);

/// <summary>
/// The admin dashboard's API. Every route sits in one group guarded by <see cref="AdminEndpointExtensions.RequireAdmin"/>,
/// and a test checks no /api/admin route is missing that guard.
/// </summary>
public static class AdminEndpoints
{
    public const int OverviewDays = 14;

    public static void MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin").WithTags("Admin").WithMetadata(new AcceptsApiKey()).RequireAdmin();

        admin.MapGet("/overview", Overview).Produces<AdminOverview>();
        admin.MapGet("/users", ListUsers).Produces<PagedResponse<AdminUser>>().ProducesValidationProblem();
        admin.MapGet("/links", ListLinks).Produces<PagedResponse<AdminLink>>().ProducesValidationProblem();
        admin.MapGet("/reports", ListReports).Produces<PagedResponse<AdminReport>>().ProducesValidationProblem();
        admin.MapPost("/reports/{code}/resolve", ResolveReports)
            .Produces(StatusCodes.Status204NoContent).ProducesValidationProblem().Produces(StatusCodes.Status404NotFound);
        admin.MapPost("/users/{id:int}/block", (int id, HttpContext http, AppDbContext db, TimeProvider time, IConfiguration config, RedirectCache cache) =>
                SetBlockedAsync(id, block: true, http, db, time, config, cache))
            .Produces(StatusCodes.Status204NoContent).ProducesValidationProblem().Produces(StatusCodes.Status404NotFound);
        admin.MapPost("/users/{id:int}/unblock", (int id, HttpContext http, AppDbContext db, TimeProvider time, IConfiguration config, RedirectCache cache) =>
                SetBlockedAsync(id, block: false, http, db, time, config, cache))
            .Produces(StatusCodes.Status204NoContent).Produces(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> Overview(AppDbContext db, ShortUrlBuilder urls, TimeProvider time)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var firstDay = DateOnly.FromDateTime(now).AddDays(1 - OverviewDays);
        var from = firstDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        var clicksPerDay = await db.Clicks.Where(c => c.At >= from)
            .GroupBy(c => c.At.Date).Select(g => new { Day = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => DateOnly.FromDateTime(x.Day), x => x.Count);
        var signupsPerDay = await db.Users.Where(u => u.CreatedAt >= from)
            .GroupBy(u => u.CreatedAt.Date).Select(g => new { Day = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => DateOnly.FromDateTime(x.Day), x => x.Count);
        List<DailyCount> Days(Dictionary<DateOnly, int> counts) =>
            Enumerable.Range(0, OverviewDays).Select(i => firstDay.AddDays(i)).Select(d => new DailyCount(d, counts.GetValueOrDefault(d))).ToList();

        var top = await (from l in db.Links
                         join u in db.Users on l.OwnerId equals u.Id into owners
                         from u in owners.DefaultIfEmpty()
                         orderby l.Clicks descending, l.Id descending
                         select new { l.Code, l.Url, l.Clicks, OwnerName = u == null ? null : u.Name })
            .Take(5).ToListAsync();

        return Results.Ok(new AdminOverview(
            await db.Users.CountAsync(),
            await db.Users.CountAsync(u => u.BlockedAt != null),
            await db.Links.CountAsync(),
            await db.Links.CountAsync(l => l.Anonymous),
            await db.Links.CountAsync(l => l.ExpiresAt != null && l.ExpiresAt <= now),
            await db.Links.IgnoreQueryFilters().CountAsync(l => l.DeletedAt != null),
            await db.Links.SumAsync(l => (long)l.Clicks),
            Days(clicksPerDay),
            Days(signupsPerDay),
            top.Select(t => new AdminTopLink(t.Code, urls.For(t.Code), t.Url, t.Clicks, t.OwnerName)).ToList(),
            await OpenReports(db).CountAsync()));
    }

    private static async Task<IResult> ListUsers(AppDbContext db, IConfiguration config, int page = 1, int pageSize = 20, string? q = null)
    {
        if (PagingProblem(page, pageSize) is { } problem) return problem;

        var users = db.Users.AsNoTracking();
        if (Search.ContainsPattern(q) is { } pattern)
            users = users.Where(u => EF.Functions.ILike(u.Name, pattern, "\\") || EF.Functions.ILike(u.Email ?? "", pattern, "\\"));

        var total = await users.CountAsync();
        var rows = await users
            .OrderByDescending(u => u.CreatedAt).ThenByDescending(u => u.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(u => new
            {
                User = u,
                Links = db.Links.Count(l => l.OwnerId == u.Id),
                Clicks = db.Links.Where(l => l.OwnerId == u.Id).Sum(l => (int?)l.Clicks) ?? 0,
            })
            .ToListAsync();

        var items = rows.Select(r => new AdminUser(
            r.User.Id, r.User.Name, r.User.Email, r.User.EmailVerified, r.User.Provider,
            AdminAccess.IsAdmin(r.User.Email, r.User.EmailVerified, config),
            r.User.BlockedAt, r.User.CreatedAt, r.User.LastLoginAt, r.Links, r.Clicks)).ToList();
        return Results.Ok(new PagedResponse<AdminUser>(items, page, pageSize, total));
    }

    /// <param name="owner">"anonymous", "apikey" (made with the API key), a user id, or empty for every link.</param>
    private static async Task<IResult> ListLinks(
        AppDbContext db, ShortUrlBuilder urls, int page = 1, int pageSize = 20, string? q = null, string? owner = null)
    {
        if (PagingProblem(page, pageSize) is { } problem) return problem;

        var links = db.Links.AsNoTracking();
        switch (owner)
        {
            case null or "": break;
            case "anonymous": links = links.Where(l => l.Anonymous); break;
            case "apikey": links = links.Where(l => l.OwnerId == null && !l.Anonymous); break;
            default:
                if (!int.TryParse(owner, out var ownerId))
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["owner"] = ["owner must be 'anonymous', 'apikey' or a user id."]
                    });
                links = links.Where(l => l.OwnerId == ownerId);
                break;
        }
        if (Search.ContainsPattern(q) is { } pattern)
            links = links.Where(l => EF.Functions.ILike(l.Code, pattern, "\\") || EF.Functions.ILike(l.Url, pattern, "\\"));

        var total = await links.CountAsync();
        var rows = await (from l in links
                          join u in db.Users on l.OwnerId equals u.Id into owners
                          from u in owners.DefaultIfEmpty()
                          orderby l.CreatedAt descending, l.Id descending
                          select new { Link = l, Owner = u == null ? null : new LinkOwner(u.Id, u.Name, u.Email) })
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        var items = rows.Select(r => new AdminLink(LinkResponse.From(r.Link, urls), r.Owner, r.Link.Anonymous)).ToList();
        return Results.Ok(new PagedResponse<AdminLink>(items, page, pageSize, total));
    }

    /// <summary>Open reports on links that still exist (deleted links are hidden by the Links query filter).</summary>
    private static IQueryable<LinkReport> OpenReports(AppDbContext db) =>
        db.LinkReports.Where(r => r.ResolvedAt == null && db.Links.Any(l => l.Id == r.LinkId));

    private const int DetailsPerLink = 5;

    private static async Task<IResult> ListReports(AppDbContext db, ShortUrlBuilder urls, int page = 1, int pageSize = 20)
    {
        if (PagingProblem(page, pageSize) is { } problem) return problem;

        var groups = OpenReports(db).AsNoTracking().GroupBy(r => r.LinkId).Select(g => new
        {
            LinkId = g.Key,
            Open = g.Count(),
            Phishing = g.Count(r => r.Reason == "phishing"),
            Malware = g.Count(r => r.Reason == "malware"),
            Spam = g.Count(r => r.Reason == "spam"),
            Latest = g.Max(r => r.CreatedAt),
        });
        var total = await groups.CountAsync();
        var rows = await (from g in groups
                          join l in db.Links on g.LinkId equals l.Id
                          join u in db.Users on l.OwnerId equals u.Id into owners
                          from u in owners.DefaultIfEmpty()
                          orderby g.Open descending, g.Latest descending, l.Id descending
                          select new { g, l.Code, l.Url, l.Anonymous, Owner = u == null ? null : new LinkOwner(u.Id, u.Name, u.Email) })
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        var ids = rows.Select(r => r.g.LinkId).ToList();
        var texts = await OpenReports(db).AsNoTracking()
            .Where(r => ids.Contains(r.LinkId) && r.Details != null && r.Details != "")
            .OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id)
            .Select(r => new { r.LinkId, r.Details }).ToListAsync();
        var detailsByLink = texts.GroupBy(t => t.LinkId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Take(DetailsPerLink).Select(t => t.Details!).ToList());

        var items = rows.Select(r => new AdminReport(
            r.Code, urls.For(r.Code), r.Url, r.Owner, r.Anonymous, r.g.Open,
            new ReasonCounts(r.g.Phishing, r.g.Malware, r.g.Spam, r.g.Open - r.g.Phishing - r.g.Malware - r.g.Spam),
            r.g.Latest, detailsByLink.GetValueOrDefault(r.g.LinkId, [])))
            .ToList();
        return Results.Ok(new PagedResponse<AdminReport>(items, page, pageSize, total));
    }

    private static async Task<IResult> ResolveReports(string code, ResolveReportsRequest? request, AppDbContext db, TimeProvider time)
    {
        var resolution = request?.Resolution?.Trim().ToLowerInvariant();
        if (resolution is not ("dismissed" or "actioned"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["resolution"] = ["resolution must be 'dismissed' or 'actioned'."] });

        var linkId = await db.Links.Where(l => l.Code == code).Select(l => (int?)l.Id).FirstOrDefaultAsync();
        if (linkId is null) return Results.NotFound();

        var now = time.GetUtcNow().UtcDateTime;
        await db.LinkReports.Where(r => r.LinkId == linkId && r.ResolvedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.ResolvedAt, now).SetProperty(r => r.Resolution, resolution));
        return Results.NoContent();
    }

    private static async Task<IResult> SetBlockedAsync(int id, bool block, HttpContext http, AppDbContext db, TimeProvider time, IConfiguration config, RedirectCache cache)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return Results.NotFound();

        if (block)
        {
            if (Caller.From(http).AccountId == id)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["id"] = ["You can't suspend your own account."] });
            if (AdminAccess.IsAdmin(user.Email, user.EmailVerified, config))
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["id"] = ["Admins can't be suspended. Remove their email from Auth:AdminEmails first."]
                });
            user.BlockedAt ??= time.GetUtcNow().UtcDateTime;
        }
        else
        {
            user.BlockedAt = null;
        }

        await db.SaveChangesAsync();
        // Every link of this account changes status, so forget what the redirects have remembered.
        cache.Clear();
        return Results.NoContent();
    }

    private static IResult? PagingProblem(int page, int pageSize) =>
        page < 1 || page > LinkEndpoints.MaxPage || pageSize < 1 || pageSize > LinkEndpoints.MaxPageSize
            ? Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["paging"] = [$"page must be between 1 and {LinkEndpoints.MaxPage} and pageSize between 1 and {LinkEndpoints.MaxPageSize}."]
            })
            : null;
}
