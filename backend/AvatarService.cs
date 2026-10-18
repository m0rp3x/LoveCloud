using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using SkiaSharp;

namespace LoveCloud;

public sealed class AvatarService(AppDb db, IConfiguration config)
{
    public const long MaxUploadBytes = 2L * 1024 * 1024;
    private static readonly SemaphoreSlim DecodeSlots = new(2);
    private string Root => Path.Combine(Path.GetFullPath(config["Storage:Root"] ?? "/data/files"), "avatars");
    public string PathFor(AvatarImage avatar) => Path.Combine(Root, avatar.BlobKey);
    public async Task<byte[]> ReadUploadAsync(HttpContext c)
    {
        var limit = c.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = MaxUploadBytes + 65536;
        SetupText.Require(c, c.Request.ContentLength is null || c.Request.ContentLength <= MaxUploadBytes + 65536, "Аватар больше 2 MiB.", "Avatar exceeds 2 MiB.", 413);
        SetupText.Require(c, MediaTypeHeaderValue.TryParse(c.Request.ContentType, out var type) && type.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase), "Ожидается multipart/form-data.", "Expected multipart/form-data.", 415);
        var boundary = HeaderUtilities.RemoveQuotes(type!.Boundary).Value;
        SetupText.Require(c, !string.IsNullOrEmpty(boundary) && boundary.Length <= 128, "Некорректная boundary.", "Invalid multipart boundary.");
        var reader = new MultipartReader(boundary!, c.Request.Body) { BodyLengthLimit = MaxUploadBytes + 65536, HeadersCountLimit = 8, HeadersLengthLimit = 4096 };
        byte[]? file = null; string? mime = null; MultipartSection? section;
        while ((section = await reader.ReadNextSectionAsync(c.RequestAborted)) != null)
        {
            SetupText.Require(c, ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var d) && HeaderUtilities.RemoveQuotes(d.Name).Value == "file" && (d.FileName.HasValue || d.FileNameStar.HasValue) && file == null, "Нужен ровно один файл в поле file.", "Exactly one file named file is required.");
            mime = section.ContentType?.Split(';')[0].Trim().ToLowerInvariant();
            SetupText.Require(c, mime is "image/png" or "image/jpeg" or "image/webp", "Допустимы PNG, JPEG и WebP.", "Only PNG, JPEG and WebP are allowed.", 415);
            using var buffer = new MemoryStream(); var chunk = new byte[16384]; int read;
            while ((read = await section.Body.ReadAsync(chunk, c.RequestAborted)) > 0)
            {
                SetupText.Require(c, buffer.Length + read <= MaxUploadBytes, "Аватар больше 2 MiB.", "Avatar exceeds 2 MiB.", 413);
                buffer.Write(chunk, 0, read);
            }
            file = buffer.ToArray();
        }
        SetupText.Require(c, file is { Length: > 0 }, "Выберите изображение.", "Select an image.");
        return await SanitizeAsync(file!, mime!, c.RequestAborted);
    }
    public static async Task<byte[]> SanitizeAsync(byte[] bytes, string mime, CancellationToken cancellation = default)
    {
        Validation.Require(bytes.Length is > 0 and <= (int)MaxUploadBytes, "Avatar exceeds 2 MiB.", 413);
        var signature = bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) ? "image/png" :
            bytes.Length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255 ? "image/jpeg" :
            bytes.Length >= 12 && System.Text.Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && System.Text.Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP" ? "image/webp" : null;
        Validation.Require(signature != null && signature == mime, "Image signature does not match PNG, JPEG or WebP content type.", 415);
        await DecodeSlots.WaitAsync(cancellation);
        try
        {
            using var data = SKData.CreateCopy(bytes);
            using var codec = SKCodec.Create(data) ?? throw new ApiException(415, "The image cannot be decoded safely.");
            Validation.Require(codec.EncodedFormat is SKEncodedImageFormat.Png or SKEncodedImageFormat.Jpeg or SKEncodedImageFormat.Webp, "Unsupported image format.", 415);
            var info = codec.Info;
            Validation.Require(info.Width is > 0 and <= 4096 && info.Height is > 0 and <= 4096 && (long)info.Width * info.Height <= 16000000, "Avatar dimensions exceed 4096px or 16 megapixels.", 413);
            using var bitmap = new SKBitmap(new SKImageInfo(info.Width, info.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
            Validation.Require(codec.GetPixels(bitmap.Info, bitmap.GetPixels()) == SKCodecResult.Success, "The image is invalid or incomplete.", 415);
            cancellation.ThrowIfCancellationRequested();
            var scale = Math.Min(1d, 512d / Math.Max(info.Width, info.Height));
            var target = new SKImageInfo(Math.Max(1, (int)(info.Width * scale)), Math.Max(1, (int)(info.Height * scale)), SKColorType.Rgba8888, SKAlphaType.Premul);
            using var resized = bitmap.Resize(target, new SKSamplingOptions(SKFilterMode.Linear)) ?? throw new ApiException(415, "The image cannot be resized.");
            using var image = SKImage.FromBitmap(resized);
            using var output = image.Encode(SKEncodedImageFormat.Png, 100);
            Validation.Require(output != null && output.Size <= MaxUploadBytes, "Sanitized avatar exceeds 2 MiB.", 413);
            return output!.ToArray();
        }
        finally { DecodeSlots.Release(); }
    }
    public async Task<AvatarImage> CreateAsync(byte[] sanitized, Guid? setupSessionId, CancellationToken cancellation)
    {
        Directory.CreateDirectory(Root);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(Root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var avatar = new AvatarImage { BlobKey = Guid.NewGuid().ToString("N"), PendingSessionId = setupSessionId, Ready = setupSessionId == null };
        var path = PathFor(avatar);
        await using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 16384, FileOptions.Asynchronous))
            await output.WriteAsync(sanitized, cancellation);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        db.Avatars.Add(avatar); return avatar;
    }
    private static DateTimeOffset nextCleanup;
    public async Task CleanupAsync(CancellationToken cancellation)
    {
        if (DateTimeOffset.UtcNow < nextCleanup) return;
        nextCleanup = DateTimeOffset.UtcNow.AddMinutes(10);
        await using var tx = await db.Database.BeginTransactionAsync(cancellation); await db.LockAsync("setup"); await db.LockAsync("avatars");
        var cutoff = DateTimeOffset.UtcNow.AddHours(-1); var now = DateTimeOffset.UtcNow;
        var unused = await db.Avatars.Where(a => a.CreatedAt < cutoff && !db.Users.Any(u => u.AvatarId == a.Id) && !db.Pair.Any(p => p.AvatarId == a.Id) &&
            (a.PendingSessionId == null || !db.SetupSessions.Any(s => s.Id == a.PendingSessionId && s.ExpiresAt > now && db.Setup.Any(st => !st.Completed && st.ClaimSessionId == s.Id)))).Take(100).ToListAsync(cancellation);
        foreach (var avatar in unused) db.Avatars.Remove(avatar);
        await db.SaveChangesAsync(cancellation); await tx.CommitAsync(cancellation);
        // Delete only after commit: a failed cleanup cannot break an existing reference.
        foreach (var avatar in unused) { var path = PathFor(avatar); if (File.Exists(path)) File.Delete(path); }
        if (Directory.Exists(Root))
        {
            var keys = (await db.Avatars.Select(a => a.BlobKey).ToListAsync(cancellation)).ToHashSet(StringComparer.Ordinal);
            foreach (var path in Directory.EnumerateFiles(Root))
                if (File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddHours(-1) && !keys.Contains(Path.GetFileName(path))) File.Delete(path);
        }
    }
}

public static class AvatarEndpoints
{
    public static void MapAvatars(this WebApplication app)
    {
        app.MapMethods("/api/v1/avatars/{id:guid}/content", ["GET", "HEAD"], async (Guid id, HttpContext c, AppDb db, SetupAccess setup, AvatarService avatars) => {
            var ordinary = c.Items["user"] as UserAccount;
            var setupSession = ordinary == null ? await setup.CurrentAsync() : null;
            Validation.Require(ordinary != null || setupSession != null, "Avatar requires an authenticated session.", 401);
            var avatar = await db.Avatars.AsNoTracking().SingleOrDefaultAsync(a => a.Id == id) ?? throw new ApiException(404, "Avatar not found.");
            var ready = avatar.Ready && ordinary != null && (await db.Users.AnyAsync(u => u.AvatarId == id) || await db.Pair.AnyAsync(p => p.AvatarId == id));
            var pending = !avatar.Ready && avatar.PendingSessionId.HasValue && (setupSession ?? await setup.CurrentAsync())?.Id == avatar.PendingSessionId;
            Validation.Require(ready || pending, "Avatar not found or inaccessible.", ordinary == null && !pending ? 401 : 404);
            var path = avatars.PathFor(avatar); Validation.Require(File.Exists(path), "Avatar not found.", 404);
            c.Response.Headers.CacheControl = "no-store"; c.Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
            return Results.File(path, "image/png", enableRangeProcessing: false);
        });
        var routes = app.MapGroup("/api/v1").RequireAuthorization();
        routes.MapPatch("/settings/appearance", async (AppearanceInput input, Access access, AppDb db) => {
            _ = access.User; var pair = await db.Pair.SingleAsync();
            if (input.Locale != null) pair.Locale = Appearance.Locale(input.Locale);
            if (input.Theme != null) pair.Theme = Appearance.Theme(input.Theme);
            db.Changed("settings"); await db.SaveChangesAsync(); return Results.Ok(Appearance.PairDto(pair));
        });
        routes.MapPost("/profile/avatar", async (HttpContext c, Access access, AppDb db, AvatarService avatars) => {
            _ = access.User; var bytes = await avatars.ReadUploadAsync(c);
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("avatars");
            await db.Entry(access.User).ReloadAsync();
            var avatar = await avatars.CreateAsync(bytes, null, c.RequestAborted); access.User.AvatarId = avatar.Id; db.Changed("settings");
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(AuthEndpoints.UserDto(access.User));
        }).DisableAntiforgery().WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(AvatarService.MaxUploadBytes + 65536));
        routes.MapPost("/pair/avatar", async (HttpContext c, Access access, AppDb db, AvatarService avatars) => {
            _ = access.User; var bytes = await avatars.ReadUploadAsync(c);
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("avatars");
            var pair = await db.Pair.SingleAsync(); var avatar = await avatars.CreateAsync(bytes, null, c.RequestAborted); pair.AvatarId = avatar.Id; db.Changed("settings");
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(Appearance.PairDto(pair));
        }).DisableAntiforgery().WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(AvatarService.MaxUploadBytes + 65536));
        routes.MapDelete("/profile/avatar", async (Access access, AppDb db) => {
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("avatars"); await db.Entry(access.User).ReloadAsync(); access.User.AvatarId = null; db.Changed("settings"); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapDelete("/pair/avatar", async (Access access, AppDb db) => {
            _ = access.User; await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("avatars"); var pair = await db.Pair.SingleAsync(); pair.AvatarId = null; db.Changed("settings"); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
    }
}
public sealed record AppearanceInput(string? Locale, string? Theme);
