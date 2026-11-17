using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Ovi.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<User> Users => Set<User>();

    /// <summary>Keys that encrypt sign-in cookies, kept in the database so restarts and deploys don't sign everyone out.</summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

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
        link.HasOne<User>().WithMany().HasForeignKey(l => l.OwnerId).OnDelete(DeleteBehavior.SetNull);
        // The Links page lists one owner's links, newest first.
        link.HasIndex(l => new { l.OwnerId, l.CreatedAt });

        var user = modelBuilder.Entity<User>();
        user.HasIndex(u => new { u.Provider, u.ProviderKey }).IsUnique();
        user.Property(u => u.Provider).HasMaxLength(16);
        user.Property(u => u.ProviderKey).HasMaxLength(64);
        user.Property(u => u.Name).HasMaxLength(Ovi.Api.Accounts.UserSignIn.MaxNameLength);
        user.Property(u => u.Email).HasMaxLength(320);

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
