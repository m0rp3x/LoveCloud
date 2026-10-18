using System.Collections.Concurrent;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public sealed class Connections
{
    private readonly ConcurrentDictionary<string, (Guid SessionId, Guid UserId, Action Abort)> entries = new();
    public void Add(string id, Guid session, Guid user, Action abort) => entries[id] = (session, user, abort);
    public void Remove(string id) => entries.TryRemove(id, out _);
    public void RevokeSession(Guid session) { foreach (var entry in entries.Where(x => x.Value.SessionId == session)) entry.Value.Abort(); }
    public void RevokeUser(Guid user) { foreach (var entry in entries.Where(x => x.Value.UserId == user)) entry.Value.Abort(); }
    public async Task ValidateAsync(AppDb db)
    {
        var snapshot = entries.ToArray();
        if (snapshot.Length == 0) return;
        var ids = snapshot.Select(x => x.Value.SessionId).Distinct().ToArray();
        var valid = await (from s in db.Sessions join u in db.Users on s.UserId equals u.Id where ids.Contains(s.Id) && s.ExpiresAt > DateTimeOffset.UtcNow && !u.Disabled && !u.MustChangePassword select s.Id).ToListAsync();
        foreach (var entry in snapshot.Where(x => !valid.Contains(x.Value.SessionId))) entry.Value.Abort();
    }
}
[Authorize(Roles = "partner")]
public sealed class WorkspaceHub(Connections connections) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var http = Context.GetHttpContext()!;
        var user = (UserAccount)http.Items["user"]!;
        var session = (AuthSession)http.Items["session"]!;
        if (user.MustChangePassword) { Context.Abort(); return; }
        connections.Add(Context.ConnectionId, session.Id, user.Id, Context.Abort);
        await Groups.AddToGroupAsync(Context.ConnectionId, "pair");
        await Groups.AddToGroupAsync(Context.ConnectionId, "user:" + user.Id);
        await base.OnConnectedAsync();
    }
    public override Task OnDisconnectedAsync(Exception? exception) { connections.Remove(Context.ConnectionId); return base.OnDisconnectedAsync(exception); }
}
public sealed class OutboxWorker(IServiceScopeFactory scopes, IHubContext<WorkspaceHub> hub, Connections connections, ILogger<OutboxWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await connections.ValidateAsync(db);
                var batch = await db.Outbox.OrderBy(x => x.Id).Take(100).ToListAsync(stoppingToken);
                foreach (var item in batch)
                {
                    await hub.Clients.Group(item.UserId.HasValue ? "user:" + item.UserId : "pair")
                        .SendAsync("WorkspaceChanged", new { area = item.Area, id = item.EntityId }, stoppingToken);
                    db.Outbox.Remove(item);
                }
                if (batch.Count > 0) await db.SaveChangesAsync(stoppingToken);
                await scope.ServiceProvider.GetRequiredService<StorageService>().CleanupAsync(stoppingToken);
                await scope.ServiceProvider.GetRequiredService<AvatarService>().CleanupAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogWarning("Background retry ({ErrorType}).", e.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }
}
