using Microsoft.OpenApi;
using Ovi.Api.Security;

namespace Ovi.Api.Infrastructure;

public static class OpenApiSetup
{
    private const string SchemeId = "ApiKey";

    public static IServiceCollection AddOviOpenApi(this IServiceCollection services) =>
        services.AddOpenApi(options =>
        {
            options.AddDocumentTransformer((doc, _, _) =>
            {
                doc.Info.Title = "Ovi URL shortener";
                doc.Components ??= new OpenApiComponents();
                doc.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
                doc.Components.SecuritySchemes[SchemeId] = new OpenApiSecurityScheme
                {
                    Type = SecuritySchemeType.ApiKey,
                    In = ParameterLocation.Header,
                    Name = CallerFilter.ApiKeyHeader,
                    Description = "Admin API key: full access to every link. Without it, the API acts as the signed-in user (session cookie) or anonymously."
                };
                return Task.CompletedTask;
            });

            options.AddOperationTransformer((op, ctx, _) =>
            {
                if (!ctx.Description.ActionDescriptor.EndpointMetadata.OfType<AcceptsApiKey>().Any())
                    return Task.CompletedTask;

                op.Security ??= [];
                op.Security.Add(new OpenApiSecurityRequirement
                {
                    [new OpenApiSecuritySchemeReference(SchemeId, ctx.Document)] = []
                });
                op.Responses ??= new OpenApiResponses();
                op.Responses.TryAdd("401", new OpenApiResponse { Description = "Invalid API key, or not signed in" });
                return Task.CompletedTask;
            });
        });
}
