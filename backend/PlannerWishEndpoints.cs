using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LoveCloud;

public static class PlannerWishEndpoints
{
    private static readonly string[] Priorities = ["low", "normal", "high"];
    public static DateOnly NextDate(DateOnly date, string repeat) => repeat switch { "daily" => date.AddDays(1), "weekly" => date.AddDays(7), "monthly" => date.AddMonths(1), _ => date };
    public static void MapPlannerWishes(this WebApplication app)
    {
        var routes = app.MapGroup("/api/v1").RequireAuthorization();
        routes.MapGet("/tasks", async (Access a, AppDb db) => { a.Partner(); return Results.Ok((await db.Tasks.OrderBy(x => x.DueDate == null).ThenBy(x => x.DueDate).ThenByDescending(x => x.CreatedAt).ToListAsync()).Select(DtoService.Task)); });
        routes.MapPost("/tasks", async (TaskInput input, Access a, AppDb db) => {
            a.Partner(); var task = new PlannerTask(); await SetTask(task, JsonSerializer.SerializeToElement(input, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }), db);
            db.Tasks.Add(task); if (task.Status == "done") await CreateNext(task, db); db.Log(a.User.Id, "Добавил(а) дело «" + task.Title + "»"); db.Changed("tasks", task.Id); await db.SaveChangesAsync(); return Results.Ok(DtoService.Task(task));
        });
        routes.MapPatch("/tasks/{id:guid}", async (Guid id, JsonElement input, Access a, AppDb db) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("tasks"); var task = await db.Tasks.FindAsync(id) ?? throw new ApiException(404, "Задача не найдена."); var oldStatus = task.Status;
            await SetTask(task, input, db); if (task.Status == "done" && oldStatus != "done") await CreateNext(task, db);
            db.Log(a.User.Id, task.Status == "done" && oldStatus != "done" ? "Выполнил(а) дело «" + task.Title + "»" : "Изменил(а) дело «" + task.Title + "»"); db.Changed("tasks", id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(DtoService.Task(task));
        });
        routes.MapDelete("/tasks/{id:guid}", async (Guid id, Access a, AppDb db) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("tasks"); var t = await db.Tasks.FindAsync(id) ?? throw new ApiException(404, "Задача не найдена."); db.Tasks.Remove(t); db.Log(a.User.Id, "Удалил(а) дело «" + t.Title + "»"); db.Changed("tasks", id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapGet("/wishes", async (Guid? ownerId, Access a, AppDb db, DtoService dto) => { a.Partner(); var query = db.Wishes.AsQueryable(); if (ownerId.HasValue) query = query.Where(x => x.OwnerId == ownerId); return Results.Ok(await dto.WishesAsync(await query.OrderByDescending(x => x.CreatedAt).ToListAsync())); });
        routes.MapPost("/wishes", async (WishInput input, Access a, AppDb db, DtoService dto) => {
            a.Partner(); var wish = new Wish { OwnerId = a.User.Id }; SetWish(wish, JsonSerializer.SerializeToElement(input, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })); db.Wishes.Add(wish); db.Changed("wishes", wish.Id); await db.SaveChangesAsync(); return Results.Ok((await dto.WishesAsync([wish]))[0]);
        });
        routes.MapPatch("/wishes/{id:guid}", async (Guid id, JsonElement input, Access a, AppDb db, DtoService dto) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("wish:" + id); var wish = await db.Wishes.FindAsync(id) ?? throw new ApiException(404, "Желание не найдено."); Validation.Require(wish.OwnerId == a.User.Id, "Изменять желание может только автор.", 403); SetWish(wish, input); wish.UpdatedAt = DateTimeOffset.UtcNow; db.Changed("wishes", id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok((await dto.WishesAsync([wish]))[0]);
        });
        routes.MapDelete("/wishes/{id:guid}", async (Guid id, Access a, AppDb db) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("wish:" + id); var wish = await db.Wishes.FindAsync(id) ?? throw new ApiException(404, "Желание не найдено."); Validation.Require(wish.OwnerId == a.User.Id, "Удалять желание может только автор.", 403); db.Wishes.Remove(wish); db.Changed("wishes", id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapPut("/wishes/{id:guid}/reservation", async (Guid id, ReservationInput input, Access a, AppDb db) => {
            a.Partner(); var state = Validation.Choice(input.Status, ["reserved", "bought"], "status"); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("wish:" + id); var wish = await db.Wishes.FindAsync(id);
            Validation.Require(wish != null && wish.OwnerId != a.User.Id, "Желание не найдено.", 404);
            var row = await db.Reservations.FindAsync(id); if (row == null) { row = new GiftReservation { WishId = id, UserId = a.User.Id }; db.Reservations.Add(row); }
            Validation.Require(row.UserId == a.User.Id, "Резерв недоступен.", 404); row.Status = state; db.Changed("wishes", id, a.User.Id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
        routes.MapDelete("/wishes/{id:guid}/reservation", async (Guid id, Access a, AppDb db) => {
            a.Partner(); await using var tx = await db.Database.BeginTransactionAsync(); await db.LockAsync("wish:" + id); var wish = await db.Wishes.FindAsync(id); Validation.Require(wish != null && wish.OwnerId != a.User.Id, "Желание не найдено.", 404);
            await db.Reservations.Where(x => x.WishId == id && x.UserId == a.User.Id).ExecuteDeleteAsync(); db.Changed("wishes", id, a.User.Id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        });
    }
    private static async Task SetTask(PlannerTask task, JsonElement input, AppDb db)
    {
        if (input.TryGetProperty("title", out var title)) task.Title = Validation.Text(title.GetString(), "название задачи");
        Validation.Require(task.Title.Length > 0, "Укажите название задачи.");
        if (input.TryGetProperty("assigneeId", out var assignee)) { task.AssigneeId = JsonInput.NullableGuid(assignee); if (task.AssigneeId.HasValue) Validation.Require(await db.Users.AnyAsync(x => x.Id == task.AssigneeId && x.Role == "partner" && !x.Disabled), "Ответственным может быть только партнёр."); }
        if (input.TryGetProperty("dueDate", out var due)) task.DueDate = Validation.Date(due.ValueKind == JsonValueKind.Null ? null : due.GetString());
        if (input.TryGetProperty("priority", out var priority) && priority.ValueKind != JsonValueKind.Null) task.Priority = Validation.Choice(priority.GetString(), Priorities, "priority");
        if (input.TryGetProperty("status", out var status) && status.ValueKind != JsonValueKind.Null) task.Status = Validation.Choice(status.GetString(), ["todo", "doing", "done"], "status");
        if (input.TryGetProperty("repeat", out var repeat) && repeat.ValueKind != JsonValueKind.Null) task.Repeat = Validation.Choice(repeat.GetString(), ["none", "daily", "weekly", "monthly"], "repeat");
        Validation.Require(task.Repeat == "none" || task.DueDate.HasValue, "Для повторяющейся задачи укажите срок.");
    }
    private static async Task CreateNext(PlannerTask task, AppDb db)
    {
        if (task.Repeat == "none" || task.RecurrenceGenerated) return;
        if (!await db.Tasks.AnyAsync(x => x.PreviousOccurrenceId == task.Id))
            db.Tasks.Add(new PlannerTask { Title = task.Title, AssigneeId = task.AssigneeId, DueDate = NextDate(task.DueDate!.Value, task.Repeat), Priority = task.Priority, Repeat = task.Repeat, PreviousOccurrenceId = task.Id });
        task.RecurrenceGenerated = true;
    }
    private static void SetWish(Wish wish, JsonElement input)
    {
        if (input.TryGetProperty("title", out var title)) wish.Title = Validation.Text(title.GetString(), "желание");
        Validation.Require(wish.Title.Length > 0, "Укажите желание.");
        if (input.TryGetProperty("note", out var note)) wish.Note = note.ValueKind == JsonValueKind.Null ? null : Validation.Body(note.GetString(), 2000);
        if (input.TryGetProperty("url", out var url)) wish.Url = Validation.Link(url.ValueKind == JsonValueKind.Null ? null : url.GetString());
        if (input.TryGetProperty("price", out var price)) { wish.Price = price.ValueKind == JsonValueKind.Null ? null : price.GetDecimal(); Validation.Require(wish.Price is null or >= 0 and <= 999999999999m && (!wish.Price.HasValue || decimal.Round(wish.Price.Value, 2) == wish.Price), "Некорректная цена (до двух знаков после запятой)."); }
        if (input.TryGetProperty("currency", out var currency)) Validation.Require(currency.GetString() == "RUB", "Поддерживается валюта RUB.");
        if (input.TryGetProperty("category", out var category) && category.ValueKind != JsonValueKind.Null) wish.Category = Validation.Text(category.GetString(), "категория", 80);
        if (input.TryGetProperty("priority", out var priority) && priority.ValueKind != JsonValueKind.Null) wish.Priority = Validation.Choice(priority.GetString(), Priorities, "priority");
    }
}
public sealed record TaskInput(string Title, Guid? AssigneeId, string? DueDate, string? Priority, string? Status, string? Repeat);
public sealed record WishInput(string Title, string? Note, string? Url, decimal? Price, string? Category, string? Priority);
public sealed record ReservationInput(string Status);
