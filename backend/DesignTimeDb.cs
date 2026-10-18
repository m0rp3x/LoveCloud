using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace LoveCloud;

public sealed class DesignTimeDb : IDesignTimeDbContextFactory<AppDb>
{
    public AppDb CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<AppDb>().UseNpgsql("Host=localhost;Database=lovecloud;Username=lovecloud;Password=design-time-only").Options);
}
