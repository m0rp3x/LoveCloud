using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public static class SetupEndpoints
{
    public static void MapSetup(this WebApplication app)
    {
        var routes = app.MapGroup("/api/v1/setup");
        routes.MapGet("/status", async (AppDb db) => {
            var pair = await db.Pair.AsNoTracking().SingleAsync(); var state = await db.Setup.AsNoTracking().SingleAsync();
            return Results.Ok(new { required = !state.Completed && state.TokenHash != null, pair.Locale, pair.Theme });
        });
        routes.MapPost("/exchange", async (ExchangeInput input, HttpContext c, AppDb db, SetupAccess setup, Access access, AttemptLimiter limiter) => {
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("setup");
            var state = await db.Setup.SingleAsync();
            SetupText.Require(c, !state.Completed && state.TokenHash != null, "Настройка уже завершена или недоступна.", "Setup is completed or unavailable.", 409);
            await limiter.BeginAsync("setup-ip:" + (c.Connection.RemoteIpAddress?.ToString() ?? "unknown"), 10);
            await limiter.BeginAsync("setup-exchange", 30);
            if (!SetupLifecycle.IsToken(input.Token) || !Tokens.Equal(state.TokenHash, Tokens.Hash(input.Token)))
            {
                await db.SaveChangesAsync(); await tx.CommitAsync();
                throw new ApiException(401, SetupText.Pick(c, "Неверный одноразовый секрет.", "Invalid one-time setup secret."));
            }
            if (state.ClaimSessionId.HasValue)
            {
                var current = await setup.CurrentAsync();
                await db.SaveChangesAsync(); await tx.CommitAsync();
                SetupText.Require(c, current != null, "Ссылка уже использована. Продолжите в исходном браузере или сбросьте секрет через init.", "This link has already been claimed. Continue in the original browser or reset the secret using init.", 409);
                return Results.Ok(new { csrfToken = current!.CsrfToken });
            }
            var token = Tokens.New();
            var session = new SetupSession { TokenHash = Tokens.Hash(token), CsrfToken = Tokens.New(), ExpiresAt = DateTimeOffset.UtcNow.AddHours(24) };
            db.SetupSessions.Add(session); state.ClaimSessionId = session.Id;
            await db.SaveChangesAsync(); await tx.CommitAsync();
            access.SetCookie(SetupAccess.CookieName, token, session.ExpiresAt);
            return Results.Ok(new { csrfToken = session.CsrfToken });
        });
        routes.MapGet("/session", async (SetupAccess setup, AppDb db) => {
            var session = await setup.RequireAsync();
            var pending = await db.Avatars.AsNoTracking().Where(x => !x.Ready && x.PendingSessionId == session.Id).OrderBy(x => x.CreatedAt).Select(x => x.Id).ToListAsync();
            return Results.Ok(new { csrfToken = session.CsrfToken, pendingAvatars = pending.Select(id => new { id, url = Appearance.AvatarUrl(id) }).ToArray() });
        });
        routes.MapPost("/avatar", async (HttpContext c, SetupAccess setup, AppDb db, AvatarService avatars) => {
            var session = await setup.GuardMutationAsync();
            var bytes = await avatars.ReadUploadAsync(c);
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("setup"); await db.LockAsync("avatars");
            session = await setup.GuardMutationAsync();
            SetupText.Require(c, await db.Avatars.CountAsync(x => x.PendingSessionId == session.Id) < 3, "Можно загрузить не более трёх аватаров. Сначала удалите заменяемый.", "Only three pending avatars are allowed. Delete the avatar you are replacing first.", 409);
            var avatar = await avatars.CreateAsync(bytes, session.Id, c.RequestAborted);
            await db.SaveChangesAsync(); await tx.CommitAsync();
            return Results.Ok(new { avatar.Id, url = Appearance.AvatarUrl(avatar.Id) });
        }).DisableAntiforgery().WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(AvatarService.MaxUploadBytes + 65536));
        routes.MapDelete("/avatar/{id:guid}", async (Guid id, HttpContext c, SetupAccess setup, AppDb db) => {
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("setup"); await db.LockAsync("avatars");
            var session = await setup.GuardMutationAsync();
            var avatar = await db.Avatars.SingleOrDefaultAsync(x => x.Id == id && !x.Ready && x.PendingSessionId == session.Id);
            SetupText.Require(c, avatar != null, "Аватар не найден.", "Avatar not found.", 404);
            // Unlink immediately; the blob cleanup runs outside the request transaction.
            avatar!.PendingSessionId = null;
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapPost("/complete", CompleteAsync);
    }

    private static async Task<IResult> CompleteAsync(SetupCompleteInput input, HttpContext c, SetupAccess setup, Access access, AppDb db, Connections connections)
    {
        await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("setup"); await db.LockAsync("users"); await db.LockAsync("avatars");
        var session = await setup.GuardMutationAsync();
        var state = await db.Setup.SingleAsync();
        SetupText.Require(c, !state.Completed, "Настройка уже завершена.", "Setup is already completed.", 409);
        SetupText.Require(c, input.Partners is { Length: 2 } && input.Pair != null, "Нужны название пары и два аккаунта.", "Pair settings and exactly two partners are required.");
        var users = await db.Users.OrderBy(x => x.Slot).ToListAsync();
        SetupText.Require(c, users.Count == 1 && users[0].Slot == 1, "Установка уже настроена.", "This installation is already configured.", 409);
        var admin = users[0]; await db.Entry(admin).ReloadAsync();
        SetupText.Require(c, admin.MustChangePassword && !await SetupLifecycle.HasExistingSetupAsync(db), "Установка уже настроена.", "This installation is already configured.", 409);
        Validation.Password(input.AdminPassword);
        var hasher = new PasswordHasher<UserAccount>();
        SetupText.Require(c, hasher.VerifyHashedPassword(admin, admin.PasswordHash, input.AdminPassword) == PasswordVerificationResult.Failed, "Выберите новый пароль администратора.", "Choose a new administrator password.");
        var pair = await db.Pair.SingleAsync();
        pair.Locale = Appearance.Locale(input.Locale); pair.Theme = Appearance.Theme(input.Theme);
        pair.Name = Validation.Text(input.Pair!.Name, "pair name", 120); pair.StartDate = Validation.Date(input.Pair.StartDate); pair.TimeZone = Appearance.Zone(input.Pair.TimeZone);
        var partners = new List<UserAccount>(); var names = new HashSet<string>(StringComparer.Ordinal) { admin.NormalizedUsername };
        for (var i = 0; i < 2; i++)
        {
            var entry = input.Partners![i];
            SetupText.Require(c, entry != null, "Нужны два аккаунта.", "Exactly two partners are required.");
            Validation.Password(entry!.Password);
            var username = Appearance.Username(entry.Username); var normalized = username.ToUpperInvariant();
            SetupText.Require(c, names.Add(normalized), "Имена пользователей должны отличаться, admin зарезервирован.", "Usernames must be different; admin is reserved.");
            var partner = new UserAccount { Slot = i + 2, Username = username, NormalizedUsername = normalized, DisplayName = Validation.Text(entry.DisplayName, "display name", 120), MustChangePassword = i == 1 };
            partner.PasswordHash = hasher.HashPassword(partner, entry.Password); partners.Add(partner);
        }
        var avatarIds = input.Partners!.Select(x => x.AvatarId).Append(input.Pair.AvatarId).Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToArray();
        var pending = await db.Avatars.Where(x => avatarIds.Contains(x.Id) && !x.Ready && x.PendingSessionId == session.Id).ToListAsync();
        SetupText.Require(c, pending.Count == avatarIds.Length, "Некоторые аватары не принадлежат этой сессии.", "Some avatars do not belong to this setup session.", 404);
        foreach (var avatar in pending) { avatar.PendingSessionId = null; avatar.Ready = true; }
        pair.AvatarId = input.Pair.AvatarId; partners[0].AvatarId = input.Partners![0].AvatarId; partners[1].AvatarId = input.Partners[1].AvatarId;
        admin.PasswordHash = hasher.HashPassword(admin, input.AdminPassword); admin.MustChangePassword = false;
        db.Users.AddRange(partners);
        await db.Sessions.ExecuteDeleteAsync();
        var token = Tokens.New(); var ordinary = new AuthSession { UserId = partners[0].Id, TokenHash = Tokens.Hash(token), CsrfToken = Tokens.New(), ExpiresAt = DateTimeOffset.UtcNow.AddDays(7) }; db.Sessions.Add(ordinary);
        // CloseAsync persists all related data atomically before removing setup claims.
        await SetupLifecycle.CloseAsync(db, state);
        await tx.CommitAsync();
        connections.RevokeUser(admin.Id);
        access.ClearCookie(SetupAccess.CookieName); access.ClearCookie("lovecloud_vault"); access.SetCookie(SessionHandler.Cookie, token, ordinary.ExpiresAt);
        return Results.Ok(await AuthEndpoints.MeAsync(db, partners[0]));
    }
}
public sealed record ExchangeInput(string Token);
public sealed record SetupPairInput(string Name, string? StartDate, string TimeZone, Guid? AvatarId);
public sealed record SetupPartnerInput(string Username, string DisplayName, string Password, Guid? AvatarId);
public sealed record SetupCompleteInput(string Locale, string Theme, SetupPairInput? Pair, string AdminPassword, SetupPartnerInput[]? Partners);
