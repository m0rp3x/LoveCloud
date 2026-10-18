using System.Text.Json.Serialization;
using LoveCloud;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);
var connectionFile = builder.Configuration["ConnectionStrings:DatabaseFile"];
var connection = connectionFile != null ? File.ReadAllText(connectionFile).Trim() : builder.Configuration.GetConnectionString("Database");
if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("Database connection secret is required.");
var origin = builder.Configuration["App:Origin"] ?? throw new InvalidOperationException("App:Origin is required.");
if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri) || originUri.AbsolutePath != "/") throw new InvalidOperationException("App:Origin must contain only scheme, host and port.");
if (!builder.Configuration.GetValue("App:SecureCookies", true) && !(originUri.IsLoopback && originUri.Scheme == "http")) throw new InvalidOperationException("Insecure cookies are only allowed for loopback HTTP.");
var keyPath = builder.Configuration["DataProtection:KeyPath"] ?? "/data/keys";
Directory.CreateDirectory(keyPath);
if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(keyPath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
builder.Services.AddDataProtection().SetApplicationName("LoveCloud.v1").PersistKeysToFileSystem(new DirectoryInfo(keyPath));
builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(connection));
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = StorageService.MaxFileBytes + 65536);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = StorageService.MaxFileBytes + 65536);
builder.Services.AddAuthentication("session").AddScheme<AuthenticationSchemeOptions, SessionHandler>("session", _ => { });
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped(sp => new Access(sp.GetRequiredService<IHttpContextAccessor>().HttpContext!, sp.GetRequiredService<AppDb>(), sp.GetRequiredService<IConfiguration>()));
builder.Services.AddScoped<AttemptLimiter>();
builder.Services.AddScoped<StorageService>();
builder.Services.AddScoped<DtoService>();
builder.Services.AddScoped<VaultService>();
builder.Services.AddScoped<AvatarService>();
builder.Services.AddScoped(sp => new SetupAccess(sp.GetRequiredService<IHttpContextAccessor>().HttpContext!, sp.GetRequiredService<AppDb>()));
builder.Services.AddSignalR(o => { o.EnableDetailedErrors = false; o.MaximumReceiveMessageSize = 4096; });
builder.Services.AddSingleton<Connections>();
builder.Services.AddHostedService<OutboxWorker>();

var app = builder.Build();
app.Use(async (context, next) => {
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    try { await next(); }
    catch (Exception e) when (!context.Response.HasStarted)
    {
        var api = e as ApiException;
        var status = api?.Status ?? (e is BadHttpRequestException bad ? bad.StatusCode :
            e is DbUpdateException { InnerException: PostgresException { SqlState: "23505" or "23503" or "23514" } } ? 409 : 500);
        if (status == 500) app.Logger.LogError("Unhandled API error ({ErrorType}).", e.GetType().Name);
        if (status == 429) context.Response.Headers.RetryAfter = "900";
        var englishSetup = context.Request.Path.StartsWithSegments("/api/v1/setup") && SetupText.English(context);
        await Results.Problem(statusCode: status, title: englishSetup ? "Setup request failed" : status switch { 401 => "Требуется вход", 403 => "Нет доступа", 404 => "Не найдено", 409 => "Конфликт", 423 => "Хранилище закрыто", 429 => "Слишком много попыток", _ => "Ошибка запроса" },
            detail: api?.Message ?? (status == 409 ? "Изменение конфликтует с существующими данными." : status < 500 ? "Некорректный запрос." : "Внутренняя ошибка сервера.")).ExecuteAsync(context);
    }
});
app.UseAuthentication();
app.UseMiddleware<RequestSecurity>();
app.UseAuthorization();
app.MapGet("/health", async (AppDb db) => await db.Database.CanConnectAsync() ? Results.Ok(new { status = "ready" }) : Results.Problem(statusCode: 503));
app.MapAuth();
app.MapStorage();
app.MapSocial();
app.MapPlannerWishes();
app.MapVault();
app.MapSetup();
app.MapAvatars();
app.MapHub<WorkspaceHub>("/hubs/workspace").RequireAuthorization();
await Bootstrap.InitializeAsync(app.Services, builder.Configuration);
await app.RunAsync();

public partial class Program { }
