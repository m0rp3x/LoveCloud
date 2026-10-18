using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace LoveCloud;

public static class StorageEndpoints
{
    public static void MapStorage(this WebApplication app)
    {
        var routes = app.MapGroup("/api/v1").RequireAuthorization();
        routes.MapGet("/pair/members", async (Access a, AppDb db) => { a.Partner(); return Results.Ok((await db.Users.Where(x => x.Role == "partner").OrderBy(x => x.Slot).Select(x => new { x.Id, x.DisplayName, x.AvatarId }).ToListAsync()).Select(x => new { x.Id, x.DisplayName, avatarUrl = Appearance.AvatarUrl(x.AvatarId) })); });
        routes.MapGet("/folders", async (string? space, Access a, AppDb db) => { space = Validation.Space(space); await a.SpaceAsync(space); return Results.Ok((await db.Folders.Where(x => x.Space == space).OrderBy(x => x.Name).ToListAsync()).Select(DtoService.Folder)); });
        routes.MapPost("/folders", async (FolderInput input, Access a, AppDb db, StorageService storage) => {
            var space = Validation.Space(input.Space); await a.SpaceAsync(space);
            await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage"); await storage.FolderAsync(input.ParentId, space);
            var f = new Folder { Name = Validation.FileName(input.Name), ParentId = input.ParentId, Space = space }; f.NormalizedName = f.Name.ToUpperInvariant(); db.Folders.Add(f);
            if (space == "shared") { db.Log(a.User.Id, "Создал(а) папку «" + f.Name + "»"); db.Changed("files", f.Id); }
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(DtoService.Folder(f));
        });
        routes.MapPatch("/folders/{id:guid}", async (Guid id, System.Text.Json.JsonElement input, Access a, AppDb db, StorageService storage) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage");
            var f = await db.Folders.FindAsync(id) ?? throw new ApiException(404, "Папка не найдена."); await a.SpaceAsync(f.Space);
            if (input.TryGetProperty("name", out var name)) { f.Name = Validation.FileName(name.GetString()); f.NormalizedName = f.Name.ToUpperInvariant(); }
            if (input.TryGetProperty("parentId", out var parent))
            {
                var parentId = JsonInput.NullableGuid(parent); await storage.FolderAsync(parentId, f.Space); var ancestor = parentId;
                while (ancestor.HasValue) { Validation.Require(ancestor != f.Id, "Нельзя поместить папку в себя или потомка.", 409); ancestor = (await db.Folders.FindAsync(ancestor.Value))!.ParentId; }
                f.ParentId = parentId;
            }
            if (f.Space == "shared") { db.Log(a.User.Id, "Изменил(а) папку «" + f.Name + "»"); db.Changed("files", id); }
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(DtoService.Folder(f));
        });
        routes.MapDelete("/folders/{id:guid}", async (Guid id, Access a, AppDb db) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage");
            var f = await db.Folders.FindAsync(id) ?? throw new ApiException(404, "Папка не найдена."); await a.SpaceAsync(f.Space);
            Validation.Require(!await db.Folders.AnyAsync(x => x.ParentId == id) && !await db.Files.AnyAsync(x => x.FolderId == id), "Папка содержит файлы, корзину или вложенные папки.", 409);
            db.Folders.Remove(f); if (f.Space == "shared") { db.Log(a.User.Id, "Удалил(а) пустую папку «" + f.Name + "»"); db.Changed("files", id); }
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapPost("/folders/envelope", async (EnvelopeInput input, Access a, AppDb db, StorageService storage) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage");
            var ids = input.FileIds ?? []; Validation.Require(ids.Length is > 0 and <= 100 && ids.Distinct().Count() == ids.Length, "Выберите 1–100 файлов.");
            var files = await db.Files.Where(x => ids.Contains(x.Id)).ToListAsync(); Validation.Require(files.Count == ids.Length && files.All(x => x.TrashedAt == null), "Некоторые файлы недоступны.", 404);
            var space = files[0].Space; Validation.Require(files.All(x => x.Space == space), "Выбранные файлы должны принадлежать одному space."); await a.SpaceAsync(space); await storage.FolderAsync(input.ParentId, space);
            var f = new Folder { Name = Validation.FileName(input.Name), ParentId = input.ParentId, Space = space }; f.NormalizedName = f.Name.ToUpperInvariant(); db.Folders.Add(f);
            foreach (var file in files) { file.FolderId = f.Id; file.UpdatedAt = DateTimeOffset.UtcNow; }
            if (space == "shared") { db.Log(a.User.Id, "Собрал(а) файлы в конверт «" + f.Name + "»"); db.Changed("files", f.Id); }
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(DtoService.Folder(f));
        });
        routes.MapGet("/files", async (string? folderId, string? q, string? view, string? space, Access a, AppDb db, StorageService storage, DtoService dto) => {
            space = Validation.Space(space); await a.SpaceAsync(space); Guid? folder = null;
            if (!string.IsNullOrEmpty(folderId)) { Validation.Require(Guid.TryParse(folderId, out _), "Некорректная папка."); folder = Guid.Parse(folderId); }
            if (view != null) Validation.Choice(view, ["recent", "favorites", "trash"], "view");
            var query = db.Files.Where(x => x.Space == space && (view == "trash" ? x.TrashedAt != null : x.TrashedAt == null));
            if (!string.IsNullOrWhiteSpace(q)) { Validation.Require(q.Length <= 240, "Слишком длинный поиск."); var term = q.ToLowerInvariant(); query = query.Where(x => x.Name.ToLower().Contains(term)); }
            else if (view == null) { await storage.FolderAsync(folder, space); query = query.Where(x => x.FolderId == folder); }
            if (view == "favorites") query = query.Where(x => db.Favorites.Any(f => f.UserId == a.User.Id && f.FileId == x.Id));
            if (view == "recent") query = query.Where(x => db.Recent.Any(f => f.UserId == a.User.Id && f.FileId == x.Id)).OrderByDescending(x => db.Recent.Where(r => r.UserId == a.User.Id && r.FileId == x.Id).Select(r => r.OpenedAt).First());
            else query = query.OrderBy(x => x.Name).ThenBy(x => x.Id);
            return Results.Ok(await dto.FilesAsync(await query.ToListAsync()));
        });
        routes.MapPost("/files/upload", async (HttpContext c, Access a, StorageService storage, DtoService dto) => Results.Ok(await dto.FileAsync(await storage.UploadAsync(c, a)))).DisableAntiforgery();
        routes.MapMethods("/files/{id:guid}/content", ["GET", "HEAD"], async (Guid id, HttpContext c, Access a, AppDb db, StorageService storage) => {
            var file = await storage.FileAsync(id); await a.SpaceAsync(file.Space); Validation.Require(file.TrashedAt == null, "Файл в корзине.", 404);
            var path = storage.BlobPath(file); Validation.Require(File.Exists(path), "Файл недоступен на диске.", 404);
            var sessionId = a.Session.Id; var userId = a.User.Id; var vault = file.Space == "vault" ? await a.VaultAsync() : null;
            if (file.Space == "shared" && HttpMethods.IsGet(c.Request.Method) && !c.Request.Headers.ContainsKey("Range"))
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Recent\" (\"UserId\",\"FileId\",\"OpenedAt\") VALUES ({userId},{id},{DateTimeOffset.UtcNow}) ON CONFLICT (\"UserId\",\"FileId\") DO UPDATE SET \"OpenedAt\"=EXCLUDED.\"OpenedAt\"");
            }
            c.Response.Headers.CacheControl = "no-store";
            var disposition = new ContentDispositionHeaderValue(file.MimeType.StartsWith("image/") || file.MimeType.StartsWith("video/") || file.MimeType.StartsWith("audio/") || file.MimeType == "application/pdf" ? "inline" : "attachment");
            disposition.SetHttpFileName(file.Name); c.Response.Headers.ContentDisposition = disposition.ToString();
            var stream = new AuthorizedReadStream(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 65536, FileOptions.Asynchronous), async () => {
                var now = DateTimeOffset.UtcNow;
                if (!await db.Sessions.AsNoTracking().AnyAsync(x => x.Id == sessionId && x.ExpiresAt > now) || !await db.Users.AsNoTracking().AnyAsync(x => x.Id == userId && !x.Disabled && !x.MustChangePassword)) return false;
                return vault == null || await db.VaultSessions.AsNoTracking().AnyAsync(x => x.Id == vault.Id && x.ExpiresAt > now && x.CredentialVersion == db.Users.Where(u => u.Id == userId).Select(u => u.TotpVersion).Single());
            });
            return Results.File(stream, file.MimeType, lastModified: file.UpdatedAt, entityTag: new EntityTagHeaderValue('"' + file.Id.ToString("N") + '"'), enableRangeProcessing: true);
        });
        routes.MapPatch("/files/{id:guid}", async (Guid id, System.Text.Json.JsonElement input, Access a, AppDb db, StorageService storage, DtoService dto) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage"); var f = await storage.FileAsync(id); await a.SpaceAsync(f.Space); Validation.Require(f.TrashedAt == null, "Файл в корзине.", 409);
            if (input.TryGetProperty("name", out var name)) f.Name = Validation.FileName(name.GetString());
            if (input.TryGetProperty("folderId", out var folder)) { var folderIdValue = JsonInput.NullableGuid(folder); await storage.FolderAsync(folderIdValue, f.Space); f.FolderId = folderIdValue; }
            f.UpdatedAt = DateTimeOffset.UtcNow; if (f.Space == "shared") { db.Log(a.User.Id, "Изменил(а) файл «" + f.Name + "»"); db.Changed("files", id); }
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(await dto.FileAsync(f));
        });
        routes.MapMethods("/files/{id:guid}/favorite", ["PUT", "DELETE"], async (Guid id, HttpContext c, Access a, AppDb db, StorageService storage) => {
            var f = await storage.FileAsync(id); await a.SpaceAsync(f.Space); Validation.Require(f.TrashedAt == null, "Файл в корзине.", 409);
            if (HttpMethods.IsPut(c.Request.Method)) await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Favorites\" (\"UserId\",\"FileId\") VALUES ({a.User.Id},{id}) ON CONFLICT DO NOTHING");
            else await db.Favorites.Where(x => x.UserId == a.User.Id && x.FileId == id).ExecuteDeleteAsync();
            if (f.Space == "shared") { db.Changed("files", id, a.User.Id); await db.SaveChangesAsync(); } return Results.NoContent();
        });
        routes.MapDelete("/files/{id:guid}", async (Guid id, Access a, AppDb db, StorageService storage) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage"); var f = await storage.FileAsync(id); await a.SpaceAsync(f.Space);
            if (f.TrashedAt == null) { f.TrashedAt = DateTimeOffset.UtcNow; f.UpdatedAt = DateTimeOffset.UtcNow; if (f.Space == "shared") { db.Log(a.User.Id, "Переместил(а) в корзину «" + f.Name + "»"); db.Changed("files", id); db.Changed("posts"); db.Changed("albums"); } await db.SaveChangesAsync(); }
            await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapPost("/files/{id:guid}/restore", async (Guid id, Access a, AppDb db, StorageService storage, DtoService dto) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage"); var f = await storage.FileAsync(id); await a.SpaceAsync(f.Space);
            if (f.TrashedAt != null) { Validation.Require(f.TrashedAt >= DateTimeOffset.UtcNow.AddDays(-30), "Срок восстановления истёк.", 410); f.TrashedAt = null; f.UpdatedAt = DateTimeOffset.UtcNow; if (f.Space == "shared") { db.Log(a.User.Id, "Восстановил(а) файл «" + f.Name + "»"); db.Changed("files", id); db.Changed("posts"); db.Changed("albums"); } await db.SaveChangesAsync(); }
            await tx.CommitAsync(); return Results.Ok(await dto.FileAsync(f));
        });
        routes.MapGet("/activity", async (Access a, AppDb db) => { a.Partner(); return Results.Ok(await (from e in db.Activity join u in db.Users on e.ActorId equals u.Id orderby e.CreatedAt descending select new { e.Id, actorName = u.DisplayName, e.Text, e.CreatedAt }).Take(200).ToListAsync()); });
        routes.MapGet("/storage", async (Access a, AppDb db) => { a.Partner(); return Results.Ok(new { usedBytes = await db.Files.Where(x => x.Space == "shared").SumAsync(x => (long?)x.Size) ?? 0, quotaBytes = (await db.Pair.SingleAsync()).QuotaBytes, fileCount = await db.Files.CountAsync(x => x.Space == "shared" && x.TrashedAt == null) }); });
        MapAlbums(routes);
    }
    private static void MapAlbums(RouteGroupBuilder routes)
    {
        routes.MapGet("/albums", async (Access a, AppDb db) => {
            a.Partner(); var albums = await db.Albums.OrderBy(x => x.Name).ToListAsync(); var links = await (from l in db.AlbumFiles join f in db.Files on l.FileId equals f.Id where f.TrashedAt == null && f.Space == "shared" orderby l.Position select new { l.AlbumId, l.FileId, f.MimeType }).ToListAsync();
            return Results.Ok(albums.Select(x => new { x.Id, x.Name, fileIds = links.Where(l => l.AlbumId == x.Id).Select(l => l.FileId).ToArray(), coverUrl = links.FirstOrDefault(l => l.AlbumId == x.Id && l.MimeType.StartsWith("image/")) is { } cover ? $"/api/v1/files/{cover.FileId}/content" : null }));
        });
        routes.MapPost("/albums", async (AlbumInput input, Access a, AppDb db, StorageService storage) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage"); await storage.ValidateSharedFilesAsync(input.FileIds);
            var album = new Album { Name = Validation.Text(input.Name, "название альбома", 120) }; db.Albums.Add(album);
            foreach (var (id, i) in (input.FileIds ?? []).Select((id, i) => (id, i))) db.AlbumFiles.Add(new AlbumFile { AlbumId = album.Id, FileId = id, Position = i });
            db.Log(a.User.Id, "Создал(а) альбом «" + album.Name + "»"); db.Changed("albums", album.Id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { album.Id, album.Name, fileIds = input.FileIds ?? [] });
        });
        routes.MapPatch("/albums/{id:guid}", async (Guid id, AlbumInput input, Access a, AppDb db, StorageService storage) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("storage"); var album = await db.Albums.FindAsync(id) ?? throw new ApiException(404, "Альбом не найден.");
            if (input.Name != null) album.Name = Validation.Text(input.Name, "название альбома", 120);
            if (input.FileIds != null) { await storage.ValidateSharedFilesAsync(input.FileIds); await db.AlbumFiles.Where(x => x.AlbumId == id).ExecuteDeleteAsync(); foreach (var (fileId, i) in input.FileIds.Select((fileId, i) => (fileId, i))) db.AlbumFiles.Add(new AlbumFile { AlbumId = id, FileId = fileId, Position = i }); }
            db.Log(a.User.Id, "Изменил(а) альбом «" + album.Name + "»"); db.Changed("albums", id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { album.Id, album.Name, fileIds = await db.AlbumFiles.Where(x => x.AlbumId == id).OrderBy(x => x.Position).Select(x => x.FileId).ToArrayAsync() });
        });
        routes.MapDelete("/albums/{id:guid}", async (Guid id, Access a, AppDb db) => { a.Partner(); var album = await db.Albums.FindAsync(id) ?? throw new ApiException(404, "Альбом не найден."); db.Albums.Remove(album); db.Log(a.User.Id, "Удалил(а) альбом «" + album.Name + "»"); db.Changed("albums", id); await db.SaveChangesAsync(); return Results.NoContent(); });
    }
}
public sealed record FolderInput(string Name, Guid? ParentId, string? Space);
public sealed record EnvelopeInput(string Name, Guid? ParentId, Guid[]? FileIds);
public sealed record AlbumInput(string? Name, Guid[]? FileIds);
public static class JsonInput
{
    public static Guid? NullableGuid(System.Text.Json.JsonElement element)
    {
        if (element.ValueKind == System.Text.Json.JsonValueKind.Null || element.ValueKind == System.Text.Json.JsonValueKind.String && string.IsNullOrEmpty(element.GetString())) return null;
        Validation.Require(element.ValueKind == System.Text.Json.JsonValueKind.String && Guid.TryParse(element.GetString(), out _), "Некорректный ID."); return Guid.Parse(element.GetString()!);
    }
}
