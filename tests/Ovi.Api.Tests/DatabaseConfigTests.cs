using Microsoft.Extensions.Configuration;
using Npgsql;
using Ovi.Api.Data;

namespace Ovi.Api.Tests;

[TestClass]
public sealed class DatabaseConfigTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [TestMethod]
    public void Neon_url_is_converted_to_npgsql_connection_string()
    {
        var cs = new NpgsqlConnectionStringBuilder(DatabaseConfig.ToNpgsql(
            "postgresql://neondb_owner:p%40ss@ep-x-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"));

        Assert.AreEqual("ep-x-pooler.c-8.us-east-2.aws.neon.tech", cs.Host);
        Assert.AreEqual(5432, cs.Port);
        Assert.AreEqual("neondb", cs.Database);
        Assert.AreEqual("neondb_owner", cs.Username);
        Assert.AreEqual("p@ss", cs.Password);
        Assert.AreEqual(SslMode.Require, cs.SslMode);
        Assert.AreEqual(ChannelBinding.Require, cs.ChannelBinding);
    }

    [TestMethod]
    public void Key_value_connection_strings_pass_through()
    {
        const string cs = "Host=localhost;Database=ovi;Username=postgres";
        Assert.AreEqual(cs, DatabaseConfig.ToNpgsql(cs));
    }

    [TestMethod]
    public void Migrations_use_unpooled_url_and_app_uses_pooled_url()
    {
        var config = Config(new()
        {
            ["DATABASE_URL"] = "postgresql://u:p@ep-x-pooler.neon.tech/db",
            ["DATABASE_URL_UNPOOLED"] = "postgresql://u:p@ep-x.neon.tech/db"
        });

        Assert.AreEqual("ep-x-pooler.neon.tech", new NpgsqlConnectionStringBuilder(DatabaseConfig.AppConnectionString(config)).Host);
        Assert.AreEqual("ep-x.neon.tech", new NpgsqlConnectionStringBuilder(DatabaseConfig.MigrationConnectionString(config)).Host);
    }

    [TestMethod]
    public void Falls_back_to_default_connection_string()
    {
        var config = Config(new() { ["ConnectionStrings:Default"] = "Host=db;Database=ovi" });
        Assert.AreEqual("Host=db;Database=ovi", DatabaseConfig.AppConnectionString(config));
        Assert.AreEqual("Host=db;Database=ovi", DatabaseConfig.MigrationConnectionString(config));
    }

    [TestMethod]
    public void Missing_database_config_fails_clearly()
    {
        var ex = Assert.ThrowsExactly<InvalidOperationException>(() => DatabaseConfig.AppConnectionString(Config(new())));
        Assert.Contains("DATABASE_URL", ex.Message);
    }
}
