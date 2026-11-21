using Microsoft.EntityFrameworkCore;
using Ovi.Api.Data;
using Ovi.Api.Infrastructure;
using Ovi.Api.Security;

namespace Ovi.Api.Links;

/// <param name="Link">An Ovi code, or a full short URL on Ovi's own host.</param>
/// <param name="Reason">phishing, malware, spam or other.</param>
/// <param name="Details">Optional free text, up to 500 characters.</param>
public record ReportLinkRequest(string? Link, string? Reason, string? Details = null);

/// <summary>
/// Lets anyone tell the admin that a short link is abusive. Nothing about the reporter is stored.
/// </summary>
public static class ReportEndpoints
{
    public static readonly string[] Reasons = ["phishing", "malware", "spam", "other"];

    /// <summary>Open reports kept per link; later ones are accepted but dropped, so one link can't flood the table.</summary>
    public const int MaxOpenPerLink = 50;

    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/reports", Report)
            .WithTags("Reports")
            .RequireRateLimiting(RateLimits.Report)
            .Produces(StatusCodes.Status202Accepted)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status429TooManyRequests);
    }

    private static async Task<IResult> Report(
        ReportLinkRequest? request, HttpContext http, AppDbContext db, ShortUrlBuilder urls, TimeProvider time)
    {
        // The public form has no session to protect, but the same header keeps cross-site forms out.
        if (!http.Request.Headers.ContainsKey(CallerFilter.CsrfHeader))
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: $"Missing the {CallerFilter.CsrfHeader} header.");

        var errors = new Dictionary<string, string[]>();
        var code = request?.Link is { } link ? CodeFrom(link, urls) : null;
        if (code is null) errors["link"] = ["Enter an Ovi short link or its code."];

        var reason = request?.Reason?.Trim().ToLowerInvariant();
        if (reason is null || !Reasons.Contains(reason)) errors["reason"] = ["Choose a reason."];

        var details = request?.Details?.Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        if (string.IsNullOrEmpty(details)) details = null;
        if (details is not null)
        {
            if (details.Length > LinkReport.MaxDetailsLength)
                errors["details"] = ["Keep the details under 500 characters."];
            // Line breaks and tabs are fine in a note; any other control or bidi character is not.
            else if (LinkRules.HasUnsafeCharacters(details.Replace("\n", "").Replace("\t", "")))
                errors["details"] = ["The details contain characters that can't be saved."];
        }

        if (errors.Count > 0) return Results.ValidationProblem(errors);

        // Soft-deleted links are hidden by the query filter; expired and disabled ones can still be reported.
        var linkId = await db.Links.AsNoTracking().Where(l => l.Code == code).Select(l => (int?)l.Id).FirstOrDefaultAsync();
        if (linkId is null) return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "We couldn't find that Ovi link.");

        // The count and the insert run under a per-link lock, so concurrent reports can't slip past the cap.
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({(long)linkId.Value})");
        if (await db.LinkReports.CountAsync(r => r.LinkId == linkId && r.ResolvedAt == null) < MaxOpenPerLink)
        {
            db.LinkReports.Add(new LinkReport
            {
                LinkId = linkId.Value,
                Reason = reason!,
                Details = details,
                CreatedAt = time.GetUtcNow().UtcDateTime,
            });
            await db.SaveChangesAsync();
        }
        await tx.CommitAsync();
        return Results.Accepted();
    }

    /// <summary>The code in a bare code or a short URL on this server's own host; null if it is neither.</summary>
    private static string? CodeFrom(string input, ShortUrlBuilder urls)
    {
        input = input.Trim();
        if (input.Length is 0 or > 2048) return null;

        if (input.Contains('/') || input.Contains(':') || input.Contains('.'))
        {
            if (!Uri.TryCreate(input.Contains("://") ? input : "https://" + input, UriKind.Absolute, out var uri) ||
                uri.Scheme is not ("http" or "https") || !urls.IsSelf(uri))
                return null;
            input = uri.AbsolutePath.Trim('/');
        }
        return CodeGenerator.IsValidCode(input) ? input : null;
    }
}
