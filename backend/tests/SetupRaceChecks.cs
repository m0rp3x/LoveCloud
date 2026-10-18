using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LoveCloud;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

public static class SetupRaceChecks
{
    // Opt-in. Always creates and drops uniquely named test databases; never uses app data.
    public static async Task RunAsync(string connectionFile)
    {
        var connection = (await File.ReadAllTextAsync(connectionFile)).Trim();
        await Fixture(connection, WizardAsync);
        await Fixture(connection, LegacyRaceAsync);
        await Fixture(connection, ResetBackfillAsync);
    }
    private static async Task Fixture(string source, Func<WebApplication, string, string, string, Task> check)
    {
        var database = "lovecloud_checks_" + Guid.NewGuid().ToString("N");
        var root = Path.Combine(Path.GetTempPath(), "lovecloud-checks-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        var admin = new NpgsqlConnectionStringBuilder(source) { Database = "postgres", Pooling = false };
        await using var control = new NpgsqlConnection(admin.ConnectionString); await control.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", control)) await create.ExecuteNonQueryAsync();
        WebApplication? app = null;
        try
        {
            var bootstrap = Tokens.New(); var setupToken = Tokens.New();
            await File.WriteAllTextAsync(Path.Combine(root, "bootstrap"), bootstrap); await File.WriteAllTextAsync(Path.Combine(root, "token"), setupToken);
            var target = new NpgsqlConnectionStringBuilder(source) { Database = database };
            var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> {
                ["App:Origin"] = "http://localhost:3212", ["App:SecureCookies"] = "false", ["Bootstrap:PasswordFile"] = Path.Combine(root, "bootstrap"),
                ["Setup:TokenFile"] = Path.Combine(root, "token"), ["Storage:Root"] = Path.Combine(root, "files")
            });
            builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(target.ConnectionString));
            builder.Services.AddDataProtection().SetApplicationName("LoveCloud.Checks").PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(root, "keys")));
            builder.Services.AddAuthentication("session").AddScheme<AuthenticationSchemeOptions, SessionHandler>("session", _ => { });
            builder.Services.AddAuthorization(); builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped(sp => new Access(sp.GetRequiredService<Microsoft.AspNetCore.Http.IHttpContextAccessor>().HttpContext!, sp.GetRequiredService<AppDb>(), sp.GetRequiredService<IConfiguration>()));
            builder.Services.AddScoped(sp => new SetupAccess(sp.GetRequiredService<Microsoft.AspNetCore.Http.IHttpContextAccessor>().HttpContext!, sp.GetRequiredService<AppDb>()));
            builder.Services.AddScoped<AttemptLimiter>(); builder.Services.AddScoped<AvatarService>(); builder.Services.AddSingleton<Connections>();
            app = builder.Build();
            app.Use(async (c, next) => { try { await next(); } catch (ApiException e) { await Results.Problem(statusCode: e.Status, detail: e.Message).ExecuteAsync(c); } });
            app.UseAuthentication(); app.UseMiddleware<RequestSecurity>(); app.UseAuthorization();
            app.MapAuth(); app.MapSetup(); app.MapAvatars(); app.Urls.Add("http://127.0.0.1:0");
            await Bootstrap.InitializeAsync(app.Services, app.Configuration); await app.StartAsync();
            await check(app, setupToken, bootstrap, root);
        }
        finally
        {
            if (app != null) { await app.StopAsync(); await app.DisposeAsync(); }
            NpgsqlConnection.ClearAllPools();
            if (!database.StartsWith("lovecloud_checks_", StringComparison.Ordinal)) throw new InvalidOperationException();
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{database}\" WITH (FORCE)", control); await drop.ExecuteNonQueryAsync();
            var resolved = Path.GetFullPath(root);
            if (resolved.StartsWith(Path.Combine(Path.GetTempPath(), "lovecloud-checks-"), StringComparison.Ordinal)) Directory.Delete(resolved, true);
        }
    }
    private static HttpClient Client(WebApplication app)
    {
        var client = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer(), UseCookies = true }) { BaseAddress = new Uri(app.Urls.Single()) };
        client.DefaultRequestHeaders.Add("Origin", "http://localhost:3212"); return client;
    }
    private static object Completion(Guid? avatar = null, bool invalid = false) => new {
        locale = "en", theme = "cloud", pair = new { name = "Test pair", timeZone = "Europe/Moscow", avatarId = avatar }, adminPassword = "Administrator-choice-123!",
        partners = new[] {
            new { username = "first_partner", displayName = "First", password = "First-permanent-password1!", avatarId = avatar },
            new { username = invalid ? "first_partner" : "second_partner", displayName = "Second", password = "Second-initial-password2!", avatarId = (Guid?)null }
        }
    };
    private static async Task<string> Csrf(HttpResponseMessage response, string field = "csrfToken") => (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty(field).GetString()!;
    private static void Expect(bool condition, string name) { if (!condition) throw new Exception("Setup integration: " + name); }
    private static async Task WizardAsync(WebApplication app, string token, string bootstrap, string root)
    {
        using var a = Client(app); using var b = Client(app);
        var claims = await Task.WhenAll(a.PostAsJsonAsync("/api/v1/setup/exchange", new { token }), b.PostAsJsonAsync("/api/v1/setup/exchange", new { token }));
        Expect(claims.Count(x => x.StatusCode == HttpStatusCode.OK) == 1 && claims.Count(x => x.StatusCode == HttpStatusCode.Conflict) == 1, "exactly one concurrent claim");
        var winnerIndex = claims[0].IsSuccessStatusCode ? 0 : 1; var owner = winnerIndex == 0 ? a : b; var other = winnerIndex == 0 ? b : a;
        owner.DefaultRequestHeaders.Add("X-Setup-CSRF", await Csrf(claims[winnerIndex]));
        using (var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/setup/complete") { Content = JsonContent.Create(Completion()) })
        {
            request.Headers.Add("Origin", "https://invalid.example");
            Expect((await owner.SendAsync(request)).StatusCode == HttpStatusCode.Forbidden, "setup Origin guard");
        }
        var originalCsrf = owner.DefaultRequestHeaders.GetValues("X-Setup-CSRF").Single();
        owner.DefaultRequestHeaders.Remove("X-Setup-CSRF"); owner.DefaultRequestHeaders.Add("X-Setup-CSRF", "wrong");
        Expect((await owner.PostAsJsonAsync("/api/v1/setup/complete", Completion())).StatusCode == HttpStatusCode.Forbidden, "setup-only CSRF guard");
        owner.DefaultRequestHeaders.Remove("X-Setup-CSRF"); owner.DefaultRequestHeaders.Add("X-Setup-CSRF", originalCsrf);
        var form = new MultipartFormDataContent(); var content = new ByteArrayContent(AvatarChecks.Png()); content.Headers.ContentType = new("image/png"); form.Add(content, "file", "avatar.png");
        var upload = await owner.PostAsync("/api/v1/setup/avatar", form); Expect(upload.IsSuccessStatusCode, "pending avatar upload");
        var avatar = (await upload.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Expect((await other.GetAsync($"/api/v1/avatars/{avatar}/content")).StatusCode == HttpStatusCode.Unauthorized, "pending avatar inaccessible to other client");
        Expect((await owner.GetAsync($"/api/v1/avatars/{avatar}/content")).IsSuccessStatusCode, "owner sees pending avatar");
        Expect((await owner.PostAsJsonAsync("/api/v1/auth/login", new { username = "admin", password = bootstrap })).IsSuccessStatusCode, "same browser retains untouched bootstrap admin cookie");
        Expect((await owner.GetAsync($"/api/v1/avatars/{avatar}/content")).IsSuccessStatusCode, "owned pending avatar works with setup and must-change admin cookies together");
        Expect((await owner.GetAsync("/api/v1/admin/users")).StatusCode == HttpStatusCode.Forbidden, "mixed cookies do not bypass ordinary must-change guard");
        var resumed = await owner.GetFromJsonAsync<JsonElement>("/api/v1/setup/session");
        Expect(resumed.GetProperty("pendingAvatars").GetArrayLength() == 1 && resumed.GetProperty("pendingAvatars")[0].GetProperty("id").GetGuid() == avatar && resumed.GetProperty("pendingAvatars")[0].GetProperty("url").GetString() == $"/api/v1/avatars/{avatar}/content", "setup reload resumes owned pending avatar ids and urls");
        Expect((await other.GetAsync("/api/v1/setup/session")).StatusCode == HttpStatusCode.Unauthorized, "other client cannot enumerate pending avatar ids");
        var bad = await owner.PostAsJsonAsync("/api/v1/setup/complete", Completion(avatar, invalid: true)); Expect(bad.StatusCode == HttpStatusCode.BadRequest, "invalid completion rejected");
        await using (var scope = app.Services.CreateAsyncScope()) Expect(await scope.ServiceProvider.GetRequiredService<AppDb>().Users.CountAsync() == 1, "invalid complete rolled back users");
        var complete = await Task.WhenAll(owner.PostAsJsonAsync("/api/v1/setup/complete", Completion(avatar)), owner.PostAsJsonAsync("/api/v1/setup/complete", Completion(avatar)));
        Expect(complete.Count(x => x.IsSuccessStatusCode) == 1, "exactly one concurrent complete");
        var me = await owner.GetFromJsonAsync<JsonElement>("/api/v1/auth/me"); Expect(me.GetProperty("user").GetProperty("slot").GetInt32() == 2 && !me.GetProperty("user").GetProperty("mustChangePassword").GetBoolean(), "first partner signed in permanently");
        owner.DefaultRequestHeaders.Add("X-CSRF-Token", await Csrf(await owner.GetAsync("/api/v1/auth/csrf"), "token"));
        foreach (var theme in new[] { "berry", "rose", "cloud" }) Expect((await owner.PatchAsJsonAsync("/api/v1/settings/appearance", new { theme })).IsSuccessStatusCode, "theme " + theme);
        foreach (var locale in new[] { "ru", "en" }) Expect((await owner.PatchAsJsonAsync("/api/v1/settings/appearance", new { locale })).IsSuccessStatusCode, "locale " + locale);
        Expect((await owner.GetAsync($"/api/v1/avatars/{avatar}/content")).IsSuccessStatusCode, "promoted avatar available to ordinary session");
        await File.WriteAllTextAsync(Path.Combine(root, "token"), Tokens.New()); await Bootstrap.InitializeAsync(app.Services, app.Configuration);
        var status = await owner.GetFromJsonAsync<JsonElement>("/api/v1/setup/status"); Expect(!status.GetProperty("required").GetBoolean(), "completed setup never reopens after token reset");
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>(); var users = await db.Users.OrderBy(x => x.Slot).ToListAsync();
            Expect(users.Count == 3 && users[2].MustChangePassword && !users[0].MustChangePassword, "three correct permanent/initial slots");
            Expect(await db.SetupSessions.CountAsync() == 0 && (await db.Setup.SingleAsync()).TokenHash == null, "setup claims and token revoked");
        }
        Console.WriteLine("PASS PostgreSQL setup claim/complete races, rollback, avatar ownership, appearance and closed restart");
    }
    private static async Task LegacyRaceAsync(WebApplication app, string token, string bootstrap, string root)
    {
        using var wizard = Client(app); using var legacy = Client(app);
        wizard.DefaultRequestHeaders.Add("X-Setup-CSRF", await Csrf(await wizard.PostAsJsonAsync("/api/v1/setup/exchange", new { token })));
        Expect((await legacy.PostAsJsonAsync("/api/v1/auth/login", new { username = "admin", password = bootstrap })).IsSuccessStatusCode, "legacy login");
        legacy.DefaultRequestHeaders.Add("X-CSRF-Token", await Csrf(await legacy.GetAsync("/api/v1/auth/csrf"), "token"));
        var results = await Task.WhenAll(wizard.PostAsJsonAsync("/api/v1/setup/complete", Completion()), legacy.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = bootstrap, newPassword = "Legacy-admin-permanent123!" }));
        Expect(results.Count(r => r.IsSuccessStatusCode) == 1, "legacy admin change versus wizard has one winner");
        await using var scope = app.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var state = await db.Setup.SingleAsync(); var count = await db.Users.CountAsync();
        Expect(state.Completed && state.TokenHash == null && state.ClaimSessionId == null && (count == 1 || count == 3), "race leaves a completed consistent installation");
        var password = (await db.Users.SingleAsync(x => x.Slot == 1)).PasswordHash; var name = (await db.Pair.SingleAsync()).Name;
        await File.WriteAllTextAsync(Path.Combine(root, "token"), Tokens.New()); await Bootstrap.InitializeAsync(app.Services, app.Configuration);
        await db.Entry(await db.Users.SingleAsync(x => x.Slot == 1)).ReloadAsync();
        Expect((await db.Users.SingleAsync(x => x.Slot == 1)).PasswordHash == password && (await db.Pair.SingleAsync()).Name == name, "restart/reset preserves accounts and pair");
        Console.WriteLine("PASS PostgreSQL legacy password change versus wizard completion race and restart preservation");
    }
    private static async Task ResetBackfillAsync(WebApplication app, string token, string bootstrap, string root)
    {
        using var old = Client(app); using var next = Client(app);
        Expect((await old.PostAsJsonAsync("/api/v1/setup/exchange", new { token })).IsSuccessStatusCode, "initial reset claim");
        var replacement = Tokens.New(); await File.WriteAllTextAsync(Path.Combine(root, "token"), replacement);
        await Bootstrap.InitializeAsync(app.Services, app.Configuration);
        Expect((await old.GetAsync("/api/v1/setup/session")).StatusCode == HttpStatusCode.Unauthorized, "token reset revokes original setup cookie");
        Expect((await next.PostAsJsonAsync("/api/v1/setup/exchange", new { token })).StatusCode == HttpStatusCode.Unauthorized, "old secret rejected after operator reset");
        Expect((await next.PostAsJsonAsync("/api/v1/setup/exchange", new { token = replacement })).IsSuccessStatusCode, "replacement secret can claim");
        string originalHash;
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>(); var admin = await db.Users.SingleAsync(); originalHash = admin.PasswordHash;
            admin.MustChangePassword = false; (await db.Pair.SingleAsync()).Name = "Preserve existing pair"; await db.SaveChangesAsync();
            await db.Setup.ExecuteDeleteAsync(); // Represents an older configured installation without the new singleton.
        }
        await Bootstrap.InitializeAsync(app.Services, app.Configuration);
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            Expect((await db.Setup.SingleAsync()).Completed && (await db.Users.SingleAsync()).PasswordHash == originalHash && (await db.Pair.SingleAsync()).Name == "Preserve existing pair", "configured legacy installation backfills without resetting data");
        }
        Expect((await next.GetAsync("/api/v1/setup/session")).StatusCode == HttpStatusCode.Unauthorized, "backfill revokes prior setup claim");
        Console.WriteLine("PASS PostgreSQL incomplete setup token reset and non-destructive configured legacy backfill");
    }
}
