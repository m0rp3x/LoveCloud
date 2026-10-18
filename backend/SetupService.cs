using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public static class SetupLifecycle
{
    public static async Task InitializeAsync(AppDb db, IConfiguration config)
    {
        var state = await db.Setup.SingleOrDefaultAsync();
        if (state == null) { state = new SetupState(); db.Setup.Add(state); }
        if (state.Completed) return; // A new secret must never reopen an installation.
        if (await HasExistingSetupAsync(db)) { await CloseAsync(db, state); return; }
        var path = config["Setup:TokenFile"] ?? "/run/secrets/setup_token";
        if (!File.Exists(path))
        {
            if (config["Setup:TokenFile"] != null) throw new InvalidOperationException("Configured setup token file is missing.");
            return; // Older deployments remain compatible with legacy admin bootstrap.
        }
        var token = (await File.ReadAllTextAsync(path)).Trim();
        if (!IsToken(token)) throw new InvalidOperationException("Setup token must be a random 256-bit hexadecimal secret.");
        var hash = Tokens.Hash(token);
        if (state.TokenHash != hash)
        {
            state.TokenHash = hash;
            await InvalidateClaimAsync(db, state);
        }
    }
    public static bool IsToken(string? value) => value is { Length: 64 } && value.All(Uri.IsHexDigit);
    public static async Task<bool> HasExistingSetupAsync(AppDb db) =>
        await db.Users.AnyAsync(u => u.Role == "partner" || u.Role == "admin" && !u.MustChangePassword) ||
        await db.Files.AnyAsync() || await db.Folders.AnyAsync() || await db.Posts.AnyAsync() ||
        await db.Tasks.AnyAsync() || await db.Wishes.AnyAsync() || await db.Albums.AnyAsync() || await db.Activity.AnyAsync();

    // Caller owns the common "setup" transaction lock.
    public static async Task InvalidateClaimAsync(AppDb db, SetupState state)
    {
        state.ClaimSessionId = null;
        await db.SaveChangesAsync();
        await db.Avatars.Where(x => x.PendingSessionId != null).ExecuteUpdateAsync(s => s.SetProperty(x => x.PendingSessionId, (Guid?)null));
        await db.SetupSessions.ExecuteDeleteAsync();
    }
    public static async Task CloseAsync(AppDb db, SetupState? state = null)
    {
        state ??= await db.Setup.SingleOrDefaultAsync();
        if (state == null) { state = new SetupState(); db.Setup.Add(state); }
        state.Completed = true; state.CompletedAt ??= DateTimeOffset.UtcNow; state.TokenHash = null;
        await InvalidateClaimAsync(db, state);
    }
}

public static class SetupText
{
    public static bool English(HttpContext c) => c.Request.Headers.AcceptLanguage.ToString().Split(',').FirstOrDefault()?.Trim().StartsWith("en", StringComparison.OrdinalIgnoreCase) == true;
    public static string Pick(HttpContext c, string ru, string en) => English(c) ? en : ru;
    public static void Require(HttpContext c, bool ok, string ru, string en, int status = 400)
    { if (!ok) throw new ApiException(status, Pick(c, ru, en)); }
}

public sealed class SetupAccess(HttpContext context, AppDb db)
{
    public const string CookieName = "lovecloud_setup";
    public async Task<SetupSession?> CurrentAsync()
    {
        var token = context.Request.Cookies[CookieName];
        if (!SetupLifecycle.IsToken(token)) return null;
        var hash = Tokens.Hash(token!); var now = DateTimeOffset.UtcNow;
        return await (from session in db.SetupSessions.AsNoTracking() join state in db.Setup.AsNoTracking() on session.Id equals state.ClaimSessionId
            where !state.Completed && state.TokenHash != null && session.TokenHash == hash && session.ExpiresAt > now select session).SingleOrDefaultAsync();
    }
    public async Task<SetupSession> RequireAsync()
    {
        var session = await CurrentAsync();
        return session ?? throw new ApiException(401, SetupText.Pick(context, "Сессия настройки недействительна или завершена.", "The setup session is invalid, expired, or completed."));
    }
    public async Task<SetupSession> GuardMutationAsync()
    {
        var session = await RequireAsync();
        SetupText.Require(context, Tokens.Equal(session.CsrfToken, context.Request.Headers["X-Setup-CSRF"]), "Проверка setup CSRF не пройдена.", "Setup CSRF validation failed.", 403);
        return session;
    }
}

public static class Appearance
{
    public static string Locale(string? locale) => Validation.Choice(locale, ["ru", "en"], "locale");
    public static string Theme(string? theme) => Validation.Choice(theme, ["berry", "rose", "cloud"], "theme");
    public static string Username(string? input)
    {
        var name = Validation.Text(input, "username", 64);
        Validation.Require(name.All(c => char.IsLetterOrDigit(c) || c is '_' or '-' or '.'), "Username: letters, digits, dot, dash or underscore only.");
        return name;
    }
    public static string Zone(string? zone)
    {
        var value = Validation.Text(zone, "timeZone", 80);
        try { _ = TimeZoneInfo.FindSystemTimeZoneById(value); } catch (TimeZoneNotFoundException) { throw new ApiException(400, "Unknown time zone."); } catch (InvalidTimeZoneException) { throw new ApiException(400, "Invalid time zone."); }
        return value;
    }
    public static string? AvatarUrl(Guid? id) => id.HasValue ? $"/api/v1/avatars/{id}/content" : null;
    public static object PairDto(PairSettings pair) => new { pair.Name, pair.StartDate, pair.TimeZone, pair.Locale, pair.Theme, avatarUrl = AvatarUrl(pair.AvatarId) };
}
