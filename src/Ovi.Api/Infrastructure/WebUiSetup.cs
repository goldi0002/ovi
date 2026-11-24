using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Net.Http.Headers;

namespace Ovi.Api.Infrastructure;

/// <summary>
/// Serves the React UI (built into wwwroot from /web) at "/". Vite's hashed /assets files
/// are cached for a year; index.html is always revalidated so deploys show up immediately.
/// </summary>
public static class WebUiSetup
{
    /// <summary>
    /// Paths the React app handles itself; each returns index.html. A one-segment page must also be a
    /// reserved code (see CodeGenerator); pages under /links need not be, since codes never contain "/".
    /// </summary>
    /// <summary>
    /// Public pages with something to say to a search engine: each gets its own title, description and
    /// canonical link in the HTML the server sends, since a crawler may not run the UI to find them.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, PageMeta> GuidePages = new Dictionary<string, PageMeta>
    {
        ["/qr-code-generator"] = new(
            "Free QR code generator with a short link — no sign-up · Ovi",
            "Make a QR code for any URL in a second, free and without an account. It points to a short link, so it scans easily and you can see how often it was scanned."),
        ["/self-host"] = new(
            "Self-host a URL shortener with Docker · Ovi",
            "Run your own URL shortener with QR codes and click stats that don't track people. One container and a Postgres database, with Docker Compose, in about two minutes."),
    };

    /// <summary>What a search engine or a shared link should read about a page: its title and description.</summary>
    public sealed record PageMeta(string Title, string Description);

    /// <summary>Pages that search engines may index, besides the home page: the guides, the privacy policy and the terms.</summary>
    public static readonly string[] PublicPages = [.. GuidePages.Keys, "/privacy", "/terms"];

    public static readonly string[] Pages = ["/", "/links", "/links/analytics", "/links/qr-codes", "/admin", "/report", "/privacy", "/terms", .. GuidePages.Keys];

    public static void UseOviWebUi(this WebApplication app)
    {
        var index = app.Environment.WebRootFileProvider.GetFileInfo("index.html");
        if (!index.Exists)
        {
            app.Logger.LogInformation("No web UI found in wwwroot; serving the API only.");
            return;
        }

        // The build is part of the deployed image and doesn't change while the server runs, so read it once rather than
        // from disk on every page request.
        string indexHtml;
        using (var reader = new StreamReader(index.CreateReadStream())) indexHtml = reader.ReadToEnd();

        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = ctx =>
            {
                ctx.Context.Response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
                var path = ctx.Context.Request.Path;
                if (path.StartsWithSegments("/assets"))
                    ctx.Context.Response.Headers[HeaderNames.CacheControl] = "public, max-age=31536000, immutable";
                // The service worker and the manifest must always be revalidated, or an update can't reach installed copies.
                else if (path.Equals("/sw.js", StringComparison.Ordinal) || path.Equals("/manifest.webmanifest", StringComparison.Ordinal))
                    ctx.Context.Response.Headers[HeaderNames.CacheControl] = "no-cache";
            }
        });

        IResult ServeIndex(HttpContext ctx, ShortUrlBuilder urls)
        {
            var headers = ctx.Response.Headers;
            headers[HeaderNames.CacheControl] = "no-cache";
            headers[HeaderNames.XContentTypeOptions] = "nosniff";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers[HeaderNames.ContentSecurityPolicy] = ContentSecurityPolicy(urls);
            // The home page, the guides and the two legal pages belong in a search index; the others are someone's own data.
            var isHome = ctx.Request.Path.Equals("/", StringComparison.Ordinal);
            if (!isHome && !PublicPages.Contains(ctx.Request.Path.Value!)) headers["X-Robots-Tag"] = "noindex, follow";

            // The head's canonical link and og:url must be absolute, and the address differs per
            // deployment, so they are added here rather than baked into the build.
            var origin = Origin(ctx);
            var html = indexHtml;
            var extra = $"<meta property=\"og:image\" content=\"{origin}/og.png\"><meta property=\"og:image:width\" content=\"1200\">" +
                        $"<meta property=\"og:image:height\" content=\"630\"><meta property=\"og:image:alt\" content=\"{OgImageAlt}\">" +
                        $"<meta name=\"twitter:image\" content=\"{origin}/og.png\">";
            if (GuidePages.TryGetValue(ctx.Request.Path.Value!, out var meta))
            {
                html = Retitle(html, meta);
                var url = origin + ctx.Request.Path.Value;
                extra += $"<link rel=\"canonical\" href=\"{url}\"><meta property=\"og:url\" content=\"{url}\">";
            }
            else if (isHome)
            {
                extra += $"<link rel=\"canonical\" href=\"{origin}/\"><meta property=\"og:url\" content=\"{origin}/\">";
            }

            html = html.Replace("</head>", extra + "</head>", StringComparison.OrdinalIgnoreCase);

            return Results.Content(html, "text/html; charset=utf-8");
        }

        // The UI's pages. Each path here must also be a reserved code (see CodeGenerator),
        // since these literal routes win over the short-code redirect route.
        foreach (var page in Pages)
            app.MapGet(page, ServeIndex).ExcludeFromDescription();

        // robots.txt and sitemap.xml are built per request so the URLs are right on whatever
        // address this server answers on: no domain is baked into the build.
        app.MapGet("/robots.txt", (HttpContext ctx) =>
        {
            ctx.Response.Headers[HeaderNames.CacheControl] = "public, max-age=3600";
            return Results.Text($"""
                # Ovi, a URL shortener. The home page is public; the API and account pages are not.
                User-agent: *
                Allow: /
                Disallow: /api/
                Disallow: /auth/
                Disallow: /links
                Disallow: /admin
                Disallow: /report

                # Answer engines are welcome to read and cite the home page.
                User-agent: GPTBot
                User-agent: OAI-SearchBot
                User-agent: ChatGPT-User
                User-agent: PerplexityBot
                User-agent: ClaudeBot
                User-agent: Google-Extended
                Allow: /
                Disallow: /api/
                Disallow: /auth/
                Disallow: /links
                Disallow: /admin
                Disallow: /report

                Sitemap: {Origin(ctx)}/sitemap.xml
                """, "text/plain; charset=utf-8");
        }).ExcludeFromDescription();

        app.MapGet("/sitemap.xml", (HttpContext ctx) =>
        {
            ctx.Response.Headers[HeaderNames.CacheControl] = "public, max-age=3600";
            return Results.Text($"""
                <?xml version="1.0" encoding="UTF-8"?>
                <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                  <url>
                    <loc>{Origin(ctx)}/</loc>
                    <changefreq>weekly</changefreq>
                    <priority>1.0</priority>
                  </url>
                  <url>
                    <loc>{Origin(ctx)}/qr-code-generator</loc>
                  </url>
                  <url>
                    <loc>{Origin(ctx)}/self-host</loc>
                  </url>
                  <url>
                    <loc>{Origin(ctx)}/privacy</loc>
                  </url>
                  <url>
                    <loc>{Origin(ctx)}/terms</loc>
                  </url>
                </urlset>
                """, "application/xml; charset=utf-8");
        }).ExcludeFromDescription();
    }

    private const string OgImageAlt = "Ovi: short links with QR codes and click stats that don't track people";

    /// <summary>Swaps the page's title and description (and the share-card copies of them) for a guide page's own.</summary>
    private static string Retitle(string html, PageMeta meta)
    {
        var title = WebUtility.HtmlEncode(meta.Title);
        var description = WebUtility.HtmlEncode(meta.Description);
        html = Regex.Replace(html, "<title>.*?</title>", _ => $"<title>{title}</title>", RegexOptions.Singleline);
        foreach (var (attribute, name, value) in new[]
                 {
                     ("name", "description", description), ("property", "og:title", title), ("property", "og:description", description),
                     ("name", "twitter:title", title), ("name", "twitter:description", description),
                 })
            html = Regex.Replace(html, $"""<meta\s+{attribute}="{name}"\s+content="[^"]*"\s*/?>""",
                _ => $"""<meta {attribute}="{name}" content="{value}" />""");
        return html;
    }

    /// <summary>The address this request arrived on, which is the address crawlers should see.</summary>
    private static string Origin(HttpContext ctx) => $"{ctx.Request.Scheme}://{ctx.Request.Host}";

    /// <summary>
    /// Same-origin only, except QR images, which load from the public short-URL origin
    /// (it differs from the UI's origin when a custom domain is configured).
    /// </summary>
    private static string ContentSecurityPolicy(ShortUrlBuilder urls)
    {
        var imgSources = "'self' data:";
        if (urls.ConfiguredBaseUrl is { } baseUrl) imgSources += " " + baseUrl.GetLeftPart(UriPartial.Authority);
        return $"default-src 'self'; script-src 'self'; style-src 'self'; img-src {imgSources}; " +
               "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    }
}
