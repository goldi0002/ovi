using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace Ovi.Api.Infrastructure;

/// <summary>
/// Trusts forwarded client IP/scheme headers only when configured, so rate limits see the real
/// client IP and redirects see the original scheme.
/// </summary>
/// <remarks>
/// Either list the proxies (<c>ReverseProxy:KnownProxies</c> / <c>KnownNetworks</c>), or, on a platform
/// where the app is reachable only through the platform's proxy (e.g. Fly.io), set
/// <c>ReverseProxy:TrustAllProxies</c>. <c>ReverseProxy:ClientIpHeader</c> names the header carrying the
/// client IP (default <c>X-Forwarded-For</c>; <c>Fly-Client-IP</c> on Fly.io).
/// </remarks>
public static class ReverseProxySetup
{
    public static bool ConfigureReverseProxy(this IServiceCollection services, IConfiguration config)
    {
        var proxies = config.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [];
        var networks = config.GetSection("ReverseProxy:KnownNetworks").Get<string[]>() ?? [];
        var trustAll = config.GetValue("ReverseProxy:TrustAllProxies", false);
        if (!trustAll && proxies.Length == 0 && networks.Length == 0) return false;

        var clientIpHeader = config["ReverseProxy:ClientIpHeader"];

        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
            o.ForwardLimit = config.GetValue("ReverseProxy:ForwardLimit", 1);
            if (!string.IsNullOrEmpty(clientIpHeader)) o.ForwardedForHeaderName = clientIpHeader;

            // Empty lists mean "trust any sender"; only reached when TrustAllProxies is set.
            o.KnownProxies.Clear();
            o.KnownIPNetworks.Clear();
            foreach (var p in proxies) o.KnownProxies.Add(IPAddress.Parse(p));
            foreach (var n in networks) o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(n));
        });
        return true;
    }
}
