using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DualSurface.UiaCapture;

// Internal copied data only. No UIA objects, native handles, callbacks or oracle
// state cross this boundary. The future owned collector supplies its proofs;
// constructing a synthetic DTO in unit tests is NOT evidence of native admission.
internal enum CaptureCode { InvalidObservation, AmbiguousSubject, ResourceExceeded, Unavailable }
internal sealed class CaptureException(CaptureCode code) : Exception("capture_refused")
{
    public CaptureCode Code { get; } = code;
}
internal static class CaptureLimits
{
    public const int Nodes = 256, Depth = 16, Children = 64, Roots = 2, Characters = 256,
        ValueCharacters = 64, TotalCharacters = 131072, Patterns = 7, Descriptors = 64,
        Bindings = 256, SnapshotBytes = 262144, ReportBytes = 1048576;
    public static readonly TimeSpan Time = TimeSpan.FromSeconds(10);
}
internal sealed record CopiedValues(string? Value = null, bool? ValueReadOnly = null,
    int? Toggle = null, int? Expansion = null, bool? Selected = null,
    string? SelectionContainer = null, bool SelectionKnown = false, string? SelectedInstance = null,
    double? Range = null, double? Minimum = null, double? Maximum = null, bool? RangeReadOnly = null)
{
    internal bool Empty => this == new CopiedValues();
}
internal sealed class CopiedNode
{
    public string Instance { get; }
    public string? Parent { get; }
    public string Correlation { get; }
    public string ControlType { get; }
    public bool? Sensitive { get; }
    public bool? Enabled { get; }
    public bool? Offscreen { get; }
    public bool? RectangleVisible { get; }
    public string? Name { get; }
    public ReadOnlyCollection<string> Patterns { get; }
    public CopiedValues Values { get; }
    public bool AdmittedWindowRoot { get; }
    public bool AdmittedGraphRoot { get; }

    public CopiedNode(string instance, string? parent, string correlation, string controlType,
        bool? sensitive, bool? enabled, bool? offscreen, bool? rectangleVisible, string? name,
        IReadOnlyList<string> patterns, CopiedValues? values = null, bool admittedWindowRoot = false, bool admittedGraphRoot = false)
    {
        if (patterns.Count > CaptureLimits.Patterns) throw new CaptureException(CaptureCode.ResourceExceeded);
        Instance = instance; Parent = parent; Correlation = correlation; ControlType = controlType;
        Sensitive = sensitive; Enabled = enabled; Offscreen = offscreen; RectangleVisible = rectangleVisible;
        Name = name; Patterns = Array.AsReadOnly(patterns.ToArray());
        Values = values ?? new(); AdmittedWindowRoot = admittedWindowRoot;
        AdmittedGraphRoot = admittedWindowRoot || admittedGraphRoot;
    }
}
internal sealed class CopiedObservation
{
    public string Generation { get; }
    public string PublishedRoot { get; }
    public ReadOnlyCollection<CopiedNode> Nodes { get; }
    public ReadOnlyCollection<string> Roots { get; }
    public CopiedObservation(string generation, string publishedRoot,
        IReadOnlyList<CopiedNode> nodes, IReadOnlyList<string> roots)
    {
        if (nodes.Count > CaptureLimits.Nodes || roots.Count > CaptureLimits.Roots)
            throw new CaptureException(CaptureCode.ResourceExceeded);
        Generation = generation; PublishedRoot = publishedRoot;
        Nodes = Array.AsReadOnly(nodes.ToArray()); Roots = Array.AsReadOnly(roots.ToArray());
    }
}

// The same instance is intended to span ALL future native admission, walks,
// selected-peer relations and fences. It is not a hard COM allocation/latency cap.
internal sealed class CaptureBudget
{
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly HashSet<string> instances = new(StringComparer.Ordinal);
    private int characters;
    public int UniqueNodes => instances.Count;
    public void CheckTime()
    {
        if (clock.Elapsed > CaptureLimits.Time) throw new CaptureException(CaptureCode.ResourceExceeded);
    }
    public bool AccountInstance(string instance)
    {
        CheckTime();
        RequireText(instance, 256, false);
        if (instances.Contains(instance)) return false;
        if (instances.Count >= CaptureLimits.Nodes) throw new CaptureException(CaptureCode.ResourceExceeded);
        return instances.Add(instance);
    }
    public string CopyText(string? text, int maximum, bool allowEmpty = true)
    {
        CheckTime(); RequireText(text, maximum, allowEmpty);
        if (text!.Length > CaptureLimits.TotalCharacters - characters)
            throw new CaptureException(CaptureCode.ResourceExceeded);
        characters += text.Length;
        return text;
    }
    public static void RequireText(string? text, int maximum, bool allowEmpty = true)
    {
        if (text == null || text.Length > maximum || (!allowEmpty && text.Length == 0))
            throw new CaptureException(CaptureCode.InvalidObservation);
        // Reject malformed UTF-16 rather than silently replacing private identity
        // or provider text during UTF-8 encoding. Valid bidi text stays inert text.
        for (int i = 0; i < text.Length; i++)
        {
            if (!char.IsSurrogate(text[i])) continue;
            if (!char.IsHighSurrogate(text[i]) || ++i >= text.Length || !char.IsLowSurrogate(text[i]))
                throw new CaptureException(CaptureCode.InvalidObservation);
        }
    }
    // Testable content-read gate, also required by the future native collector.
    // Sensitive and ANY unknown basic safety flag must not call the getter.
    public static T? ReadKnownNonsensitive<T>(bool? password, bool? enabled, bool? offscreen,
        Func<T> getter) where T : class => password is false && enabled.HasValue && offscreen.HasValue ? getter() : null;
}

internal static class CaptureEncoding
{
    internal static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        MaxDepth = CaptureLimits.Depth,
    };
    public static byte[] Encode<T>(T value, int cap)
    {
        using var stream = new CappedStream(cap);
        JsonSerializer.Serialize(stream, value, Json);
        return stream.ToArray();
    }
    public static void PublishNew<T>(string path, T value, int cap)
    {
        // Complete bounded encoding precedes creation. Never truncate a failed
        // artifact or overwrite an earlier attempt. Launcher admits the directory.
        byte[] bytes = Encode(value, cap);
        using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        output.Write(bytes);
    }
    private sealed class CappedStream(int cap) : Stream
    {
        private readonly MemoryStream buffer = new();
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => buffer.Length;
        public override long Position { get => buffer.Position; set => throw new NotSupportedException(); }
        public byte[] ToArray() => buffer.ToArray();
        public override void Write(byte[] bytes, int offset, int count) => Write(bytes.AsSpan(offset, count));
        public override void Write(ReadOnlySpan<byte> bytes)
        {
            if (cap is < 1 or > CaptureLimits.ReportBytes || bytes.Length > cap - buffer.Length)
                throw new CaptureException(CaptureCode.ResourceExceeded);
            buffer.Write(bytes);
        }
        public override void Flush() { }
        public override int Read(byte[] bytes, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) buffer.Dispose(); base.Dispose(disposing); }
    }
}
