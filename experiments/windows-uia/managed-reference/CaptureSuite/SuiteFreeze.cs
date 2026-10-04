using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DualSurface.UiaCapture;

internal sealed record SuitePins(string SourceDigest, string CollectorBinaryDigest, string FixtureBinaryDigest);
internal static class SuiteFreeze
{
    public const string FixtureDigest = "sha256:05491f5a44d01e9a25f5098d86a4919abb9bb8d6f4d44a4050dcf2560107161d";
    internal static readonly string[] SourcePaths = [
        "docs/work-items/P4.3-native-capture-suite-integration.md",
        "experiments/windows-uia/managed-reference/CaptureSuite/CaptureSuite.csproj",
        "experiments/windows-uia/managed-reference/CaptureSuite/FixtureRecords.cs",
        "experiments/windows-uia/managed-reference/CaptureSuite/OwnedFiles.cs",
        "experiments/windows-uia/managed-reference/CaptureSuite/Program.cs",
        "experiments/windows-uia/managed-reference/CaptureSuite/SuiteFreeze.cs",
        "experiments/windows-uia/managed-reference/CaptureSuite/TrustedSetup.cs",
        "experiments/windows-uia/managed-reference/CaptureSuite/UnitCases.cs",
        "scripts/p4.3-native-suite-contracts.mjs",
        "scripts/p4.3-native-suite-source.mjs",
        "scripts/run-p4.3-capture-suite.ps1",
        "scripts/verify-p4.3-native-suite.mjs",
        "test/p4.3-native-suite.test.ts",
    ];
    private static readonly string[] ReviewPaths = [
        "docs/reviews/p4.3-native-suite-security-agent-review.md",
        "docs/reviews/p4.3-native-suite-accessibility-agent-review.md",
        "docs/reviews/p4.3-native-suite-package-agent-review.md",
    ];
    private static readonly string[] ReviewAgents = [
        "/root/p42_security_review", "/root/p42_accessibility_interop_review", "/root/p42_package_gate_review",
    ];
    private static readonly string[] ApprovalLabels = [
        "Reviewer agent", "Disposition", "Reviewed source", "Unresolved Critical/High/Medium", "Native execution",
    ];
    public static string Repository()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; i < 7; i++) directory = directory.Parent ?? throw new CaptureException(CaptureCode.Unavailable);
        string expected = Path.Combine(directory.FullName, "experiments/windows-uia/managed-reference/CaptureSuite/bin/Release/net10.0-windows/");
        if (!string.Equals(Path.GetFullPath(expected), Path.GetFullPath(AppContext.BaseDirectory), StringComparison.OrdinalIgnoreCase)) Refuse();
        OwnedFiles.RequireDirectory(directory.FullName);
        return directory.FullName;
    }
    public static SuitePins Admit(string repo)
    {
        var value = Parse(OwnedFiles.Read(Path.Combine(repo, "docs/evidence/p4.3-native-suite-freeze.json"), 32768));
        Exact(value, ["schemaVersion", "kind", "status", "sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest", "reviewReports", "decision"]);
        if (Text(value, "schemaVersion") != "0.1" || Text(value, "kind") != "p4.3-native-capture-suite-freeze" ||
            Text(value, "status") != "source-approved" || Text(value, "fixtureBinaryDigest") != FixtureDigest) Refuse();
        string source = Text(value, "sourceDigest"); DigestShape(source);
        string binary = Digest(OwnedFiles.Read(typeof(SuiteFreeze).Assembly.Location, 8388608));
        if (binary != Text(value, "collectorBinaryDigest") || source != SourceBinding(repo)) Refuse();
        string fixture = Path.Combine(repo, "fixtures/native/windows-app/Fixture/bin/Release/net10.0-windows/DualSurface.Fixture.dll");
        if (Digest(OwnedFiles.Read(fixture, 8388608)) != FixtureDigest) Refuse();
        var reports = value.GetProperty("reviewReports");
        if (reports.ValueKind != JsonValueKind.Array || reports.GetArrayLength() != 3) Refuse();
        for (int i = 0; i < ReviewPaths.Length; i++)
        {
            var report = reports[i]; Exact(report, ["path", "blob"]);
            if (Text(report, "path") != ReviewPaths[i]) Refuse();
            string text = ReadNormalized(repo, ReviewPaths[i]);
            if (GitBlob(text) != Text(report, "blob")) Refuse();
            RequireApprovalMetadata(text, source, ReviewAgents[i]);
        }
        var decision = value.GetProperty("decision"); Exact(decision, ["path", "blob"]);
        const string decisionPath = "docs/reviews/p4.3-native-suite-execution-entry-2026-10-04.md";
        if (Text(decision, "path") != decisionPath) Refuse();
        string entry = ReadNormalized(repo, decisionPath);
        if (GitBlob(entry) != Text(decision, "blob")) Refuse();
        RequireApprovalMetadata(entry, source);
        return new(source, binary, FixtureDigest);
    }
    // Repository report pins are governance evidence, not a signature proving
    // authorship. Keep this grammar identical to the private JS admission.
    internal static void RequireApprovalMetadata(string content, string sourceDigest, string? reviewerAgent = null)
    {
        CaptureBudget.RequireText(content, CaptureLimits.ReportBytes, false);
        if (Encoding.UTF8.GetByteCount(content) > CaptureLimits.ReportBytes || content.StartsWith('\ufeff') ||
            content.Contains('\0') || reviewerAgent != null && !ReviewAgents.Contains(reviewerAgent, StringComparer.Ordinal)) Refuse();
        if (sourceDigest == null || sourceDigest.Length != 71) Refuse();
        DigestShape(sourceDigest);
        content = content.Replace("\r\n", "\n");
        if (content.Contains('\r')) Refuse();
        var fields = reviewerAgent == null ? new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Native execution"] = "authorized for the frozen fixed suite only", ["Reviewed source"] = sourceDigest,
        } : new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Reviewer agent"] = reviewerAgent, ["Disposition"] = "source-approved", ["Reviewed source"] = sourceDigest,
            ["Unresolved Critical/High/Medium"] = "0",
        };
        // Fixed plaintext prefix; raw HTML/declarations/processing instructions
        // cannot wrap metadata before this block. Body text is not authority.
        string[] prefix = content.Split('\n');
        if (prefix.Length < 3 + fields.Count ||
            !System.Text.RegularExpressions.Regex.IsMatch(prefix[0], @"^# [A-Za-z0-9 .():/_-]{1,240}$",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant) || prefix[1] != "" || prefix[2 + fields.Count] != "") Refuse();
        int fieldIndex = 2;
        foreach (var field in fields) if (prefix[fieldIndex++] != field.Key + ": " + field.Value) Refuse();
        foreach (string label in ApprovalLabels)
        {
            string token = label + ":"; int count = 0, start = 0, found;
            while ((found = content.IndexOf(token, start, StringComparison.Ordinal)) != -1) { count++; start = found + token.Length; }
            if (count != (fields.ContainsKey(label) ? 1 : 0)) Refuse();
        }
        var observed = new HashSet<string>(StringComparer.Ordinal);
        char fence = '\0'; int fenceLength = 0; bool quote = false, comment = false;
        foreach (string line in content.Split('\n'))
        {
            var fenceLine = System.Text.RegularExpressions.Regex.Match(line, @"^[ \t]{0,3}(`{3,}|~{3,})([\s\S]*)$",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant);
            if (fence != '\0')
            {
                if (fenceLine.Success && fenceLine.Groups[1].Value[0] == fence && fenceLine.Groups[1].Value.Length >= fenceLength &&
                    System.Text.RegularExpressions.Regex.IsMatch(fenceLine.Groups[2].Value, @"^[ \t]*$",
                        System.Text.RegularExpressions.RegexOptions.CultureInvariant)) fence = '\0';
                continue;
            }
            bool hidden = comment || line.Contains("<!--", StringComparison.Ordinal);
            foreach (System.Text.RegularExpressions.Match marker in System.Text.RegularExpressions.Regex.Matches(line, "<!--|-->",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant))
            {
                if (marker.Value == "<!--") { if (comment) Refuse(); comment = true; }
                else { if (!comment) Refuse(); comment = false; }
            }
            if (System.Text.RegularExpressions.Regex.IsMatch(line, @"^[ \t]*$", System.Text.RegularExpressions.RegexOptions.CultureInvariant)) quote = false;
            else if (System.Text.RegularExpressions.Regex.IsMatch(line, @"^[ \t]{0,3}>", System.Text.RegularExpressions.RegexOptions.CultureInvariant)) quote = true;
            if (fenceLine.Success && !hidden && !quote)
            {
                if (fenceLine.Groups[1].Value[0] == '`' && fenceLine.Groups[2].Value.Contains('`')) Refuse();
                fence = fenceLine.Groups[1].Value[0]; fenceLength = fenceLine.Groups[1].Value.Length; continue;
            }
            if (hidden || quote) continue;
            foreach (var field in fields) if (line == field.Key + ": " + field.Value) observed.Add(field.Key);
        }
        if (fence != '\0' || comment || observed.Count != fields.Count) Refuse();
    }
    public static string SourceBinding(string repo)
    {
        string[] foundation = ["docs/work-items/P4.3-capture-foundation-increment.md",
            "experiments/windows-uia/managed-reference/CaptureHarness/CaptureHarness.csproj",
            "experiments/windows-uia/managed-reference/CaptureHarness/CopiedObservation.cs",
            "experiments/windows-uia/managed-reference/CaptureHarness/FixtureSubjects.cs",
            "experiments/windows-uia/managed-reference/CaptureHarness/Program.cs",
            "experiments/windows-uia/managed-reference/CaptureHarness/SemanticProjection.cs",
            "experiments/windows-uia/managed-reference/CaptureHarness/UnitCases.cs", "scripts/p4.3-capture-contracts.mjs",
            "scripts/p4.3-capture-source.mjs", "scripts/run-p4.3-capture-unit.ps1", "scripts/verify-p4.3-capture-unit.mjs", "test/p4.3-capture.test.ts"];
        string foundationDigest = Digest(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(Files(foundation))));
        if (foundationDigest != "sha256:79d5777287b327e9c355263e915836577994e052c7e70282c8cf466fa4c27f67") Refuse();
        string[] component = ["docs/work-items/P4.3-native-collector-component.md",
            "experiments/windows-uia/managed-reference/NativeCaptureHarness/NativeCaptureHarness.csproj",
            "experiments/windows-uia/managed-reference/NativeCaptureHarness/OwnedWindowTopology.cs",
            "experiments/windows-uia/managed-reference/NativeCaptureHarness/OwnedWindowsAdmission.cs",
            "experiments/windows-uia/managed-reference/NativeCaptureHarness/Program.cs",
            "experiments/windows-uia/managed-reference/NativeCaptureHarness/ReadOnlyCollector.cs",
            "scripts/p4.3-native-capture-source.mjs", "scripts/run-p4.3-native-capture-unit.ps1",
            "scripts/verify-p4.3-native-capture-unit.mjs", "test/p4.3-native-capture.test.ts"];
        string componentDigest = Digest(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { files = Files(component), foundation = foundationDigest })));
        if (componentDigest != "sha256:af7a01ef530fcaaf1acbb08942670a7c37ba1e6339090a804fa1167d5461d605") Refuse();
        return Digest(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { files = Files(SourcePaths), component = componentDigest })));
        object[] Files(string[] paths) => paths.Order(StringComparer.Ordinal).Select(path => (object)new
            { path, digest = Digest(Encoding.UTF8.GetBytes(ReadNormalized(repo, path))) }).ToArray();
    }
    internal static JsonElement Parse(byte[] bytes)
    {
        if (bytes.Length is < 1 or > 32768 || bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf })) Refuse();
        try
        {
            _ = new UTF8Encoding(false, true).GetString(bytes);
            var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { MaxDepth = 16 });
            var objects = new Stack<HashSet<string>?>(); int tokens = 0;
            while (reader.Read())
            {
                if (++tokens > 4096) Refuse();
                if (reader.TokenType == JsonTokenType.StartObject) objects.Push(new(StringComparer.Ordinal));
                if (reader.TokenType == JsonTokenType.StartArray) objects.Push(null);
                if (reader.TokenType is JsonTokenType.EndObject or JsonTokenType.EndArray) objects.Pop();
                if (reader.TokenType == JsonTokenType.PropertyName && (objects.Count == 0 || objects.Peek() == null ||
                    !objects.Peek()!.Add(reader.GetString()!))) Refuse();
                if (reader.TokenType is JsonTokenType.String or JsonTokenType.PropertyName) CaptureBudget.RequireText(reader.GetString(), 256);
            }
            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
            return json.RootElement.Clone();
        }
        catch (Exception error) when (error is JsonException or DecoderFallbackException or InvalidOperationException)
        { throw new CaptureException(CaptureCode.InvalidObservation); }
    }
    private static void Exact(JsonElement value, string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != keys.Length ||
            keys.Any(k => !value.TryGetProperty(k, out _))) Refuse();
    }
    private static string Text(JsonElement value, string key) => value.GetProperty(key).ValueKind == JsonValueKind.String
        ? value.GetProperty(key).GetString()! : throw new CaptureException(CaptureCode.InvalidObservation);
    private static string ReadNormalized(string repo, string path)
        => new UTF8Encoding(false, true).GetString(OwnedFiles.Read(Path.Combine(repo, path), CaptureLimits.ReportBytes)).Replace("\r\n", "\n");
    public static string Digest(byte[] bytes) => "sha256:" + Convert.ToHexStringLower(SHA256.HashData(bytes));
    internal static string GitBlob(string value)
    {
        byte[] data = Encoding.UTF8.GetBytes(value);
        byte[] prefix = Encoding.UTF8.GetBytes("blob " + data.Length + "\0");
        return Convert.ToHexStringLower(SHA1.HashData(prefix.Concat(data).ToArray()));
    }
    private static void DigestShape(string digest)
    { if (!System.Text.RegularExpressions.Regex.IsMatch(digest, "^sha256:[a-f0-9]{64}$")) Refuse(); }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
}
