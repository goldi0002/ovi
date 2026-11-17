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
    IReadOnlyList<AdminTopLink> TopLinks);

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
        admin.MapPost("/users/{id:int}/block", (int id, HttpContext http, AppDbContext db, TimeProvider time, IConfiguration config) =>
                SetBlockedAsync(id, block: true, http, db, time, config))
            .Produces(StatusCodes.Status204NoContent).ProducesValidationProblem().Produces(StatusCodes.Status404NotFound);
        admin.MapPost("/users/{id:int}/unblock", (int id, HttpContext http, AppDbContext db, TimeProvider time, IConfiguration config) =>
                SetBlockedAsync(id, block: false, http, db, time, config))
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
            top.Select(t => new AdminTopLink(t.Code, urls.For(t.Code), t.Url, t.Clicks, t.OwnerName)).ToList()));
    }

    private static async Task<IResult> ListUsers(AppDbContext db, IConfiguration config, int page = 1, int pageSize = 20, string? q = null)
    {
        if (PagingProblem(page, pageSize) is { } problem) return problem;

        var users = db.Users.AsNoTracking();
        if (SearchPattern(q) is { } pattern)
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
        if (SearchPattern(q) is { } pattern)
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

    private static async Task<IResult> SetBlockedAsync(int id, bool block, HttpContext http, AppDbContext db, TimeProvider time, IConfiguration config)
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
        return Results.NoContent();
    }

    private static IResult? PagingProblem(int page, int pageSize) =>
        page < 1 || pageSize < 1 || pageSize > LinkEndpoints.MaxPageSize
            ? Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["paging"] = [$"page must be >= 1 and pageSize between 1 and {LinkEndpoints.MaxPageSize}."]
            })
            : null;

    /// <summary>A case-insensitive "contains" pattern with LIKE's wildcards escaped, or null for no search.</summary>
    private static string? SearchPattern(string? q)
    {
        var term = q?.Trim();
        if (string.IsNullOrEmpty(term)) return null;
        if (term.Length > 100) term = term[..100];
        return "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
    }
}
