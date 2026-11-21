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
    public static readonly string[] Pages = ["/", "/links", "/links/analytics", "/links/qr-codes", "/admin"];

    public static void UseOviWebUi(this WebApplication app)
    {
        var index = app.Environment.WebRootFileProvider.GetFileInfo("index.html");
        if (!index.Exists)
        {
            app.Logger.LogInformation("No web UI found in wwwroot; serving the API only.");
            return;
        }

        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = ctx =>
            {
                ctx.Context.Response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
                if (ctx.Context.Request.Path.StartsWithSegments("/assets"))
                    ctx.Context.Response.Headers[HeaderNames.CacheControl] = "public, max-age=31536000, immutable";
            }
        });

        IResult ServeIndex(HttpContext ctx, ShortUrlBuilder urls)
        {
            var headers = ctx.Response.Headers;
            headers[HeaderNames.CacheControl] = "no-cache";
            headers[HeaderNames.XContentTypeOptions] = "nosniff";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers[HeaderNames.ContentSecurityPolicy] = ContentSecurityPolicy(urls);
            // Only the home page belongs in a search index; the others are someone's own data.
            var isHome = ctx.Request.Path.Equals("/", StringComparison.Ordinal);
            if (!isHome) headers["X-Robots-Tag"] = "noindex, follow";

            // The head's canonical link and og:url must be absolute, and the address differs per
            // deployment, so they are added here rather than baked into the build.
            using var reader = new StreamReader(index.CreateReadStream());
            var html = reader.ReadToEnd();
            if (isHome)
            {
                var origin = Origin(ctx);
                html = html.Replace("</head>",
                    $"<link rel=\"canonical\" href=\"{origin}/\"><meta property=\"og:url\" content=\"{origin}/\"></head>",
                    StringComparison.OrdinalIgnoreCase);
            }

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
                </urlset>
                """, "application/xml; charset=utf-8");
        }).ExcludeFromDescription();
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
