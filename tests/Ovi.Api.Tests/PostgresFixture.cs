using Npgsql;
using Testcontainers.PostgreSql;

namespace Ovi.Api.Tests;

/// <summary>One Postgres container for the whole test run; each test gets its own database.</summary>
[TestClass]
public static class PostgresFixture
{
    private static PostgreSqlContainer? _container;

    [AssemblyInitialize]
    public static async Task StartAsync(TestContext _)
    {
        _container = new PostgreSqlBuilder("postgres:17-alpine").Build();
        await _container.StartAsync();
    }

    [AssemblyCleanup]
    public static async Task StopAsync()
    {
        if (_container is not null) await _container.DisposeAsync();
    }

    /// <summary>A connection string for a new, uniquely named database (created by EF migrations).</summary>
    public static string NewDatabase() =>
        new NpgsqlConnectionStringBuilder(_container!.GetConnectionString())
        {
            Database = "ovi_test_" + Guid.NewGuid().ToString("N")
        }.ConnectionString;
}
