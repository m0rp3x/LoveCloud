using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public static class SocialEndpoints
{
    private sealed record FeedCursor(string Kind, long Upper, long Last);
    public static void MapSocial(this WebApplication app)
    {
        var routes = app.MapGroup("/api/v1").RequireAuthorization();
        routes.MapGet("/feed", async (string? kind, string? cursor, int? limit, Access a, AppDb db, DtoService dto, IDataProtectionProvider protection) => {
            a.Partner(); kind = Validation.Choice(kind ?? "all", ["all", "message", "memory"], "kind"); var take = Math.Clamp(limit ?? 20, 1, 100);
            var protector = protection.CreateProtector("LoveCloud.FeedCursor.v1");
            var boundary = new FeedCursor(kind, (await db.Pair.SingleAsync()).PostSequence, long.MaxValue);
            if (!string.IsNullOrEmpty(cursor))
            {
                try { boundary = JsonSerializer.Deserialize<FeedCursor>(protector.Unprotect(cursor)) ?? throw new InvalidOperationException(); }
                catch { throw new ApiException(400, "Недействительный курсор ленты."); }
                Validation.Require(boundary.Kind == kind, "Курсор относится к другому фильтру.");
            }
            var query = db.Posts.Where(x => x.RootId == null && x.DeletedAt == null && x.Sequence <= boundary.Upper && x.Sequence < boundary.Last);
            if (kind != "all") query = query.Where(x => x.Kind == kind);
            // Pins are metadata; timeline order stays stable across concurrent pin changes.
            var posts = await query.OrderByDescending(x => x.Sequence).Take(take + 1).ToListAsync();
            var more = posts.Count > take; if (more) posts.RemoveAt(take);
            var next = more ? protector.Protect(JsonSerializer.Serialize(new FeedCursor(kind, boundary.Upper, posts[^1].Sequence))) : null;
            return Results.Ok(new { items = await dto.PostsAsync(posts), nextCursor = next });
        });
        routes.MapPost("/posts", async (PostInput input, Access a, AppDb db, DtoService dto, StorageService storage) => {
            a.Partner(); var kind = Validation.Choice(input.Kind, ["message", "memory"], "kind"); var body = Validation.Body(input.Body); var files = input.FileIds ?? [];
            Validation.Require(files.Length <= 10 && (body.Length > 0 || files.Length > 0), "Добавьте текст или до 10 файлов.");
            return Results.Ok(await CreatePost(a, db, dto, storage, kind, body, files, null, input.ClientPostId));
        });
        routes.MapGet("/posts/{id:guid}/replies", async (Guid id, Access a, AppDb db, DtoService dto) => {
            a.Partner(); Validation.Require(await db.Posts.AnyAsync(x => x.Id == id && x.RootId == null), "Публикация не найдена.", 404);
            return Results.Ok(await dto.PostsAsync(await db.Posts.Where(x => x.RootId == id && x.DeletedAt == null).OrderBy(x => x.Sequence).ToListAsync()));
        });
        routes.MapPost("/posts/{id:guid}/replies", async (Guid id, ReplyInput input, Access a, AppDb db, DtoService dto, StorageService storage) => {
            a.Partner(); var body = Validation.Body(input.Body); Validation.Require(body.Length > 0, "Напишите ответ.");
            return Results.Ok(await CreatePost(a, db, dto, storage, "reply", body, [], id, input.ClientPostId));
        });
        routes.MapPatch("/posts/{id:guid}", async (Guid id, JsonElement input, Access a, AppDb db, DtoService dto) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("posts");
            var p = await db.Posts.FindAsync(id) ?? throw new ApiException(404, "Публикация не найдена."); Validation.Require(p.DeletedAt == null, "Публикация удалена.", 404);
            if (input.TryGetProperty("body", out var text)) { Validation.Require(p.AuthorId == a.User.Id, "Редактировать текст может только автор.", 403); p.Body = Validation.Body(text.GetString()); Validation.Require(p.Body.Length > 0 || await db.PostFiles.AnyAsync(x => x.PostId == id), "Публикация не может быть пустой."); p.EditedAt = DateTimeOffset.UtcNow; }
            if (input.TryGetProperty("pinned", out var pin))
            {
                Validation.Require(p.RootId == null && pin.ValueKind is JsonValueKind.True or JsonValueKind.False, "Ответы нельзя закрепить.");
                if (pin.GetBoolean() && !p.Pinned) Validation.Require(await db.Posts.CountAsync(x => x.Pinned && x.DeletedAt == null) < 3, "Можно закрепить не более трёх публикаций.", 409);
                p.Pinned = pin.GetBoolean();
            }
            db.Changed("posts", id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(await dto.PostAsync(p));
        });
        routes.MapDelete("/posts/{id:guid}", async (Guid id, Access a, AppDb db) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("posts");
            var p = await db.Posts.FindAsync(id) ?? throw new ApiException(404, "Публикация не найдена."); Validation.Require(p.AuthorId == a.User.Id, "Удалить может только автор.", 403);
            if (p.DeletedAt == null) { p.DeletedAt = DateTimeOffset.UtcNow; p.Body = ""; p.Pinned = false; await db.PostFiles.Where(x => x.PostId == id).ExecuteDeleteAsync(); db.Changed("posts", id); await db.SaveChangesAsync(); }
            await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapMethods("/posts/{id:guid}/heart", ["PUT", "DELETE"], async (Guid id, HttpContext c, Access a, AppDb db) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("posts");
            Validation.Require(await db.Posts.AnyAsync(x => x.Id == id && x.DeletedAt == null), "Публикация не найдена.", 404);
            var liked = HttpMethods.IsPut(c.Request.Method);
            if (liked) await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Hearts\" (\"PostId\",\"UserId\") VALUES ({id},{a.User.Id}) ON CONFLICT DO NOTHING");
            else await db.Hearts.Where(x => x.PostId == id && x.UserId == a.User.Id).ExecuteDeleteAsync();
            db.Changed("posts", id); await db.SaveChangesAsync(); var count = await db.Hearts.CountAsync(x => x.PostId == id); await tx.CommitAsync(); return Results.Ok(new { liked, heartCount = count });
        });
    }
    private static async Task<object> CreatePost(Access a, AppDb db, DtoService dto, StorageService storage, string kind, string body, Guid[] files, Guid? root, string? clientId)
    {
        if (clientId != null) clientId = Validation.Text(clientId, "clientPostId", 100);
        var hash = Tokens.Hash(JsonSerializer.Serialize(new { kind, body, files, root }));
        await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("posts"); await db.LockAsync("storage");
        if (clientId != null)
        {
            var existing = await db.Posts.FirstOrDefaultAsync(x => x.AuthorId == a.User.Id && x.ClientPostId == clientId);
            if (existing != null) { Validation.Require(existing.RequestHash == hash, "clientPostId уже использован для другого содержимого.", 409); await tx.CommitAsync(); return await dto.PostAsync(existing); }
        }
        if (root.HasValue) Validation.Require(await db.Posts.AnyAsync(x => x.Id == root && x.RootId == null && x.DeletedAt == null), "Исходная публикация не найдена.", 404);
        await storage.ValidateSharedFilesAsync(files); var pair = await db.Pair.SingleAsync(); pair.PostSequence++;
        var post = new FeedPost { Kind = kind, Body = body, AuthorId = a.User.Id, RootId = root, ClientPostId = clientId, RequestHash = hash, Sequence = pair.PostSequence };
        db.Posts.Add(post); foreach (var (fileId, i) in files.Select((fileId, i) => (fileId, i))) db.PostFiles.Add(new PostFile { PostId = post.Id, FileId = fileId, Position = i });
        db.Changed("posts", post.Id); await db.SaveChangesAsync(); await tx.CommitAsync(); return await dto.PostAsync(post);
    }
}
public sealed record PostInput(string Kind, string? Body, Guid[]? FileIds, string? ClientPostId);
public sealed record ReplyInput(string Body, string? ClientPostId);
