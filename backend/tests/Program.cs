using LoveCloud;

var vectors = new (long Time, string Expected)[] {
    (59, "94287082"), (1111111109, "07081804"), (1111111111, "14050471"),
    (1234567890, "89005924"), (2000000000, "69279037"), (20000000000, "65353130")
};
var secret = Totp.Encode(System.Text.Encoding.ASCII.GetBytes("12345678901234567890"));
foreach (var vector in vectors) Check(Totp.Generate(secret, vector.Time / 30, 8) == vector.Expected, "RFC 6238 SHA1 vector " + vector.Time);
var now = DateTimeOffset.FromUnixTimeSeconds(1234567890);
Check(Totp.Match(secret, Totp.Generate(secret, now.ToUnixTimeSeconds() / 30), now) == now.ToUnixTimeSeconds() / 30, "TOTP current step");
Check(Totp.Match(secret, "notOTP", now) == null, "TOTP rejects non numeric");
Check(Totp.Match(secret, Totp.Generate(secret, now.ToUnixTimeSeconds() / 30 - 2), now) == null, "TOTP rejects outside window");
Check(Totp.Decode(Totp.CreateSecret()).Length == 20, "Independent 160-bit secret");
Check(PlannerWishEndpoints.NextDate(new DateOnly(2028, 1, 31), "monthly") == new DateOnly(2028, 2, 29), "Monthly repeat clamps to last calendar day");
Check(PlannerWishEndpoints.NextDate(new DateOnly(2026, 12, 31), "daily") == new DateOnly(2027, 1, 1), "Daily year boundary");
Check(Validation.Link("https://example.com/a") == "https://example.com/a", "HTTPS link");
foreach (var link in new[] { "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "https://user:pass@example.com" })
{ try { Validation.Link(link); throw new Exception("Unsafe link accepted"); } catch (ApiException) { } }
Console.WriteLine("All core checks passed.");
await AvatarChecks.RunAsync();
var integrationConnectionFile = Environment.GetEnvironmentVariable("LOVECLOUD_CHECKS_CONNECTION_FILE");
if (!string.IsNullOrEmpty(integrationConnectionFile)) await SetupRaceChecks.RunAsync(integrationConnectionFile);
else if (Environment.GetEnvironmentVariable("LOVECLOUD_REQUIRE_SETUP_RACES") == "1") throw new InvalidOperationException("LOVECLOUD_CHECKS_CONNECTION_FILE is required; setup race checks were not run.");
else Console.WriteLine("NOT RUN setup races: set LOVECLOUD_CHECKS_CONNECTION_FILE to a disposable PostgreSQL superuser connection file.");
static void Check(bool ok, string name) { if (!ok) throw new Exception(name); Console.WriteLine("PASS " + name); }
