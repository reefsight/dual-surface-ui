using System.Text.Json;

namespace DualSurface.UiaCapture;

internal static class Program
{
    public static int Main(string[] args)
    {
        if (!args.SequenceEqual(new[] { "--unit" })) return 64;
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "p4.3-capture-foundation-unit", cases = UnitCases.Run(),
                nativeExecuted = false, publication = UnitCases.PublicationVector() }, CaptureEncoding.Json));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("p4.3_capture_unit_failed:" + UnitCases.Current + ":" +
                (error is CaptureException capture ? capture.Code.ToString() : "Unexpected"));
            return 70;
        }
    }
}
