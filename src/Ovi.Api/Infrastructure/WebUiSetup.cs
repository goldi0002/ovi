using Microsoft.Net.Http.Headers;

namespace Ovi.Api.Infrastructure;

/// <summary>
/// Serves the React UI (built into wwwroot from /web) at "/". Vite's hashed /assets files
/// are cached for a year; index.html is always revalidated so deploys show up immediately.
/// </summary>
public static class WebUiSetup
{
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

        app.MapGet("/", (HttpContext ctx, ShortUrlBuilder urls) =>
        {
            var headers = ctx.Response.Headers;
            headers[HeaderNames.CacheControl] = "no-cache";
            headers[HeaderNames.XContentTypeOptions] = "nosniff";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers[HeaderNames.ContentSecurityPolicy] = ContentSecurityPolicy(urls);
            return Results.Stream(index.CreateReadStream(), "text/html; charset=utf-8");
        }).ExcludeFromDescription();
    }

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
