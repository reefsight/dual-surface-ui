using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Automation;

namespace DualSurface.UiaCapture;

// Private host-owned refusal metadata, never provider data or success evidence.
internal sealed record FailureTuple(string Case, string Stage, string? Site, string Classification, string Code,
    string? AdmissionCheck = null, string? AdmissionGuard = null);
internal sealed class FailureDiagnostics
{
    internal static readonly string[] PropertySites = ["process-id", "window-handle", "control-type", "automation-id",
        "is-password", "is-enabled", "is-offscreen", "value-readonly", "range-readonly", "expansion-state", "selection-container"];
    internal static readonly string[] SetupSites = [.. PropertySites, "runtime-id", "root-from-handle", "tree-first-child",
        "tree-next-sibling", "tree-parent", "pattern-required", "pattern-operation", "sdk-mutation", "setup-admission", "collector-start", "record-read"];
    internal static readonly string[] Stages = ["output", "startup", "setup", "capture", "publication", "report", "cleanup"];
    internal static readonly string[] Codes = ["InvalidObservation", "AmbiguousSubject", "ResourceExceeded", "Unavailable", "Timeout", "Unexpected"];
    private static readonly string[] Keys = ["schemaVersion", "kind", "sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest",
        "case", "stage", "site", "classification", "code", "cleanupCode", "recordedAt"];
    private static readonly string[] D2Keys = [.. Keys, "admissionCheck", "admissionGuard"];
    private static readonly JsonSerializerOptions Encoding = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, MaxDepth = 2 };
    private const string UtcFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";
    private string? output, site;
    private SuitePins? pins;
    private bool publicationAttempted;
    public string Case { get; private set; } = "bootstrap";
    public string Stage { get; private set; } = "output";
    public FailureTuple? Primary { get; private set; }
    public string? CleanupCode { get; private set; }
    public bool PublicationAttempted => publicationAttempted;

    public void SetCase(string value)
    {
        RequireUnfailed();
        if (!FixedCaptureSuite.CaseIds.Contains(value, StringComparer.Ordinal)) Refuse();
        Case = value; Stage = "setup"; site = null;
    }
    public void SetStage(string value)
    {
        RequireUnfailed(); RequireLocation(Case, value, null);
        Stage = value; site = null;
    }
    public T At<T>(string label, Func<T> operation)
    {
        RequireUnfailed(); RequireLocation(Case, Stage, label);
        string? previous = site; site = label;
        try { return operation(); }
        catch (Exception error) { Latch(error); throw; }
        finally { site = previous; }
    }
    public void At(string label, Action operation) => At(label, () => { operation(); return 0; });

    // Exactly the existing required read/deadline/type sequence, not a probe.
    public T ReadRequired<T>(string label, Func<object?> read, Action requireLive, object notSupported)
        => At(label, () =>
        {
            requireLive(); object? observed = read(); requireLive();
            if (observed is T typed) return typed;
            var error = new CaptureException(CaptureCode.InvalidObservation);
            Latch(error, ReferenceEquals(observed, notSupported) ? "not-supported" : "malformed-property");
            throw error;
        });

    public void Latch(Exception error, string? propertyClass = null)
    {
        if (Primary != null) return;
        var (classification, code) = Classify(error);
        if (propertyClass != null) classification = propertyClass;
        RequireLocation(Case, Stage, site); RequireClassification(classification, code, site);
        Primary = new(Case, Stage, site, classification, code); // no exception/value retained
    }
    // The constructor callback does only closed validation and one immutable
    // assignment. No exception/value, IO, clock/deadline or native operation.
    public void ObserveAdmissionRefusal(AdmissionCheck check, AdmissionGuard guard)
    {
        if (Primary != null) return;
        if (!ConstructorAdmissionTrace.TryLabels(check, guard, out string? checkLabel, out string? guardLabel)) Refuse();
        RequireAdmissionContext(Case, Stage, site);
        Primary = new(Case, Stage, site, "guard-refused", "Unavailable", checkLabel, guardLabel);
    }
    // Called only for already-required owned-resource closure, even after failure.
    // A fault must not prevent the next independent closure action.
    public bool Cleanup(Action operation)
    {
        string priorStage = Stage; string? priorSite = site;
        Stage = "cleanup"; site = "owned-stop";
        try { operation(); return true; }
        catch (Exception error)
        {
            if (Primary == null) Latch(error);
            else if (Primary.Stage != "cleanup" && CleanupCode == null) CleanupCode = Classify(error).Code;
            return false;
        }
        finally { Stage = priorStage; site = priorSite; }
    }
    internal bool CleanupOnce(ref bool attempted, Action[] actions)
    {
        if (attempted) return true;
        attempted = true; // before even the first closure, including fault paths
        if (actions.Length is < 1 or > 5) Refuse();
        bool clean = true;
        foreach (var action in actions) clean &= Cleanup(action); // deliberately not short-circuit
        return clean;
    }
    public void AdmitOutput(string directory, SuitePins trusted)
    {
        RequireUnfailed();
        if (output != null || pins != null) Refuse();
        string canonical = OwnedFiles.CanonicalDirectory(directory);
        FixedCaptureSuite.AdmitOutput(canonical);
        if (Directory.EnumerateFileSystemEntries(canonical).Any()) Refuse();
        RequirePins(trusted);
        output = canonical; pins = trusted; // capability granted only after all checks
    }
    public bool TryPublish()
    {
        if (Primary == null || output == null || pins == null) return false;
        return PublishOnce(ref publicationAttempted, () =>
        {
            byte[] bytes = EncodeD2(pins, Primary, CleanupCode, DateTimeOffset.UtcNow.ToString(UtcFormat, CultureInfo.InvariantCulture));
            OwnedFiles.WriteNew(Path.Combine(output, "failure.json"), bytes, 4096);
        });
    }
    internal static bool PublishOnce(ref bool attempted, Action publication)
    {
        if (attempted) return false;
        attempted = true;
        try { publication(); return true; }
        catch { return false; } // original tuple/files retained, no error interpolation
    }
    internal static byte[] Encode(SuitePins trusted, FailureTuple primary, string? cleanupCode, string recordedAt)
    {
        if (primary.AdmissionCheck != null || primary.AdmissionGuard != null) Refuse(); // D1 cannot silently strip D2 detail
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "0.1", kind = "p4.3-native-capture-suite-failure",
            sourceDigest = trusted.SourceDigest, collectorBinaryDigest = trusted.CollectorBinaryDigest,
            fixtureBinaryDigest = trusted.FixtureBinaryDigest, @case = primary.Case, stage = primary.Stage,
            site = primary.Site, classification = primary.Classification, code = primary.Code, cleanupCode, recordedAt,
        }, Encoding);
        _ = Parse(bytes, trusted); return bytes;
    }
    internal static byte[] EncodeD2(SuitePins trusted, FailureTuple primary, string? cleanupCode, string recordedAt)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "0.1", kind = "p4.3-native-capture-suite-d2-failure",
            sourceDigest = trusted.SourceDigest, collectorBinaryDigest = trusted.CollectorBinaryDigest,
            fixtureBinaryDigest = trusted.FixtureBinaryDigest, @case = primary.Case, stage = primary.Stage,
            site = primary.Site, classification = primary.Classification, code = primary.Code, cleanupCode, recordedAt,
            admissionCheck = primary.AdmissionCheck, admissionGuard = primary.AdmissionGuard,
        }, Encoding);
        _ = ParseD2(bytes, trusted); return bytes;
    }
    internal static JsonElement Parse(byte[] bytes, SuitePins trusted)
        => ParseCore(bytes, trusted, false);
    internal static JsonElement ParseD2(byte[] bytes, SuitePins trusted)
        => ParseCore(bytes, trusted, true);
    private static JsonElement ParseCore(byte[] bytes, SuitePins trusted, bool d2)
    {
        RequirePins(trusted);
        if (bytes.Length is < 1 or > 4096 || bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf })) Refuse();
        try
        {
            _ = new UTF8Encoding(false, true).GetString(bytes);
            var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { MaxDepth = 2 });
            var keys = new HashSet<string>(StringComparer.Ordinal); int tokens = 0;
            while (reader.Read())
            {
                if (++tokens > 32) Refuse();
                if (reader.TokenType == JsonTokenType.StartObject && reader.CurrentDepth != 0 ||
                    reader.TokenType is JsonTokenType.StartArray or JsonTokenType.EndArray ||
                    reader.TokenType is JsonTokenType.Number or JsonTokenType.True or JsonTokenType.False) Refuse();
                if (reader.TokenType is JsonTokenType.String or JsonTokenType.PropertyName)
                {
                    string value = reader.GetString()!; CaptureBudget.RequireText(value, 128);
                    if (reader.TokenType == JsonTokenType.PropertyName && !keys.Add(value)) Refuse();
                }
            }
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 2 });
            var record = document.RootElement;
            string[] expectedKeys = d2 ? D2Keys : Keys;
            if (record.ValueKind != JsonValueKind.Object || keys.Count != expectedKeys.Length || expectedKeys.Any(k => !keys.Contains(k))) Refuse();
            if (Text(record, "schemaVersion") != "0.1" || Text(record, "kind") != (d2 ? "p4.3-native-capture-suite-d2-failure" : "p4.3-native-capture-suite-failure") ||
                Text(record, "sourceDigest") != trusted.SourceDigest || Text(record, "collectorBinaryDigest") != trusted.CollectorBinaryDigest ||
                Text(record, "fixtureBinaryDigest") != trusted.FixtureBinaryDigest) Refuse();
            string caseId = Text(record, "case"), stage = Text(record, "stage");
            string? recordSite = NullableText(record, "site"), cleanup = NullableText(record, "cleanupCode");
            RequireLocation(caseId, stage, recordSite);
            RequireClassification(Text(record, "classification"), Text(record, "code"), recordSite);
            if (d2) RequireAdmissionPair(NullableText(record, "admissionCheck"), NullableText(record, "admissionGuard"),
                caseId, stage, recordSite, Text(record, "classification"), Text(record, "code"));
            if (cleanup != null && (!Codes.Contains(cleanup, StringComparer.Ordinal) || stage == "cleanup")) Refuse();
            string time = Text(record, "recordedAt");
            if (time.Length != 24 || !Regex.IsMatch(time, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$", RegexOptions.CultureInvariant) ||
                !DateTimeOffset.TryParseExact(time, UtcFormat, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ||
                parsed.ToUniversalTime().ToString(UtcFormat, CultureInfo.InvariantCulture) != time) Refuse();
            return record.Clone();
        }
        catch (Exception error) when (error is JsonException or DecoderFallbackException or InvalidOperationException or ArgumentException)
        { throw new CaptureException(CaptureCode.InvalidObservation); }
    }
    private static void RequirePins(SuitePins trusted)
    {
        foreach (string value in new[] { trusted.SourceDigest, trusted.CollectorBinaryDigest, trusted.FixtureBinaryDigest })
            if (value == null || value.Length != 71 || !Regex.IsMatch(value, "^sha256:[a-f0-9]{64}$", RegexOptions.CultureInvariant)) Refuse();
    }
    private static void RequireAdmissionContext(string caseId, string stage, string? label)
    {
        if (label != "setup-admission" || !(stage == "startup" && (caseId is "bootstrap" or "process-restart") ||
            stage == "setup" && caseId == "window-replacement")) Refuse();
    }
    private static void RequireAdmissionPair(string? check, string? guard, string caseId, string stage, string? label, string classification, string code)
    {
        if (check == null && guard == null) return;
        if (check == null || guard == null || classification != "guard-refused" || code != "Unavailable") Refuse();
        RequireAdmissionContext(caseId, stage, label);
        foreach (var knownCheck in Enum.GetValues<AdmissionCheck>())
            foreach (var knownGuard in Enum.GetValues<AdmissionGuard>())
                if (ConstructorAdmissionTrace.TryLabels(knownCheck, knownGuard, out var checkLabel, out var guardLabel) &&
                    check == checkLabel && guard == guardLabel) return;
        Refuse();
    }
    private static void RequireLocation(string caseId, string stage, string? label)
    {
        bool bootstrap = caseId == "bootstrap";
        if (!bootstrap && !FixedCaptureSuite.CaseIds.Contains(caseId, StringComparer.Ordinal) || !Stages.Contains(stage, StringComparer.Ordinal) ||
            stage == "output" && !bootstrap || stage == "startup" && !bootstrap && caseId != "process-restart" ||
            stage is "setup" or "capture" or "publication" or "report" && bootstrap) Refuse();
        if (label == null) return;
        bool allowed = stage switch
        {
            "startup" => new[] { "fixture-start", "fixture-ready", "setup-admission", "collector-start", "record-read" }.Contains(label, StringComparer.Ordinal),
            "setup" => SetupSites.Contains(label, StringComparer.Ordinal),
            "capture" => label is "capture-call" or "record-read",
            "publication" => label == "artifact-write", "report" => label == "report-write", "cleanup" => label == "owned-stop",
            _ => false,
        };
        if (!allowed) Refuse();
    }
    private static void RequireClassification(string classification, string code, string? label)
    {
        bool allowed = classification switch
        {
            "guard-refused" => Codes.Take(4).Contains(code, StringComparer.Ordinal),
            "not-supported" or "malformed-property" => code == "InvalidObservation" && label != null && PropertySites.Contains(label, StringComparer.Ordinal),
            "sdk-fault" or "unexpected" => code == "Unexpected", "timeout" => code == "Timeout", _ => false,
        };
        if (!allowed) Refuse();
    }
    private static (string Classification, string Code) Classify(Exception error) => error switch
    {
        CaptureException capture when Codes.Take(4).Contains(capture.Code.ToString(), StringComparer.Ordinal) => ("guard-refused", capture.Code.ToString()),
        ElementNotAvailableException or ElementNotEnabledException => ("sdk-fault", "Unexpected"),
        TimeoutException => ("timeout", "Timeout"), _ => ("unexpected", "Unexpected"),
    };
    private void RequireUnfailed() { if (Primary != null) throw new CaptureException(CaptureCode.Unavailable); }
    private static string Text(JsonElement record, string key) => record.GetProperty(key).ValueKind == JsonValueKind.String
        ? record.GetProperty(key).GetString()! : throw new CaptureException(CaptureCode.InvalidObservation);
    private static string? NullableText(JsonElement record, string key) => record.GetProperty(key).ValueKind == JsonValueKind.Null ? null : Text(record, key);
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
}
