using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public static class AuthEndpoints
{
    public static object UserDto(UserAccount u) => new { id = u.Id, slot = u.Slot, role = u.Role, username = u.Username, displayName = u.DisplayName, mustChangePassword = u.MustChangePassword, disabled = u.Disabled, avatarUrl = Appearance.AvatarUrl(u.AvatarId) };
    public static async Task<object> MeAsync(AppDb db, UserAccount u)
    {
        var p = await db.Pair.SingleAsync();
        return new { user = UserDto(u), pair = Appearance.PairDto(p) };
    }
    public static void MapAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/api/v1/auth");
        auth.MapPost("/login", async (LoginInput input, HttpContext c, AppDb db, IConfiguration config, AttemptLimiter limiter) => {
            Validation.Require(input.Username is { Length: > 0 and <= 64 } && input.Password is { Length: > 0 and <= 256 }, "Неверное имя или пароль.", 401);
            await using var tx = await db.Database.BeginTransactionAsync();
            var normal = input.Username.Trim().ToUpperInvariant();
            var ip = c.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            await limiter.BeginAsync("login-ip:" + ip, 30);
            var attempt = await limiter.BeginAsync("login-user:" + normal);
            var u = await db.Users.FirstOrDefaultAsync(x => x.NormalizedUsername == normal);
            var hasher = new PasswordHasher<UserAccount>();
            // A dummy PBKDF2 verification also runs for unknown accounts.
            var candidate = u ?? new UserAccount { PasswordHash = DummyPassword.Hash };
            var verified = hasher.VerifyHashedPassword(candidate, candidate.PasswordHash, input.Password);
            if (u == null || u.Disabled || verified == PasswordVerificationResult.Failed)
            { await db.SaveChangesAsync(); await tx.CommitAsync(); throw new ApiException(401, "Неверное имя или пароль."); }
            attempt.Failures = 0; attempt.BlockedUntil = null;
            if (verified == PasswordVerificationResult.SuccessRehashNeeded) u.PasswordHash = hasher.HashPassword(u, input.Password);
            var token = Tokens.New();
            var session = new AuthSession { UserId = u.Id, TokenHash = Tokens.Hash(token), CsrfToken = Tokens.New(), ExpiresAt = DateTimeOffset.UtcNow.AddDays(7) };
            db.Sessions.Add(session);
            await db.SaveChangesAsync(); await tx.CommitAsync();
            new Access(c, db, config).SetCookie(SessionHandler.Cookie, token, session.ExpiresAt);
            return Results.Ok(await MeAsync(db, u));
        });
        auth.MapGet("/me", async (Access a, AppDb db) => Results.Ok(await MeAsync(db, a.User))).RequireAuthorization();
        auth.MapGet("/csrf", (Access a) => Results.Ok(new { token = a.Session.CsrfToken })).RequireAuthorization();
        auth.MapPost("/logout", async (Access a, AppDb db, Connections connections) => {
            await db.Sessions.Where(x => x.Id == a.Session.Id).ExecuteDeleteAsync();
            connections.RevokeSession(a.Session.Id);
            a.ClearCookie(SessionHandler.Cookie); a.ClearCookie("lovecloud_vault"); return Results.NoContent();
        }).RequireAuthorization();
        auth.MapPost("/change-password", async (PasswordInput input, Access a, AppDb db, AttemptLimiter limiter, Connections connections) => {
            Validation.Password(input.NewPassword);
            await using var tx = await db.Database.BeginTransactionAsync();
            if (a.User.Role == "admin") await db.LockAsync("setup");
            else await db.LockAsync("password:" + a.User.Id);
            await db.Entry(a.User).ReloadAsync();
            Validation.Require(await db.Sessions.AsNoTracking().AnyAsync(x => x.Id == a.Session.Id && x.ExpiresAt > DateTimeOffset.UtcNow), "Сессия отозвана.", 401);
            await limiter.BeginAsync("password:" + a.User.Id);
            var u = a.User;
            var h = new PasswordHasher<UserAccount>();
            if (input.CurrentPassword == null || input.CurrentPassword.Length > 256 || h.VerifyHashedPassword(u, u.PasswordHash, input.CurrentPassword) == PasswordVerificationResult.Failed)
            { await db.SaveChangesAsync(); await tx.CommitAsync(); throw new ApiException(400, "Текущий пароль неверен."); }
            Validation.Require(input.CurrentPassword != input.NewPassword, "Выберите новый пароль.");
            u.PasswordHash = h.HashPassword(u, input.NewPassword); u.MustChangePassword = false;
            if (u.Role == "admin") await SetupLifecycle.CloseAsync(db);
            await db.Sessions.Where(x => x.UserId == u.Id && x.Id != a.Session.Id).ExecuteDeleteAsync();
            await db.VaultSessions.Where(x => x.UserId == u.Id).ExecuteDeleteAsync();
            a.Session.RecoveryUntil = null; a.Session.CsrfToken = Tokens.New();
            await db.SaveChangesAsync(); await tx.CommitAsync();
            connections.RevokeUser(u.Id);
            a.ClearCookie("lovecloud_vault"); return Results.NoContent();
        }).RequireAuthorization();

        var admin = app.MapGroup("/api/v1/admin").RequireAuthorization();
        admin.MapGet("/users", async (Access a, AppDb db) => { a.Admin(); return Results.Ok((await db.Users.OrderBy(x => x.Slot).ToListAsync()).Select(UserDto)); });
        admin.MapPatch("/pair", async (PairInput input, Access a, AppDb db) => {
            a.Admin(); var p = await db.Pair.SingleAsync(); if (input.Name != null) p.Name = Validation.Text(input.Name, "название", 120);
            if (input.TimeZone != null) p.TimeZone = Appearance.Zone(input.TimeZone);
            if (input.StartDate != null) p.StartDate = Validation.Date(input.StartDate);
            if (input.Locale != null) p.Locale = Appearance.Locale(input.Locale);
            if (input.Theme != null) p.Theme = Appearance.Theme(input.Theme);
            db.Changed("settings"); await db.SaveChangesAsync(); return Results.Ok(Appearance.PairDto(p));
        });
        admin.MapPost("/partners", async (PartnerInput input, Access a, AppDb db) => {
            a.Admin(); Validation.Password(input.Password);
            var username = Validation.Text(input.Username, "имя пользователя", 64);
            Validation.Require(username.All(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-' or '.'), "Имя пользователя: буквы, цифры, точка, дефис или подчёркивание.");
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("setup"); await db.LockAsync("users");
            await db.Entry(a.User).ReloadAsync();
            Validation.Require(await db.Sessions.AsNoTracking().AnyAsync(x => x.Id == a.Session.Id && x.ExpiresAt > DateTimeOffset.UtcNow), "Сессия отозвана.", 401);
            await SetupLifecycle.CloseAsync(db);
            var slots = await db.Users.Select(x => x.Slot).ToListAsync();
            var slot = new[] { 2, 3 }.FirstOrDefault(x => !slots.Contains(x));
            Validation.Require(slot != 0, "Уже созданы два партнёра.", 409);
            var u = new UserAccount { Slot = slot, Username = username, NormalizedUsername = username.ToUpperInvariant(), DisplayName = Validation.Text(input.DisplayName, "имя", 120) };
            u.PasswordHash = new PasswordHasher<UserAccount>().HashPassword(u, input.Password); db.Users.Add(u);
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(UserDto(u));
        });
        admin.MapPatch("/users/{id:guid}", async (Guid id, UserPatch input, Access a, AppDb db, Connections connections) => {
            a.Admin(); var u = await db.Users.FindAsync(id) ?? throw new ApiException(404, "Пользователь не найден.");
            if (input.DisplayName != null) u.DisplayName = Validation.Text(input.DisplayName, "имя", 120);
            if (input.Disabled.HasValue)
            { Validation.Require(u.Role != "admin" || !input.Disabled.Value, "Нельзя отключить суперадминистратора."); u.Disabled = input.Disabled.Value; if (u.Disabled) await db.Sessions.Where(x => x.UserId == id).ExecuteDeleteAsync(); }
            await db.SaveChangesAsync(); if (u.Disabled) connections.RevokeUser(id); return Results.Ok(UserDto(u));
        });
    }
    private static class DummyPassword { public static readonly string Hash = new PasswordHasher<UserAccount>().HashPassword(new UserAccount(), Tokens.New()); }
}
public sealed record LoginInput(string Username, string Password);
public sealed record PasswordInput(string CurrentPassword, string NewPassword);
public sealed record PartnerInput(string Username, string DisplayName, string Password);
public sealed record PairInput(string? Name, string? StartDate, string? TimeZone, string? Locale, string? Theme);
public sealed record UserPatch(string? DisplayName, bool? Disabled);
