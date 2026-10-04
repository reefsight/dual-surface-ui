using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DualSurface.UiaCapture;

internal sealed record FixtureState(byte[] Bytes, JsonElement Value)
{
    public int Revision => Value.GetProperty("revision").GetInt32();
    public bool Toggle => Value.GetProperty("toggle").GetBoolean();
    public bool Same(FixtureState other) => Bytes.SequenceEqual(other.Bytes);
}
internal sealed class FixtureRecords(string output)
{
    private static readonly string[] StateKeys = ["schemaVersion", "kind", "seed", "revision", "count", "value",
        "toggle", "selection", "combo", "radio", "tab", "expanded", "range", "generation", "modalResult", "sensitivePresent"];
    public FixtureState State() => ParseState(OwnedFiles.Read(Latest("state"), 4096));
    public long ResetOrdinal()
    {
        string path = Latest("reset-ack");
        ParseAck(OwnedFiles.Read(path, 4096));
        return Ordinal(Path.GetFileName(path), "reset-ack");
    }
    public bool HasStartupRecords() => Find("state").Count > 0 && Find("reset-ack").Count > 0;
    private string Latest(string prefix)
    {
        var paths = Find(prefix);
        if (paths.Count == 0) throw new CaptureException(CaptureCode.Unavailable);
        return paths[^1];
    }
    private List<string> Find(string prefix)
    {
        OwnedFiles.RequireDirectory(output);
        var records = new List<string>(); int entries = 0, combinedRecords = 0;
        // Exact admitted fixture directory only. Count before filtering; ignore
        // only atomic unpublished .tmp files and fixed suite artifacts here.
        foreach (string path in Directory.EnumerateFileSystemEntries(output))
        {
            if (++entries > 1024) throw new CaptureException(CaptureCode.ResourceExceeded);
            string name = Path.GetFileName(path);
            if (!name.StartsWith("state-", StringComparison.Ordinal) && !name.StartsWith("reset-ack-", StringComparison.Ordinal)) continue;
            if (name.EndsWith(".tmp", StringComparison.Ordinal)) continue;
            string actualPrefix = name.StartsWith("state-", StringComparison.Ordinal) ? "state" : "reset-ack";
            _ = Ordinal(name, actualPrefix);
            if (++combinedRecords > 512) throw new CaptureException(CaptureCode.ResourceExceeded);
            if (actualPrefix == prefix) records.Add(path);
        }
        records.Sort(StringComparer.Ordinal);
        return records;
    }
    internal static int Ordinal(string name, string prefix)
    {
        if (prefix is not ("state" or "reset-ack") || !Regex.IsMatch(name,
            "^" + prefix + "-[0-9]{4}\\.json$", RegexOptions.CultureInvariant)) Refuse();
        int ordinal = int.Parse(name.AsSpan(prefix.Length + 1, 4), CultureInfo.InvariantCulture);
        if (ordinal is < 1 or > 512) Refuse();
        return ordinal;
    }
    internal static FixtureState ParseState(byte[] bytes)
    {
        JsonElement value = Strict(bytes, StateKeys);
        Text(value, "schemaVersion", "0.1"); Text(value, "kind", "p4.2-fixture-state"); Text(value, "seed", "p4.2-seed-1");
        Integer(value, "revision", 0, 1024); Integer(value, "count", 0, 128); Integer(value, "generation", 1, 2);
        string text = String(value, "value"); CaptureBudget.RequireText(text, 64);
        Boolean(value, "toggle"); Boolean(value, "expanded");
        if (!Boolean(value, "sensitivePresent")) Refuse();
        OneOf(value, "selection", "selection-a", "selection-b"); OneOf(value, "combo", "combo-a", "combo-b");
        OneOf(value, "radio", "radio-a", "radio-b"); OneOf(value, "tab", "tab-a", "tab-b");
        OneOf(value, "modalResult", "none", "cancelled", "confirmed");
        var range = value.GetProperty("range");
        if (range.ValueKind != JsonValueKind.Number || !range.TryGetDouble(out double number) ||
            !double.IsFinite(number) || number is < 0 or > 10) Refuse();
        return new(bytes.ToArray(), value);
    }
    internal static int ParseAck(byte[] bytes)
    {
        var value = Strict(bytes, ["schemaVersion", "kind", "sequence"]);
        Text(value, "schemaVersion", "0.1"); Text(value, "kind", "p4.2-reset-ack");
        return Integer(value, "sequence", 0, 512); // resettable number is NOT authority
    }
    internal static JsonElement Strict(byte[] bytes, string[] keys)
    {
        if (bytes.Length is < 1 or > 4096 || bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf })) Refuse();
        try
        {
            _ = new UTF8Encoding(false, true).GetString(bytes);
            var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { MaxDepth = 4 });
            var names = new HashSet<string>(StringComparer.Ordinal);
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.PropertyName && (!names.Add(reader.GetString()!) || reader.CurrentDepth != 1)) Refuse();
                if (reader.TokenType is JsonTokenType.StartArray || reader.TokenType == JsonTokenType.StartObject && reader.CurrentDepth != 0) Refuse();
                if (reader.TokenType is JsonTokenType.String or JsonTokenType.PropertyName)
                    CaptureBudget.RequireText(reader.GetString(), 256);
            }
            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
            if (json.RootElement.ValueKind != JsonValueKind.Object || names.Count != keys.Length || keys.Any(k => !names.Contains(k))) Refuse();
            return json.RootElement.Clone();
        }
        catch (Exception error) when (error is JsonException or DecoderFallbackException or InvalidOperationException)
        { throw new CaptureException(CaptureCode.InvalidObservation); }
    }
    private static string String(JsonElement value, string key) => value.GetProperty(key).ValueKind == JsonValueKind.String
        ? value.GetProperty(key).GetString()! : throw new CaptureException(CaptureCode.InvalidObservation);
    private static void Text(JsonElement value, string key, string expected) { if (String(value, key) != expected) Refuse(); }
    private static void OneOf(JsonElement value, string key, params string[] choices) { if (!choices.Contains(String(value, key))) Refuse(); }
    private static bool Boolean(JsonElement value, string key) => value.GetProperty(key).ValueKind is JsonValueKind.True or JsonValueKind.False
        ? value.GetProperty(key).GetBoolean() : throw new CaptureException(CaptureCode.InvalidObservation);
    private static int Integer(JsonElement value, string key, int minimum, int maximum)
    {
        var property = value.GetProperty(key);
        if (property.ValueKind != JsonValueKind.Number || !property.TryGetInt32(out int number) || number < minimum || number > maximum) Refuse();
        return property.GetInt32();
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
}
