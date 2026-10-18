using System.Buffers;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace LoveCloud;

public sealed class StorageService(AppDb db, IConfiguration config)
{
    public const long MaxFileBytes = 5L * 1024 * 1024 * 1024;
    public string Root => Path.GetFullPath(config["Storage:Root"] ?? "/data/files");
    public string BlobPath(StoredFile file) => Path.Combine(Root, file.Space, file.BlobKey);
    public async Task<Folder?> FolderAsync(Guid? id, string space)
    {
        if (id == null) return null;
        return await db.Folders.FirstOrDefaultAsync(x => x.Id == id && x.Space == space) ?? throw new ApiException(404, "Папка не найдена.");
    }
    public async Task<StoredFile> FileAsync(Guid id) => await db.Files.FindAsync(id) ?? throw new ApiException(404, "Файл не найден.");
    public async Task ValidateSharedFilesAsync(Guid[]? ids)
    {
        ids ??= [];
        Validation.Require(ids.Length <= 100 && ids.Distinct().Count() == ids.Length, "Недопустимый набор файлов.");
        var count = await db.Files.CountAsync(x => ids.Contains(x.Id) && x.Space == "shared" && x.TrashedAt == null);
        Validation.Require(count == ids.Length, "Некоторые файлы недоступны.", 404);
    }
    public async Task<StoredFile> UploadAsync(HttpContext context, Access access)
    {
        access.Partner();
        Validation.Require(MediaTypeHeaderValue.TryParse(context.Request.ContentType, out var contentType) && contentType.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase), "Ожидается multipart/form-data.", 415);
        var boundary = HeaderUtilities.RemoveQuotes(contentType!.Boundary).Value;
        Validation.Require(!string.IsNullOrWhiteSpace(boundary) && boundary.Length <= 128, "Некорректная multipart boundary.");
        var reader = new MultipartReader(boundary!, context.Request.Body) { BodyLengthLimit = MaxFileBytes + 65536, HeadersLengthLimit = 16384 };
        var staging = Path.Combine(Root, "staging"); Directory.CreateDirectory(staging);
        var temp = Path.Combine(staging, Guid.NewGuid().ToString("N"));
        string? name = null; string? folderValue = null; var spaceValue = "shared"; long size = 0; string? finalPath = null;
        var cancellation = context.RequestAborted;
        try
        {
            MultipartSection? section;
            while ((section = await reader.ReadNextSectionAsync(cancellation)) != null)
            {
                Validation.Require(ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition), "Некорректная multipart секция.");
                var field = HeaderUtilities.RemoveQuotes(disposition!.Name).Value;
                if (disposition.FileName.HasValue || disposition.FileNameStar.HasValue)
                {
                    Validation.Require(field == "file" && name == null, "Ожидается ровно один файл в поле file.");
                    name = Validation.FileName(HeaderUtilities.RemoveQuotes(disposition.FileNameStar.HasValue ? disposition.FileNameStar : disposition.FileName).Value);
                    await using var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous);
                    var buffer = ArrayPool<byte>.Shared.Rent(65536);
                    try
                    {
                        int read;
                        while ((read = await section.Body.ReadAsync(buffer.AsMemory(0, 65536), cancellation)) > 0)
                        {
                            size += read;
                            Validation.Require(size <= MaxFileBytes, "Файл больше 5 GiB.", 413);
                            if (size % (8 * 1024 * 1024) < read)
                                Validation.Require(new DriveInfo(Path.GetPathRoot(temp)!).AvailableFreeSpace > 128L * 1024 * 1024, "Недостаточно места на диске.", 507);
                            await output.WriteAsync(buffer.AsMemory(0, read), cancellation);
                        }
                    }
                    finally { ArrayPool<byte>.Shared.Return(buffer); }
                }
                else
                {
                    using var textReader = new StreamReader(section.Body);
                    var chars = new char[1025]; var count = await textReader.ReadBlockAsync(chars.AsMemory(), cancellation);
                    Validation.Require(count <= 1024, "Слишком длинное поле multipart.");
                    var value = new string(chars, 0, count);
                    if (field == "folderId") folderValue = value;
                    else if (field == "space") spaceValue = value;
                    else throw new ApiException(400, "Неизвестное поле multipart.");
                }
            }
            Validation.Require(name != null, "Файл не передан.");
            var space = Validation.Space(spaceValue); await access.SpaceAsync(space);
            Guid? folderId = null;
            if (!string.IsNullOrWhiteSpace(folderValue)) { Validation.Require(Guid.TryParse(folderValue, out _), "Некорректный folderId."); folderId = Guid.Parse(folderValue); }
            await using var tx = await db.Database.BeginTransactionAsync(cancellation); await db.LockAsync("storage");
            await FolderAsync(folderId, space);
            var quota = (await db.Pair.SingleAsync(cancellation)).QuotaBytes;
            var used = await db.Files.SumAsync(x => (long?)x.Size, cancellation) ?? 0;
            Validation.Require(used + size <= quota, "Превышена квота хранилища.", 413);
            if (space == "vault")
            { var vaultUsed = await db.Files.Where(x => x.Space == "vault").SumAsync(x => (long?)x.Size, cancellation) ?? 0; Validation.Require(vaultUsed + size <= 20L * 1024 * 1024 * 1024, "Превышена квота приватного хранилища.", 413); }
            var file = new StoredFile { Name = name!, FolderId = folderId, Space = space, OwnerId = access.User.Id, Size = size, BlobKey = Guid.NewGuid().ToString("N"), MimeType = await MimeAsync(temp, name!) };
            finalPath = BlobPath(file); Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!); File.Move(temp, finalPath);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(finalPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            db.Files.Add(file);
            if (space == "shared") { db.Log(access.User.Id, "Загрузил(а) файл «" + file.Name + "»"); db.Changed("files", file.Id); }
            await db.SaveChangesAsync(cancellation); await tx.CommitAsync(cancellation);
            finalPath = null; return file;
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
            // A commit response can be lost after PostgreSQL committed. Never erase a
            // renamed blob on an ambiguous failure; reconciliation removes true orphans.
        }
    }
    private static async Task<string> MimeAsync(string path, string name)
    {
        var bytes = new byte[32]; await using var stream = File.OpenRead(path); var n = await stream.ReadAsync(bytes);
        if (n >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (n >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255) return "image/jpeg";
        if (n >= 6 && System.Text.Encoding.ASCII.GetString(bytes, 0, 6) is "GIF87a" or "GIF89a") return "image/gif";
        if (n >= 12 && System.Text.Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && System.Text.Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP") return "image/webp";
        if (n >= 12 && System.Text.Encoding.ASCII.GetString(bytes, 4, 4) == "ftyp") return "video/mp4";
        if (n >= 4 && bytes.AsSpan(0, 4).SequenceEqual(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 })) return Path.GetExtension(name).Equals(".webm", StringComparison.OrdinalIgnoreCase) ? "video/webm" : "application/octet-stream";
        if (n >= 5 && System.Text.Encoding.ASCII.GetString(bytes, 0, 5) == "%PDF-") return "application/pdf";
        if (Path.GetExtension(name).Equals(".txt", StringComparison.OrdinalIgnoreCase) && !bytes.AsSpan(0, n).Contains((byte)0)) return "text/plain";
        return "application/octet-stream";
    }
    private static DateTimeOffset nextCleanup = DateTimeOffset.MinValue;
    public async Task CleanupAsync(CancellationToken cancellation)
    {
        if (DateTimeOffset.UtcNow < nextCleanup) return;
        nextCleanup = DateTimeOffset.UtcNow.AddMinutes(10);
        var now = DateTimeOffset.UtcNow;
        await db.Sessions.Where(x => x.ExpiresAt < now).ExecuteDeleteAsync(cancellation);
        await db.VaultSessions.Where(x => x.ExpiresAt < now).ExecuteDeleteAsync(cancellation);
        await db.Activity.Where(x => x.CreatedAt < now.AddDays(-90)).ExecuteDeleteAsync(cancellation);
        await db.Recent.Where(x => x.OpenedAt < now.AddDays(-90)).ExecuteDeleteAsync(cancellation);
        await db.Throttles.Where(x => x.WindowStart < now.AddDays(-2) && (x.BlockedUntil == null || x.BlockedUntil < now)).ExecuteDeleteAsync(cancellation);
        await using var tx = await db.Database.BeginTransactionAsync(cancellation); await db.LockAsync("storage");
        var expired = await db.Files.Where(x => x.TrashedAt < now.AddDays(-30)).Take(100).ToListAsync(cancellation);
        foreach (var file in expired)
        {
            await db.PostFiles.Where(x => x.FileId == file.Id).ExecuteDeleteAsync(cancellation);
            await db.AlbumFiles.Where(x => x.FileId == file.Id).ExecuteDeleteAsync(cancellation);
            var path = BlobPath(file); if (File.Exists(path)) File.Delete(path); db.Files.Remove(file);
        }
        await db.SaveChangesAsync(cancellation); await tx.CommitAsync(cancellation);
        var staging = Path.Combine(Root, "staging");
        if (Directory.Exists(staging)) foreach (var path in Directory.EnumerateFiles(staging))
            if (File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddDays(-1)) File.Delete(path);
        // A crash after rename and before DB commit leaves an unreferenced UUID blob.
        foreach (var space in new[] { "shared", "vault" })
        {
            var folder = Path.Combine(Root, space); if (!Directory.Exists(folder)) continue;
            var keys = (await db.Files.Where(x => x.Space == space).Select(x => x.BlobKey).ToListAsync(cancellation)).ToHashSet();
            foreach (var path in Directory.EnumerateFiles(folder))
                if (File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddDays(-1) && !keys.Contains(Path.GetFileName(path))) File.Delete(path);
        }
    }
}

public sealed class AuthorizedReadStream(Stream inner, Func<Task<bool>> authorized) : Stream
{
    private DateTimeOffset lastCheck = DateTimeOffset.MinValue;
    public override bool CanRead => inner.CanRead; public override bool CanSeek => inner.CanSeek; public override bool CanWrite => false;
    public override long Length => inner.Length; public override long Position { get => inner.Position; set => inner.Position = value; }
    public override void Flush() => inner.Flush(); public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
    public override void SetLength(long value) => throw new NotSupportedException(); public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override int Read(byte[] buffer, int offset, int count) { CheckAsync().GetAwaiter().GetResult(); return inner.Read(buffer, offset, count); }
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) { await CheckAsync(); return await inner.ReadAsync(buffer, cancellationToken); }
    public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) { await CheckAsync(); return await inner.ReadAsync(buffer.AsMemory(offset, count), cancellationToken); }
    private async Task CheckAsync()
    {
        if (DateTimeOffset.UtcNow - lastCheck < TimeSpan.FromSeconds(2)) return;
        if (!await authorized()) throw new OperationCanceledException("Media authorization expired.");
        lastCheck = DateTimeOffset.UtcNow;
    }
    protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
    public override async ValueTask DisposeAsync() { await inner.DisposeAsync(); GC.SuppressFinalize(this); }
}
