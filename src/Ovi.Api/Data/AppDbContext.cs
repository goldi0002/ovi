using Microsoft.EntityFrameworkCore;

namespace Ovi.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Link> Links => Set<Link>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        // Store and return every DateTime as UTC (maps to Postgres timestamptz).
        builder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var link = modelBuilder.Entity<Link>();
        link.HasIndex(l => l.Code).IsUnique();
        link.Property(l => l.Code).HasMaxLength(32);
        link.Property(l => l.Url).HasMaxLength(2048);
    }
}

internal class UtcDateTimeConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime, DateTime>(
    v => v.ToUniversalTime(),
    v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
