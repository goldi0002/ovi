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
                    Name = ApiKeyFilter.HeaderName,
                    Description = "API key for the management endpoints."
                };
                return Task.CompletedTask;
            });

            options.AddOperationTransformer((op, ctx, _) =>
            {
                if (!ctx.Description.ActionDescriptor.EndpointMetadata.OfType<RequiresApiKey>().Any())
                    return Task.CompletedTask;

                op.Security ??= [];
                op.Security.Add(new OpenApiSecurityRequirement
                {
                    [new OpenApiSecuritySchemeReference(SchemeId, ctx.Document)] = []
                });
                op.Responses ??= new OpenApiResponses();
                op.Responses.TryAdd("401", new OpenApiResponse { Description = "Missing or invalid API key" });
                return Task.CompletedTask;
            });
        });
}
