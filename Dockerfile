# syntax=docker/dockerfile:1
# Base images are pinned by digest as well as tag: a moved tag can't change what ships. Dependabot keeps them current.
# The web and build stages run on the build machine's own architecture ($BUILDPLATFORM), even when building
# for another: their output (static files and a portable .NET app) runs anywhere, so no emulation is needed.
# Only the runtime stage is per architecture, and it has no RUN steps.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build -- --outDir /web/dist

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0@sha256:fe0fd4e93bd2fbb47c883b7a6369e5c8d3db8bf01cdc5981f6ee35fbdf3ff4fb AS build
WORKDIR /src
COPY global.json Ovi.sln ./
COPY src/Ovi.Api/Ovi.Api.csproj src/Ovi.Api/
RUN dotnet restore src/Ovi.Api/Ovi.Api.csproj
COPY src/ src/
RUN dotnet publish src/Ovi.Api/Ovi.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:aac50ceef10391e78a899e3d2ccd00bbafa2dcb56ccf4586cbccf00edb84fc21 AS runtime
WORKDIR /app
COPY --from=build /app .
COPY --from=web /web/dist ./wwwroot

# The database is external (Postgres, e.g. Neon): set DATABASE_URL at runtime.
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID

ENTRYPOINT ["dotnet", "Ovi.Api.dll"]
