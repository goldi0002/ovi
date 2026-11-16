# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json Ovi.sln ./
COPY src/Ovi.Api/Ovi.Api.csproj src/Ovi.Api/
RUN dotnet restore src/Ovi.Api/Ovi.Api.csproj
COPY src/ src/
RUN dotnet publish src/Ovi.Api/Ovi.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .

# SQLite database lives on a volume; the image's built-in non-root user owns it.
RUN mkdir -p /data && chown "$APP_UID" /data
VOLUME /data
ENV ConnectionStrings__Default="Data Source=/data/ovi.db" \
    ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID

ENTRYPOINT ["dotnet", "Ovi.Api.dll"]
