using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public static class Totp
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    public static string CreateSecret() => Encode(RandomNumberGenerator.GetBytes(20));
    public static string Encode(byte[] bytes)
    {
        var result = new System.Text.StringBuilder(); var buffer = 0; var bits = 0;
        foreach (var b in bytes) { buffer = (buffer << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; result.Append(Alphabet[(buffer >> bits) & 31]); } }
        if (bits > 0) result.Append(Alphabet[(buffer << (5 - bits)) & 31]); return result.ToString();
    }
    public static byte[] Decode(string text)
    {
        var result = new List<byte>(); var buffer = 0; var bits = 0;
        foreach (var ch in text.TrimEnd('=').ToUpperInvariant()) { var value = Alphabet.IndexOf(ch); if (value < 0) throw new FormatException("Invalid base32 secret."); buffer = (buffer << 5) | value; bits += 5; if (bits >= 8) { bits -= 8; result.Add((byte)(buffer >> bits)); } }
        return result.ToArray();
    }
    public static string Generate(string secret, long step, int digits = 6)
    {
        Span<byte> counter = stackalloc byte[8]; BinaryPrimitives.WriteInt64BigEndian(counter, step);
        var key = Decode(secret); var digest = HMACSHA1.HashData(key, counter); CryptographicOperations.ZeroMemory(key);
        var offset = digest[^1] & 15; var number = BinaryPrimitives.ReadUInt32BigEndian(digest.AsSpan(offset, 4)) & 0x7fffffff;
        var mod = digits == 8 ? 100000000u : 1000000u; return (number % mod).ToString(new string('0', digits), CultureInfo.InvariantCulture);
    }
    public static long? Match(string secret, string? code, DateTimeOffset now)
    {
        if (code is not { Length: 6 } || !code.All(c => c is >= '0' and <= '9')) return null;
        var current = now.ToUnixTimeSeconds() / 30; long? matched = null;
        for (var offset = -1; offset <= 1; offset++) if (Tokens.Equal(Generate(secret, current + offset), code)) matched = current + offset;
        return matched;
    }
}

public sealed class VaultService(AppDb db, IDataProtectionProvider dataProtection, AttemptLimiter limiter)
{
    private readonly IDataProtector protector = dataProtection.CreateProtector("LoveCloud.Vault.Totp.v1");
    public string Protect(string secret) => protector.Protect(secret);
    public string Unprotect(string secret)
    {
        try { return protector.Unprotect(secret); } catch (CryptographicException) { throw new ApiException(503, "Ключ приватного хранилища недоступен. Требуется восстановить постоянные DataProtection keys."); }
    }
    public async Task<UserAccount> LockUserAsync(Access a, HttpContext c)
    {
        await db.LockAsync("vault:" + a.User.Id);
        await db.Entry(a.User).ReloadAsync();
        await limiter.BeginAsync("vault-ip:" + (c.Connection.RemoteIpAddress?.ToString() ?? "unknown"), 30);
        await limiter.BeginAsync("vault-user:" + a.User.Id);
        return a.User;
    }
    public async Task FailedAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, string message)
    { await db.SaveChangesAsync(); await tx.CommitAsync(); throw new ApiException(400, message); }
    public async Task SuccessAsync()
    {
        // Keep IP counts to bound even successful calls; reset per-user failure count.
        var userKey = db.ChangeTracker.Entries<AuthThrottle>().FirstOrDefault(x => x.Entity.Key.StartsWith("vault-user:"))?.Entity;
        if (userKey != null) { userKey.Failures = 0; userKey.BlockedUntil = null; }
        await db.SaveChangesAsync();
    }
    public static bool CheckPassword(UserAccount user, string? password) => password is { Length: > 0 and <= 256 } && new PasswordHasher<UserAccount>().VerifyHashedPassword(user, user.PasswordHash, password) != PasswordVerificationResult.Failed;
    public static string NormalizeRecovery(string value) => value.Replace("-", "").Replace(" ", "").ToUpperInvariant();
}

public static class VaultEndpoints
{
    public static void MapVault(this WebApplication app)
    {
        var routes = app.MapGroup("/api/v1/vault").RequireAuthorization();
        routes.MapGet("/status", async (Access a) => { a.Partner(); var session = await a.VaultAsync(); return Results.Ok(new { enrolled = a.User.TotpSecret != null, unlocked = session != null, expiresAt = session?.ExpiresAt }); });
        routes.MapPost("/enrollment", async (VaultPassword input, Access a, AppDb db, VaultService vault, HttpContext c) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); var user = await vault.LockUserAsync(a, c);
            if (!VaultService.CheckPassword(user, input.Password)) await vault.FailedAsync(tx, "Пароль неверен.");
            if (user.TotpSecret != null && !(a.Session.RecoveryUntil > DateTimeOffset.UtcNow))
                await vault.FailedAsync(tx, "TOTP уже подключён. Для перепривязки используйте recovery code.");
            var secret = Totp.CreateSecret(); user.PendingTotpSecret = vault.Protect(secret); user.PendingTotpExpires = DateTimeOffset.UtcNow.AddMinutes(10); user.PendingTotpSessionId = a.Session.Id;
            await vault.SuccessAsync(); await tx.CommitAsync();
            var label = Uri.EscapeDataString("LoveCloud:" + user.Username); var uri = $"otpauth://totp/{label}?secret={secret}&issuer=LoveCloud&algorithm=SHA1&digits=6&period=30";
            return Results.Ok(new { secret, otpauthUri = uri });
        });
        routes.MapPost("/enrollment/confirm", async (TotpInput input, Access a, AppDb db, VaultService vault, HttpContext c) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); var user = await vault.LockUserAsync(a, c); var now = DateTimeOffset.UtcNow;
            if (user.PendingTotpSecret == null || user.PendingTotpExpires <= now || user.PendingTotpSessionId != a.Session.Id)
                await vault.FailedAsync(tx, "Сначала начните привязку TOTP в этой сессии.");
            var step = Totp.Match(vault.Unprotect(user.PendingTotpSecret!), input.Code, now);
            if (!step.HasValue) await vault.FailedAsync(tx, "Неверный или просроченный код.");
            user.TotpSecret = user.PendingTotpSecret; user.PendingTotpSecret = null; user.PendingTotpExpires = null; user.PendingTotpSessionId = null; user.LastTotpStep = step!.Value; user.TotpVersion++;
            a.Session.RecoveryUntil = null;
            await db.VaultSessions.Where(x => x.UserId == user.Id).ExecuteDeleteAsync(); await db.RecoveryCodes.Where(x => x.UserId == user.Id).ExecuteDeleteAsync();
            var recoveryCodes = new List<string>();
            for (var i = 0; i < 10; i++) { var raw = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)); recoveryCodes.Add(string.Join('-', Enumerable.Range(0, 4).Select(n => raw.Substring(n * 8, 8)))); db.RecoveryCodes.Add(new RecoveryCode { UserId = user.Id, Hash = Tokens.Hash(raw) }); }
            await vault.SuccessAsync(); await tx.CommitAsync(); a.ClearCookie("lovecloud_vault"); return Results.Ok(new { recoveryCodes });
        });
        routes.MapPost("/unlock", async (TotpInput input, Access a, AppDb db, VaultService vault, HttpContext c) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); var user = await vault.LockUserAsync(a, c);
            if (user.TotpSecret == null) await vault.FailedAsync(tx, "Сначала подключите TOTP.");
            var step = Totp.Match(vault.Unprotect(user.TotpSecret!), input.Code, DateTimeOffset.UtcNow);
            if (!step.HasValue || step.Value <= user.LastTotpStep) await vault.FailedAsync(tx, "Код неверен, просрочен или уже использован. Дождитесь следующего кода.");
            // The per-user transaction advisory lock serializes confirmation, recovery and unlock.
            user.LastTotpStep = step!.Value;
            await db.VaultSessions.Where(x => x.AuthSessionId == a.Session.Id).ExecuteDeleteAsync();
            var token = Tokens.New(); var session = new VaultSession { UserId = user.Id, AuthSessionId = a.Session.Id, CredentialVersion = user.TotpVersion, TokenHash = Tokens.Hash(token), ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(10) }; db.VaultSessions.Add(session);
            await vault.SuccessAsync(); await tx.CommitAsync(); a.SetCookie("lovecloud_vault", token, session.ExpiresAt); return Results.Ok(new { expiresAt = session.ExpiresAt });
        });
        routes.MapPost("/lock", async (Access a, AppDb db) => { a.Partner(); await db.VaultSessions.Where(x => x.AuthSessionId == a.Session.Id).ExecuteDeleteAsync(); a.ClearCookie("lovecloud_vault"); return Results.NoContent(); });
        routes.MapPost("/recover", async (RecoveryInput input, Access a, AppDb db, VaultService vault, HttpContext c) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); var user = await vault.LockUserAsync(a, c);
            if (!VaultService.CheckPassword(user, input.Password) || input.RecoveryCode is not { Length: >= 32 and <= 64 }) await vault.FailedAsync(tx, "Пароль или recovery code неверен.");
            var hash = Tokens.Hash(VaultService.NormalizeRecovery(input.RecoveryCode)); var recovery = await db.RecoveryCodes.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Hash == hash);
            if (recovery == null) await vault.FailedAsync(tx, "Пароль или recovery code неверен.");
            db.RecoveryCodes.Remove(recovery!); await db.VaultSessions.Where(x => x.UserId == user.Id).ExecuteDeleteAsync();
            user.PendingTotpSecret = null; user.PendingTotpExpires = null; user.PendingTotpSessionId = null; user.TotpVersion++;
            a.Session.RecoveryUntil = DateTimeOffset.UtcNow.AddMinutes(10);
            await vault.SuccessAsync(); await tx.CommitAsync(); a.ClearCookie("lovecloud_vault"); return Results.Ok(new { enrollmentRequired = true, expiresAt = a.Session.RecoveryUntil });
        });
    }
}
public sealed record VaultPassword(string Password);
public sealed record TotpInput(string Code);
public sealed record RecoveryInput(string Password, string RecoveryCode);
