using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Ovi.Api.Data;

namespace Ovi.Api.Accounts;

/// <summary>Turns a Google or GitHub identity into an Ovi account and the claims kept in the session cookie.</summary>
public static class UserSignIn
{
    public const string UserIdClaim = "ovi:uid";
    public const int MaxNameLength = 100;

    /// <summary>Finds the account for this provider identity, creating it on first sign-in, and refreshes its name and email.</summary>
    public static async Task<User> UpsertAsync(
        AppDbContext db, TimeProvider time, string provider, string providerKey, string? name, string? email, bool emailVerified)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var displayName = Clean(name) ?? Clean(email?.Split('@')[0]) ?? "Ovi user";
        email = email?.Trim() is { Length: > 0 and <= 320 } e ? e : null;
        emailVerified = emailVerified && email is not null;

        for (var attempt = 0; ; attempt++)
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Provider == provider && u.ProviderKey == providerKey);
            if (user is null)
            {
                user = new User
                {
                    Provider = provider, ProviderKey = providerKey, Name = displayName, Email = email, EmailVerified = emailVerified,
                    CreatedAt = now,
                };
                db.Users.Add(user);
            }
            else
            {
                user.Name = displayName;
                user.Email = email;
                user.EmailVerified = emailVerified;
            }
            user.LastLoginAt = now;

            try
            {
                await db.SaveChangesAsync();
                return user;
            }
            catch (DbUpdateException ex) when (attempt == 0 && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                // The same person signed in twice at once and the other request created the row; load it instead.
                db.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>The session holds only the account id and display name; everything else is read from the database.</summary>
    public static ClaimsPrincipal SessionPrincipal(User user) =>
        new(new ClaimsIdentity(
            [new Claim(UserIdClaim, user.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)), new Claim(ClaimTypes.Name, user.Name)],
            CookieAuthenticationDefaults.AuthenticationScheme));

    public static int? UserId(ClaimsPrincipal principal) =>
        int.TryParse(principal.FindFirstValue(UserIdClaim), out var id) ? id : null;

    private static string? Clean(string? value)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length > MaxNameLength ? trimmed[..MaxNameLength] : trimmed;
    }
}
