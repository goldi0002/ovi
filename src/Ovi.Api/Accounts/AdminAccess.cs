namespace Ovi.Api.Accounts;

/// <summary>
/// Who counts as an admin besides the API key: signed-in users whose <b>verified</b> email is listed in
/// <c>Auth:AdminEmails</c> (comma-separated). It's worked out from the current config on every request, never stored,
/// so taking an email off the list removes admin rights at once.
/// </summary>
public static class AdminAccess
{
    public static bool IsAdmin(string? email, bool emailVerified, IConfiguration config) =>
        emailVerified && email is not null && AdminEmails(config).Contains(email, StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyList<string> AdminEmails(IConfiguration config) =>
        (config["Auth:AdminEmails"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
