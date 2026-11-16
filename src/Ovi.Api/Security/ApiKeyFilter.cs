using System.Security.Cryptography;
using System.Text;

namespace Ovi.Api.Security;

/// <summary>Requires the X-Api-Key header to match Auth:ApiKey. Fails closed if no key is configured.</summary>
public class ApiKeyFilter(IConfiguration config) : IEndpointFilter
{
    public const string HeaderName = "X-Api-Key";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var expected = config["Auth:ApiKey"];
        var provided = context.HttpContext.Request.Headers[HeaderName].ToString();

        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(provided) ||
            !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(provided)))
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Missing or invalid API key.");
        }

        return await next(context);
    }
}
