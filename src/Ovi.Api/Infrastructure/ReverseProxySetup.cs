using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace Ovi.Api.Infrastructure;

/// <summary>
/// Trusts X-Forwarded-For/Proto only from configured proxies, so rate limits see the real
/// client IP and redirects see the original scheme.
/// </summary>
public static class ReverseProxySetup
{
    public static bool ConfigureReverseProxy(this IServiceCollection services, IConfiguration config)
    {
        var proxies = config.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [];
        var networks = config.GetSection("ReverseProxy:KnownNetworks").Get<string[]>() ?? [];
        if (proxies.Length == 0 && networks.Length == 0) return false;

        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
            o.KnownProxies.Clear();
            o.KnownIPNetworks.Clear();
            o.ForwardLimit = config.GetValue("ReverseProxy:ForwardLimit", 1);
            foreach (var p in proxies) o.KnownProxies.Add(IPAddress.Parse(p));
            foreach (var n in networks) o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(n));
        });
        return true;
    }
}
