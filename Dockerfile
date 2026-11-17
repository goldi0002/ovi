# syntax=docker/dockerfile:1
# Base images are pinned by digest as well as tag: a moved tag can't change what ships. Dependabot keeps them current.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build -- --outDir /web/dist

FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:fe0fd4e93bd2fbb47c883b7a6369e5c8d3db8bf01cdc5981f6ee35fbdf3ff4fb AS build
WORKDIR /src
COPY global.json Ovi.sln ./
COPY src/Ovi.Api/Ovi.Api.csproj src/Ovi.Api/
RUN dotnet restore src/Ovi.Api/Ovi.Api.csproj
COPY src/ src/
RUN dotnet publish src/Ovi.Api/Ovi.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:11.0@sha256:bc0d6653979efba491ab3d6f589d691f96c309c3c3ef81325efa6978e7b7f242 AS runtime
WORKDIR /app
COPY --from=build /app .
COPY --from=web /web/dist ./wwwroot

# The database is external (Postgres, e.g. Neon): set DATABASE_URL at runtime.
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID

ENTRYPOINT ["dotnet", "Ovi.Api.dll"]
