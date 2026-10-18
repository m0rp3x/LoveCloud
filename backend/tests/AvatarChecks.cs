using LoveCloud;
using SkiaSharp;

public static class AvatarChecks
{
    public static byte[] Png()
    {
        using var bitmap = new SKBitmap(2, 2); bitmap.Erase(SKColors.HotPink);
        using var image = SKImage.FromBitmap(bitmap); using var encoded = image.Encode(SKEncodedImageFormat.Png, 100); return encoded.ToArray();
    }
    public static async Task RunAsync()
    {
        var png = Png(); var sanitized = await AvatarService.SanitizeAsync(png, "image/png");
        using var codec = SKCodec.Create(new MemoryStream(sanitized));
        if (codec.EncodedFormat != SKEncodedImageFormat.Png || codec.Info.Width != 2) throw new Exception("Avatar re-encoding failed");
        await Reject(png, "image/jpeg", 415);
        await Reject([137, 80, 78, 71, 13, 10, 26, 10, 0], "image/png", 415);
        await Reject(new byte[AvatarService.MaxUploadBytes + 1], "image/png", 413);
        Console.WriteLine("PASS avatar decode/re-encode, content-type mismatch, malformed image and upload cap");
    }
    private static async Task Reject(byte[] data, string mime, int status)
    {
        try { await AvatarService.SanitizeAsync(data, mime); throw new Exception("Invalid avatar accepted"); }
        catch (ApiException e) when (e.Status == status) { }
    }
}
