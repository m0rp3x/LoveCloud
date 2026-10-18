using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public sealed class DtoService(AppDb db, Access access)
{
    public async Task<object[]> FilesAsync(IEnumerable<StoredFile> source)
    {
        var files = source.ToList();
        var ids = files.Select(x => x.Id).ToArray();
        var ownerIds = files.Select(f => f.OwnerId).Distinct().ToArray();
        var owners = await db.Users.Where(x => ownerIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.DisplayName);
        var favorites = await db.Favorites.Where(x => x.UserId == access.User.Id && ids.Contains(x.FileId)).Select(x => x.FileId).ToListAsync();
        return files.Select(f => (object)new {
            f.Id, f.Name, f.FolderId, f.Space, f.MimeType, f.Size, f.CreatedAt, f.UpdatedAt,
            f.OwnerId, ownerName = owners.GetValueOrDefault(f.OwnerId, "Партнёр"), favorite = favorites.Contains(f.Id), f.TrashedAt,
            contentUrl = $"/api/v1/files/{f.Id}/content", thumbnailUrl = f.MimeType.StartsWith("image/") && f.TrashedAt == null ? $"/api/v1/files/{f.Id}/content" : null
        }).ToArray();
    }
    public async Task<object> FileAsync(StoredFile file) => (await FilesAsync([file]))[0];
    public static object Folder(Folder f) => new { f.Id, f.ParentId, f.Name, f.Space };
    public async Task<object[]> PostsAsync(IEnumerable<FeedPost> source)
    {
        var posts = source.ToList(); var ids = posts.Select(x => x.Id).ToArray();
        var authors = await db.Users.ToDictionaryAsync(x => x.Id, x => x.DisplayName);
        var avatars = await db.Users.ToDictionaryAsync(x => x.Id, x => x.AvatarId);
        var hearts = await db.Hearts.Where(x => ids.Contains(x.PostId)).ToListAsync();
        var replies = await db.Posts.Where(x => x.RootId != null && ids.Contains(x.RootId.Value) && x.DeletedAt == null).Select(x => x.RootId).ToListAsync();
        var links = await db.PostFiles.Where(x => ids.Contains(x.PostId)).OrderBy(x => x.Position).ToListAsync();
        var fileIds = links.Select(x => x.FileId).Distinct().ToArray();
        var files = await db.Files.Where(x => fileIds.Contains(x.Id) && x.TrashedAt == null && x.Space == "shared").ToListAsync();
        var fileDtos = await FilesAsync(files);
        var fileMap = files.Select((f, i) => (f.Id, Dto: fileDtos[i])).ToDictionary(x => x.Id, x => x.Dto);
        return posts.Select(p => (object)new {
            p.Id, p.Kind, body = p.DeletedAt == null ? p.Body : "Публикация удалена", p.AuthorId, authorName = authors[p.AuthorId], authorAvatarUrl = Appearance.AvatarUrl(avatars[p.AuthorId]), p.CreatedAt, p.EditedAt,
            pinned = p.DeletedAt == null && p.Pinned, liked = hearts.Any(h => h.PostId == p.Id && h.UserId == access.User.Id), heartCount = hearts.Count(h => h.PostId == p.Id), replyCount = replies.Count(r => r == p.Id),
            files = p.DeletedAt == null ? links.Where(x => x.PostId == p.Id && fileMap.ContainsKey(x.FileId)).Select(x => fileMap[x.FileId]).ToArray() : []
        }).ToArray();
    }
    public async Task<object> PostAsync(FeedPost post) => (await PostsAsync([post]))[0];
    public static object Task(PlannerTask t) => new { t.Id, t.Title, t.AssigneeId, t.DueDate, t.Priority, t.Status, t.Repeat, t.CreatedAt };
    public async Task<object[]> WishesAsync(IEnumerable<Wish> source)
    {
        var wishes = source.ToList(); var owners = await db.Users.ToDictionaryAsync(x => x.Id, x => x.DisplayName);
        var ids = wishes.Where(x => x.OwnerId != access.User.Id).Select(x => x.Id).ToArray();
        var reservations = await db.Reservations.Where(x => ids.Contains(x.WishId) && x.UserId == access.User.Id).ToDictionaryAsync(x => x.WishId, x => x.Status);
        return wishes.Select(w => {
            var dto = new Dictionary<string, object?> { ["id"] = w.Id, ["ownerId"] = w.OwnerId, ["ownerName"] = owners[w.OwnerId], ["title"] = w.Title,
                ["note"] = w.Note, ["url"] = w.Url, ["price"] = w.Price, ["currency"] = w.Currency, ["category"] = w.Category, ["priority"] = w.Priority };
            if (w.OwnerId != access.User.Id && reservations.TryGetValue(w.Id, out var state)) dto["reservation"] = state;
            return (object)dto;
        }).ToArray();
    }
}
