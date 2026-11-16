using System.Security.Cryptography;
using System.Text;

namespace Ovi.Api.Security;

/// <summary>Endpoint metadata marking routes that need an API key (used for OpenAPI docs).</summary>
public sealed class RequiresApiKey;

/// <summary>Requires the X-Api-Key header to match Auth:ApiKey. Fails closed if no key is configured.</summary>
public class ApiKeyFilter(IConfiguration config) : IEndpointFilter
{
    public const string HeaderName = "X-Api-Key";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var expected = config["Auth:ApiKey"];
        var provided = context.HttpContext.Request.Headers[HeaderName].ToString();

        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(provided) || !KeysMatch(expected, provided))
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Missing or invalid API key.");
        }

        return await next(context);
    }

    // Hash first so the comparison is constant-time regardless of key length.
    private static bool KeysMatch(string expected, string provided) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
            SHA256.HashData(Encoding.UTF8.GetBytes(provided)));
}
