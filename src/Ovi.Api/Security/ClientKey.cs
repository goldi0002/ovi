using System.Net;

namespace Ovi.Api.Security;

/// <summary>
/// Groups requests by client for rate limits and click dedupe. IPv4 addresses are used as they are; IPv6 addresses
/// are cut to their /64 network, since one host or household usually gets a whole /64 and could otherwise rotate
/// through billions of addresses.
/// </summary>
public static class ClientKey
{
    public static string For(IPAddress? ip)
    {
        if (ip is null) return "unknown";
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6) return ip.ToString();

        var bytes = ip.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return new IPAddress(bytes) + "/64";
    }
}
