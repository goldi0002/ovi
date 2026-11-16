using Npgsql;

namespace Ovi.Api.Data;

/// <summary>
/// Resolves Postgres connection strings from configuration.
/// </summary>
/// <remarks>
/// <para><c>DATABASE_URL</c> (Neon's pooled, <c>-pooler</c> endpoint) serves app traffic.
/// <c>DATABASE_URL_UNPOOLED</c> (direct endpoint) runs migrations, as Neon recommends.
/// <c>ConnectionStrings:Default</c> is the fallback for both, e.g. a local Postgres in Development.</para>
/// <para>Values may be URLs (<c>postgresql://user:pass@host/db?sslmode=require</c>) or Npgsql
/// key/value strings.</para>
/// </remarks>
public static class DatabaseConfig
{
    public static string AppConnectionString(IConfiguration config) =>
        Resolve(config["DATABASE_URL"], config.GetConnectionString("Default"))
        ?? throw new InvalidOperationException(
            "No database configured. Set DATABASE_URL (e.g. from Neon) or ConnectionStrings:Default.");

    public static string MigrationConnectionString(IConfiguration config) =>
        Resolve(config["DATABASE_URL_UNPOOLED"], null) ?? AppConnectionString(config);

    private static string? Resolve(string? primary, string? fallback)
    {
        var value = !string.IsNullOrWhiteSpace(primary) ? primary : fallback;
        return string.IsNullOrWhiteSpace(value) ? null : ToNpgsql(value);
    }

    /// <summary>Converts a postgres:// or postgresql:// URL to an Npgsql connection string; passes others through.</summary>
    public static string ToNpgsql(string value)
    {
        if (!value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return value;
        }

        var uri = new Uri(value);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port <= 0 ? 5432 : uri.Port,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
        };

        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = pair.Split('=', 2);
            var key = Uri.UnescapeDataString(kv[0]).ToLowerInvariant();
            var val = kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : "";
            switch (key)
            {
                case "sslmode":
                    builder.SslMode = Enum.Parse<SslMode>(val.Replace("-", ""), ignoreCase: true);
                    break;
                case "channel_binding":
                    builder.ChannelBinding = Enum.Parse<ChannelBinding>(val, ignoreCase: true);
                    break;
                // Other libpq-style parameters (e.g. options) aren't needed for Neon; ignore them.
            }
        }

        return builder.ConnectionString;
    }
}
