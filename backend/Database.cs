using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;

namespace LoveCloud;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<UserAccount> Users => Set<UserAccount>();
    public DbSet<AuthSession> Sessions => Set<AuthSession>();
    public DbSet<VaultSession> VaultSessions => Set<VaultSession>();
    public DbSet<RecoveryCode> RecoveryCodes => Set<RecoveryCode>();
    public DbSet<AuthThrottle> Throttles => Set<AuthThrottle>();
    public DbSet<PairSettings> Pair => Set<PairSettings>();
    public DbSet<Folder> Folders => Set<Folder>();
    public DbSet<StoredFile> Files => Set<StoredFile>();
    public DbSet<FileFavorite> Favorites => Set<FileFavorite>();
    public DbSet<FileRecent> Recent => Set<FileRecent>();
    public DbSet<Album> Albums => Set<Album>();
    public DbSet<AlbumFile> AlbumFiles => Set<AlbumFile>();
    public DbSet<FeedPost> Posts => Set<FeedPost>();
    public DbSet<PostFile> PostFiles => Set<PostFile>();
    public DbSet<PostHeart> Hearts => Set<PostHeart>();
    public DbSet<PlannerTask> Tasks => Set<PlannerTask>();
    public DbSet<Wish> Wishes => Set<Wish>();
    public DbSet<GiftReservation> Reservations => Set<GiftReservation>();
    public DbSet<ActivityEvent> Activity => Set<ActivityEvent>();
    public DbSet<OutboxEvent> Outbox => Set<OutboxEvent>();
    public DbSet<SetupState> Setup => Set<SetupState>();
    public DbSet<SetupSession> SetupSessions => Set<SetupSession>();
    public DbSet<AvatarImage> Avatars => Set<AvatarImage>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<UserAccount>().ToTable("Users", t => {
            t.HasCheckConstraint("CK_User_Slots", "\"Slot\" BETWEEN 1 AND 3");
            t.HasCheckConstraint("CK_User_RoleSlot", "(\"Slot\" = 1 AND \"Role\" = 'admin') OR (\"Slot\" IN (2,3) AND \"Role\" = 'partner')");
        });
        b.Entity<UserAccount>().HasIndex(x => x.Slot).IsUnique();
        b.Entity<UserAccount>().HasIndex(x => x.NormalizedUsername).IsUnique();
        b.Entity<UserAccount>().Property(x => x.Username).HasMaxLength(64);
        b.Entity<UserAccount>().Property(x => x.NormalizedUsername).HasMaxLength(64);
        b.Entity<UserAccount>().Property(x => x.DisplayName).HasMaxLength(120);
        b.Entity<UserAccount>().HasOne<AvatarImage>().WithMany().HasForeignKey(x => x.AvatarId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<AuthSession>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<AuthSession>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<VaultSession>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<VaultSession>().HasOne<AuthSession>().WithMany().HasForeignKey(x => x.AuthSessionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<VaultSession>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<RecoveryCode>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<RecoveryCode>().HasIndex(x => new { x.UserId, x.Hash }).IsUnique();
        b.Entity<AuthThrottle>().HasKey(x => x.Key);
        b.Entity<PairSettings>().ToTable("PairSettings", t => t.HasCheckConstraint("CK_Pair_Singleton", "\"Id\" = 1"));
        b.Entity<PairSettings>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<PairSettings>().Property(x => x.Locale).HasDefaultValue("ru");
        b.Entity<PairSettings>().Property(x => x.Theme).HasDefaultValue("berry");
        b.Entity<PairSettings>().ToTable("PairSettings", t => {
            t.HasCheckConstraint("CK_Pair_Locale", "\"Locale\" IN ('ru','en')");
            t.HasCheckConstraint("CK_Pair_Theme", "\"Theme\" IN ('berry','rose','cloud')");
        });
        b.Entity<PairSettings>().HasOne<AvatarImage>().WithMany().HasForeignKey(x => x.AvatarId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<SetupState>().ToTable("SetupState", t => {
            t.HasCheckConstraint("CK_Setup_Singleton", "\"Id\" = 1");
            t.HasCheckConstraint("CK_Setup_Completed", "NOT \"Completed\" OR (\"TokenHash\" IS NULL AND \"ClaimSessionId\" IS NULL)");
        });
        b.Entity<SetupState>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<SetupState>().HasOne<SetupSession>().WithMany().HasForeignKey(x => x.ClaimSessionId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<SetupSession>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<AvatarImage>().HasOne<SetupSession>().WithMany().HasForeignKey(x => x.PendingSessionId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<AvatarImage>().HasIndex(x => x.BlobKey).IsUnique();
        b.Entity<AvatarImage>().ToTable("Avatars", t => t.HasCheckConstraint("CK_Avatar_Ready", "NOT \"Ready\" OR \"PendingSessionId\" IS NULL"));
        b.Entity<Folder>().ToTable("Folders", t => t.HasCheckConstraint("CK_Folder_Space", "\"Space\" IN ('shared','vault')"));
        b.Entity<Folder>().HasAlternateKey(x => new { x.Id, x.Space });
        b.Entity<Folder>().HasOne<Folder>().WithMany().HasForeignKey(x => new { x.ParentId, x.Space }).HasPrincipalKey(x => new { x.Id, x.Space }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Folder>().HasIndex(x => new { x.Space, x.ParentId, x.NormalizedName }).IsUnique().AreNullsDistinct(false);
        b.Entity<StoredFile>().ToTable("Files", t => {
            t.HasCheckConstraint("CK_File_Space", "\"Space\" IN ('shared','vault')");
            t.HasCheckConstraint("CK_File_Size", "\"Size\" >= 0");
        });
        b.Entity<StoredFile>().HasOne<Folder>().WithMany().HasForeignKey(x => new { x.FolderId, x.Space }).HasPrincipalKey(x => new { x.Id, x.Space }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StoredFile>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StoredFile>().HasIndex(x => new { x.Space, x.FolderId, x.CreatedAt });
        b.Entity<FileFavorite>().HasKey(x => new { x.UserId, x.FileId });
        b.Entity<FileFavorite>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<FileFavorite>().HasOne<StoredFile>().WithMany().HasForeignKey(x => x.FileId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<FileRecent>().HasKey(x => new { x.UserId, x.FileId });
        b.Entity<FileRecent>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<FileRecent>().HasOne<StoredFile>().WithMany().HasForeignKey(x => x.FileId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<AlbumFile>().HasKey(x => new { x.AlbumId, x.FileId });
        b.Entity<AlbumFile>().HasOne<Album>().WithMany().HasForeignKey(x => x.AlbumId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<AlbumFile>().HasOne<StoredFile>().WithMany().HasForeignKey(x => x.FileId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FeedPost>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FeedPost>().HasOne<FeedPost>().WithMany().HasForeignKey(x => x.RootId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FeedPost>().HasIndex(x => new { x.AuthorId, x.ClientPostId }).IsUnique();
        b.Entity<FeedPost>().HasIndex(x => x.Sequence).IsUnique();
        b.Entity<FeedPost>().HasIndex(x => new { x.RootId, x.Sequence });
        b.Entity<FeedPost>().ToTable("Posts", t => t.HasCheckConstraint("CK_Post_KindRoot", "(\"Kind\" IN ('message','memory') AND \"RootId\" IS NULL) OR (\"Kind\" = 'reply' AND \"RootId\" IS NOT NULL)"));
        b.Entity<PostFile>().HasKey(x => new { x.PostId, x.FileId });
        b.Entity<PostFile>().HasOne<FeedPost>().WithMany().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PostFile>().HasOne<StoredFile>().WithMany().HasForeignKey(x => x.FileId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PostHeart>().HasKey(x => new { x.PostId, x.UserId });
        b.Entity<PostHeart>().HasOne<FeedPost>().WithMany().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PostHeart>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PlannerTask>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.AssigneeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PlannerTask>().HasIndex(x => x.PreviousOccurrenceId).IsUnique();
        b.Entity<PlannerTask>().ToTable("Tasks", t => {
            t.HasCheckConstraint("CK_Task_Status", "\"Status\" IN ('todo','doing','done')");
            t.HasCheckConstraint("CK_Task_Priority", "\"Priority\" IN ('low','normal','high')");
            t.HasCheckConstraint("CK_Task_Repeat", "\"Repeat\" IN ('none','daily','weekly','monthly')");
        });
        b.Entity<Wish>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Wish>().Property(x => x.Price).HasPrecision(14, 2);
        b.Entity<Wish>().ToTable("Wishes", t => t.HasCheckConstraint("CK_Wish_Price", "\"Price\" IS NULL OR \"Price\" >= 0"));
        b.Entity<GiftReservation>().HasKey(x => x.WishId);
        b.Entity<GiftReservation>().HasOne<Wish>().WithMany().HasForeignKey(x => x.WishId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GiftReservation>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GiftReservation>().ToTable("Reservations", t => t.HasCheckConstraint("CK_Reservation_Status", "\"Status\" IN ('reserved','bought')"));
        b.Entity<ActivityEvent>().HasOne<UserAccount>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ActivityEvent>().HasIndex(x => x.CreatedAt);
    }

    public Task LockAsync(string key) => Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key},0))");
    public void Changed(string area, Guid? id = null, Guid? userId = null) => Outbox.Add(new OutboxEvent { Area = area, EntityId = id, UserId = userId });
    public void Log(Guid actorId, string text) => Activity.Add(new ActivityEvent { ActorId = actorId, Text = text });
}

public static class Bootstrap
{
    public static async Task InitializeAsync(IServiceProvider services, IConfiguration config)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        await db.Database.MigrateAsync();
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.LockAsync("bootstrap");
        await db.LockAsync("setup");
        if (!await db.Pair.AnyAsync()) db.Pair.Add(new PairSettings());
        if (!await db.Users.AnyAsync(x => x.Slot == 1))
        {
            var path = config["Bootstrap:PasswordFile"] ?? "/run/secrets/bootstrap_password";
            if (!File.Exists(path)) throw new InvalidOperationException("Bootstrap password secret file is required for the first installation.");
            var password = (await File.ReadAllTextAsync(path)).TrimEnd('\r', '\n');
            Validation.Password(password);
            var admin = new UserAccount { Slot = 1, Role = "admin", Username = "admin", NormalizedUsername = "ADMIN", DisplayName = "Администратор" };
            admin.PasswordHash = new PasswordHasher<UserAccount>().HashPassword(admin, password);
            db.Users.Add(admin);
        }
        await db.SaveChangesAsync();
        await SetupLifecycle.InitializeAsync(db, config);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
    }
}
