using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LoveCloud;

public sealed class ApiException(int status, string detail) : Exception(detail)
{
    public int Status { get; } = status;
}
public static class Validation
{
    public static void Require(bool condition, string message, int status = 400) { if (!condition) throw new ApiException(status, message); }
    public static string Text(string? value, string name, int max = 240)
    {
        var text = value?.Trim() ?? "";
        Require(text.Length is > 0 && text.Length <= max && !text.Any(char.IsControl), $"Поле «{name}» должно содержать 1–{max} символов без управляющих знаков.");
        return text;
    }
    public static string Body(string? value, int max = 8000)
    {
        var text = value?.Trim() ?? "";
        Require(text.Length <= max && !text.Any(c => char.IsControl(c) && c != '\n' && c != '\r' && c != '\t'), $"Текст длиннее {max} символов или содержит недопустимые знаки.");
        return text;
    }
    public static void Password(string? value) => Require(value is { Length: >= 12 and <= 256 }, "Пароль должен содержать от 12 до 256 символов.");
    public static string Choice(string? value, string[] choices, string name)
    {
        Require(value != null && choices.Contains(value), $"Недопустимое значение: {name}."); return value!;
    }
    public static string Space(string? space) => Choice(space ?? "shared", ["shared", "vault"], "space");
    public static string FileName(string? name)
    {
        var n = Text(name, "имя", 240).Normalize(NormalizationForm.FormC);
        Require(n is not "." and not ".." && !n.Contains('/') && !n.Contains('\\'), "Имя не должно содержать путь."); return n;
    }
    public static string? Link(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        Require(value.Length <= 2048 && !value.Any(char.IsControl) && Uri.TryCreate(value, UriKind.Absolute, out _), "Некорректная ссылка.");
        var uri = new Uri(value);
        Require(uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo) && !string.IsNullOrWhiteSpace(uri.Host), "Разрешены только абсолютные HTTP(S) ссылки без имени пользователя.");
        return uri.AbsoluteUri;
    }
    public static DateOnly? Date(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        Require(DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _), "Дата должна иметь формат YYYY-MM-DD.");
        return DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);
    }
}
public static class Tokens
{
    public static string New() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public static bool Equal(string? a, string? b) => a != null && b != null && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}

public sealed class SessionHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger,
    UrlEncoder encoder, AppDb db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Cookie = "lovecloud_session";
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = Request.Cookies[Cookie];
        if (string.IsNullOrEmpty(token) || token.Length != 64) return AuthenticateResult.NoResult();
        var hash = Tokens.Hash(token);
        var session = await db.Sessions.FirstOrDefaultAsync(x => x.TokenHash == hash && x.ExpiresAt > DateTimeOffset.UtcNow);
        if (session == null) return AuthenticateResult.NoResult();
        var user = await db.Users.FindAsync(session.UserId);
        if (user == null || user.Disabled) return AuthenticateResult.NoResult();
        Context.Items["user"] = user; Context.Items["session"] = session;
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Role, user.Role)], Scheme.Name);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }
    protected override Task HandleChallengeAsync(AuthenticationProperties properties) => Results.Problem(statusCode: 401, title: "Требуется вход", detail: "Войдите в LoveCloud.").ExecuteAsync(Context);
    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) => Results.Problem(statusCode: 403, title: "Нет доступа", detail: "Недостаточно прав.").ExecuteAsync(Context);
}

public sealed class Access(HttpContext context, AppDb db, IConfiguration config)
{
    public UserAccount User => context.Items["user"] as UserAccount ?? throw new ApiException(401, "Требуется вход.");
    public AuthSession Session => context.Items["session"] as AuthSession ?? throw new ApiException(401, "Требуется вход.");
    public void Partner() => Validation.Require(User.Role == "partner", "Раздел доступен партнёрам.", 403);
    public void Admin() => Validation.Require(User.Role == "admin", "Раздел доступен администратору.", 403);
    public bool Secure => config.GetValue("App:SecureCookies", true);
    public CookieOptions CookieOptions(string path = "/") => new() { HttpOnly = true, Secure = Secure, SameSite = SameSiteMode.Strict, Path = path, IsEssential = true };
    public void SetCookie(string name, string token, DateTimeOffset expires, string path = "/")
    { var options = CookieOptions(path); options.Expires = expires; context.Response.Cookies.Append(name, token, options); }
    public void ClearCookie(string name, string path = "/") => context.Response.Cookies.Delete(name, CookieOptions(path));
    public async Task<VaultSession?> VaultAsync()
    {
        Partner();
        var token = context.Request.Cookies["lovecloud_vault"];
        if (token is not { Length: 64 }) return null;
        var hash = Tokens.Hash(token);
        return await db.VaultSessions.FirstOrDefaultAsync(v => v.TokenHash == hash && v.UserId == User.Id && v.AuthSessionId == Session.Id && v.CredentialVersion == User.TotpVersion && v.ExpiresAt > DateTimeOffset.UtcNow);
    }
    public async Task SpaceAsync(string space)
    {
        Partner();
        if (space == "vault" && await VaultAsync() == null) throw new ApiException(423, "Откройте приватное хранилище кодом TOTP.");
    }
}

public sealed class RequestSecurity(RequestDelegate next, IConfiguration config)
{
    public async Task InvokeAsync(HttpContext context, SetupAccess setup)
    {
        if (context.Request.Path.StartsWithSegments("/api/v1"))
        {
            context.Response.Headers.CacheControl = "no-store";
            var path = context.Request.Path.Value!;
            var isSetup = context.Request.Path.StartsWithSegments("/api/v1/setup");
            var isAvatarRead = context.Request.Path.StartsWithSegments("/api/v1/avatars") && (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method));
            if (!isSetup && !isAvatarRead && context.Items["user"] is UserAccount { MustChangePassword: true } && path is not "/api/v1/auth/me" and not "/api/v1/auth/csrf" and not "/api/v1/auth/change-password" and not "/api/v1/auth/logout")
                throw new ApiException(403, "Сначала смените первоначальный пароль.");
            if (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) || HttpMethods.IsPatch(context.Request.Method) || HttpMethods.IsDelete(context.Request.Method))
            {
                var origin = context.Request.Headers.Origin.ToString();
                SetupText.Require(context, !string.IsNullOrEmpty(origin) && origin.TrimEnd('/') == config["App:Origin"]?.TrimEnd('/'), "Недопустимый Origin.", "Invalid request Origin.", 403);
                if (isSetup)
                {
                    if (path != "/api/v1/setup/exchange") await setup.GuardMutationAsync();
                }
                else if (path != "/api/v1/auth/login")
                {
                    var session = context.Items["session"] as AuthSession ?? throw new ApiException(401, "Требуется вход.");
                    Validation.Require(Tokens.Equal(session.CsrfToken, context.Request.Headers["X-CSRF-Token"]), "Проверка CSRF не пройдена.", 403);
                }
            }
        }
        if (context.Request.Path.StartsWithSegments("/hubs/workspace"))
        {
            var origin = context.Request.Headers.Origin.ToString();
            Validation.Require(origin.TrimEnd('/') == config["App:Origin"]?.TrimEnd('/'), "Недопустимый Origin.", 403);
            Validation.Require(context.Items["user"] is UserAccount { Role: "partner", MustChangePassword: false }, "Требуется вход партнёра.", 403);
        }
        await next(context);
    }
}

public sealed class AttemptLimiter(AppDb db)
{
    // Call inside a transaction; persist failures before returning an authentication error.
    public async Task<AuthThrottle> BeginAsync(string key, int max = 5, int minutes = 5)
    {
        await db.LockAsync("throttle:" + key);
        var now = DateTimeOffset.UtcNow;
        var row = await db.Throttles.FindAsync(key);
        if (row == null) { row = new AuthThrottle { Key = key, WindowStart = now }; db.Throttles.Add(row); }
        if (row.BlockedUntil > now) throw new ApiException(429, "Слишком много попыток. Повторите через 15 минут.");
        if (row.WindowStart < now.AddMinutes(-minutes)) { row.WindowStart = now; row.Failures = 0; row.BlockedUntil = null; }
        row.Failures++;
        if (row.Failures >= max) row.BlockedUntil = now.AddMinutes(15);
        return row;
    }
}
