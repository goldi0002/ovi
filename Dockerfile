# syntax=docker/dockerfile:1
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build -- --outDir /web/dist

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
COPY --from=web /web/dist ./wwwroot

# The database is external (Postgres, e.g. Neon): set DATABASE_URL at runtime.
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID

ENTRYPOINT ["dotnet", "Ovi.Api.dll"]
