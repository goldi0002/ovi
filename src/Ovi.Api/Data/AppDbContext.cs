using Microsoft.EntityFrameworkCore;

namespace Ovi.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Link> Links => Set<Link>();
    public DbSet<Click> Clicks => Set<Click>();

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
        // Soft delete: every query skips deleted links unless it calls IgnoreQueryFilters().
        // The unique index on Code still covers them, so a deleted code is never handed out again.
        link.HasQueryFilter(l => l.DeletedAt == null);

        var click = modelBuilder.Entity<Click>();
        click.HasOne<Link>().WithMany().HasForeignKey(c => c.LinkId).OnDelete(DeleteBehavior.Cascade);
        // Stats read one link's clicks in a time range.
        click.HasIndex(c => new { c.LinkId, c.At });
        click.Property(c => c.Referrer).HasMaxLength(Ovi.Api.Links.ClientInfo.MaxReferrerLength);
        click.Property(c => c.Device).HasMaxLength(16);
        click.Property(c => c.Browser).HasMaxLength(32);
    }
}

internal class UtcDateTimeConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime, DateTime>(
    v => v.ToUniversalTime(),
    v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
