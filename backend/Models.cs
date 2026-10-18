namespace LoveCloud;

public sealed class UserAccount
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int Slot { get; set; }
    public string Role { get; set; } = "partner";
    public string Username { get; set; } = "";
    public string NormalizedUsername { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool MustChangePassword { get; set; } = true;
    public bool Disabled { get; set; }
    public string? TotpSecret { get; set; }
    public string? PendingTotpSecret { get; set; }
    public DateTimeOffset? PendingTotpExpires { get; set; }
    public Guid? PendingTotpSessionId { get; set; }
    public long LastTotpStep { get; set; } = -1;
    public int TotpVersion { get; set; }
    public Guid? AvatarId { get; set; }
}
public sealed class AuthSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public string CsrfToken { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RecoveryUntil { get; set; }
}
public sealed class VaultSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid AuthSessionId { get; set; }
    public string TokenHash { get; set; } = "";
    public int CredentialVersion { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
public sealed class RecoveryCode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Hash { get; set; } = "";
}
public sealed class AuthThrottle
{
    public string Key { get; set; } = "";
    public DateTimeOffset WindowStart { get; set; }
    public int Failures { get; set; }
    public DateTimeOffset? BlockedUntil { get; set; }
}
public sealed class PairSettings
{
    public int Id { get; set; } = 1;
    public string Name { get; set; } = "LoveCloud";
    public DateOnly? StartDate { get; set; }
    public string TimeZone { get; set; } = "Europe/Moscow";
    public long QuotaBytes { get; set; } = 100L * 1024 * 1024 * 1024;
    public long PostSequence { get; set; }
    public string Locale { get; set; } = "ru";
    public string Theme { get; set; } = "berry";
    public Guid? AvatarId { get; set; }
}
public sealed class SetupState
{
    public int Id { get; set; } = 1;
    public bool Completed { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? TokenHash { get; set; }
    public Guid? ClaimSessionId { get; set; }
}
public sealed class SetupSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TokenHash { get; set; } = "";
    public string CsrfToken { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}
public sealed class AvatarImage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string BlobKey { get; set; } = "";
    public Guid? PendingSessionId { get; set; }
    public bool Ready { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public sealed class Folder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = "";
    public string NormalizedName { get; set; } = "";
    public string Space { get; set; } = "shared";
}
public sealed class StoredFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? FolderId { get; set; }
    public string Space { get; set; } = "shared";
    public string Name { get; set; } = "";
    public string BlobKey { get; set; } = "";
    public string MimeType { get; set; } = "application/octet-stream";
    public long Size { get; set; }
    public Guid OwnerId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? TrashedAt { get; set; }
}
public sealed class FileFavorite { public Guid UserId { get; set; } public Guid FileId { get; set; } }
public sealed class FileRecent { public Guid UserId { get; set; } public Guid FileId { get; set; } public DateTimeOffset OpenedAt { get; set; } }
public sealed class Album
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
}
public sealed class AlbumFile { public Guid AlbumId { get; set; } public Guid FileId { get; set; } public int Position { get; set; } }
public sealed class FeedPost
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Kind { get; set; } = "message";
    public string Body { get; set; } = "";
    public Guid AuthorId { get; set; }
    public Guid? RootId { get; set; }
    public string? ClientPostId { get; set; }
    public string? RequestHash { get; set; }
    public long Sequence { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EditedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public bool Pinned { get; set; }
}
public sealed class PostFile { public Guid PostId { get; set; } public Guid FileId { get; set; } public int Position { get; set; } }
public sealed class PostHeart { public Guid PostId { get; set; } public Guid UserId { get; set; } }
public sealed class PlannerTask
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public Guid? AssigneeId { get; set; }
    public DateOnly? DueDate { get; set; }
    public string Priority { get; set; } = "normal";
    public string Status { get; set; } = "todo";
    public string Repeat { get; set; } = "none";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid? PreviousOccurrenceId { get; set; }
    public bool RecurrenceGenerated { get; set; }
}
public sealed class Wish
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public string Title { get; set; } = "";
    public string? Note { get; set; }
    public string? Url { get; set; }
    public decimal? Price { get; set; }
    public string Currency { get; set; } = "RUB";
    public string Category { get; set; } = "Другое";
    public string Priority { get; set; } = "normal";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public sealed class GiftReservation
{
    public Guid WishId { get; set; }
    public Guid UserId { get; set; }
    public string Status { get; set; } = "reserved";
}
public sealed class ActivityEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ActorId { get; set; }
    public string Text { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public sealed class OutboxEvent
{
    public long Id { get; set; }
    public string Area { get; set; } = "";
    public Guid? EntityId { get; set; }
    public Guid? UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
