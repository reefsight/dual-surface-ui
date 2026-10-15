using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Automation;

namespace DualSurface.UiaCapture;

// Private host-owned refusal metadata, never provider data or success evidence.
internal enum WindowHandleReadContext
{
    RootGuard = 1, RootProof, RootIdentity, WalkNodeGuard, WalkNodeIdentity, WalkChildGuard, WalkChildIdentity,
    WalkCrossRootLeft, WalkCrossRootRight, WalkParentLeft, WalkParentRight, FenceRootGuard, FenceRootProof,
    FenceRootLeft, FenceRootRight, TargetGuard, TargetIdentity, ContainerGuard, ContainerIdentity,
    TargetChainLeft, TargetChainRight, TargetChainParent, ContainerChainLeft, ContainerChainRight,
    ContainerChainParent, SelectionContainerGuard, SelectionContainerLeft, SelectionContainerRight,
}
internal sealed record FailureTuple(string Case, string Stage, string? Site, string Classification, string Code,
    string? AdmissionCheck = null, string? AdmissionGuard = null, WindowHandleReadContext? ReadContext = null);
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
    private static readonly string[] Ctx1Keys = [.. D2Keys, "readContext"];
    private static readonly JsonSerializerOptions Encoding = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, MaxDepth = 2 };
    private const string UtcFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";
    private string? output, site;
    private WindowHandleReadContext? readContext;
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
    public T At<T>(string label, Func<T> operation) => AtCore(label, null, operation);
    private T AtCore<T>(string label, WindowHandleReadContext? context, Func<T> operation)
    {
        RequireUnfailed(); RequireLocation(Case, Stage, label); RequireReadContext(label, context);
        RequireContextLocation(Case, Stage, label, context, null, null);
        string? previous = site; var previousContext = readContext; site = label; readContext = context;
        try { return operation(); }
        catch (Exception error) { Latch(error); throw; }
        finally { site = previous; readContext = previousContext; }
    }
    public void At(string label, Action operation) => At(label, () => { operation(); return 0; });

    // Exactly the existing required read/deadline/type sequence, not a probe.
    public T ReadRequired<T>(string label, Func<object?> read, Action requireLive, object notSupported,
        WindowHandleReadContext? context = null)
        => AtCore(label, context, () =>
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
        RequireContextLocation(Case, Stage, site, readContext, null, null);
        Primary = new(Case, Stage, site, classification, code, ReadContext: readContext); // no exception/value retained
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
        string priorStage = Stage; string? priorSite = site; var priorContext = readContext;
        Stage = "cleanup"; site = "owned-stop"; readContext = null;
        try { operation(); return true; }
        catch (Exception error)
        {
            if (Primary == null) Latch(error);
            else if (Primary.Stage != "cleanup" && CleanupCode == null) CleanupCode = Classify(error).Code;
            return false;
        }
        finally { Stage = priorStage; site = priorSite; readContext = priorContext; }
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
            byte[] bytes = EncodeCtx1(pins, Primary, CleanupCode, DateTimeOffset.UtcNow.ToString(UtcFormat, CultureInfo.InvariantCulture));
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
        if (primary.AdmissionCheck != null || primary.AdmissionGuard != null || primary.ReadContext != null) Refuse(); // D1 cannot silently strip D2 detail
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
        if (primary.ReadContext != null) Refuse(); // legacy encoding cannot silently strip CTX1 detail
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
    internal static byte[] EncodeCtx1(SuitePins trusted, FailureTuple primary, string? cleanupCode, string recordedAt)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "0.1", kind = "p4.3-native-capture-suite-ctx1-failure",
            sourceDigest = trusted.SourceDigest, collectorBinaryDigest = trusted.CollectorBinaryDigest,
            fixtureBinaryDigest = trusted.FixtureBinaryDigest, @case = primary.Case, stage = primary.Stage,
            site = primary.Site, classification = primary.Classification, code = primary.Code, cleanupCode, recordedAt,
            admissionCheck = primary.AdmissionCheck, admissionGuard = primary.AdmissionGuard,
            readContext = primary.ReadContext is { } context ? ContextLabel(context) : null,
        }, Encoding);
        _ = ParseCtx1(bytes, trusted); return bytes;
    }
    internal static JsonElement ParseCtx1(byte[] bytes, SuitePins trusted) => ParseCore(bytes, trusted, 2);
    internal static JsonElement Parse(byte[] bytes, SuitePins trusted)
        => ParseCore(bytes, trusted, 0);
    internal static JsonElement ParseD2(byte[] bytes, SuitePins trusted)
        => ParseCore(bytes, trusted, 1);
    private static JsonElement ParseCore(byte[] bytes, SuitePins trusted, int version)
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
            string[] expectedKeys = version == 2 ? Ctx1Keys : version == 1 ? D2Keys : Keys;
            if (record.ValueKind != JsonValueKind.Object || keys.Count != expectedKeys.Length || expectedKeys.Any(k => !keys.Contains(k))) Refuse();
            if (Text(record, "schemaVersion") != "0.1" || Text(record, "kind") != (version == 2 ? "p4.3-native-capture-suite-ctx1-failure" : version == 1 ? "p4.3-native-capture-suite-d2-failure" : "p4.3-native-capture-suite-failure") ||
                Text(record, "sourceDigest") != trusted.SourceDigest || Text(record, "collectorBinaryDigest") != trusted.CollectorBinaryDigest ||
                Text(record, "fixtureBinaryDigest") != trusted.FixtureBinaryDigest) Refuse();
            string caseId = Text(record, "case"), stage = Text(record, "stage");
            string? recordSite = NullableText(record, "site"), cleanup = NullableText(record, "cleanupCode");
            RequireLocation(caseId, stage, recordSite);
            RequireClassification(Text(record, "classification"), Text(record, "code"), recordSite);
            if (version != 0) RequireAdmissionPair(NullableText(record, "admissionCheck"), NullableText(record, "admissionGuard"),
                caseId, stage, recordSite, Text(record, "classification"), Text(record, "code"));
            if (version == 2) RequireContextLocation(caseId, stage, recordSite,
                NullableText(record, "readContext") is { } contextLabel ? ContextFromLabel(contextLabel) : null,
                NullableText(record, "admissionCheck"), NullableText(record, "admissionGuard"));
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
    internal static string ContextLabel(WindowHandleReadContext context) => context switch
    {
        WindowHandleReadContext.RootGuard => "root-guard",
        WindowHandleReadContext.RootProof => "root-proof",
        WindowHandleReadContext.RootIdentity => "root-identity",
        WindowHandleReadContext.WalkNodeGuard => "walk-node-guard",
        WindowHandleReadContext.WalkNodeIdentity => "walk-node-identity",
        WindowHandleReadContext.WalkChildGuard => "walk-child-guard",
        WindowHandleReadContext.WalkChildIdentity => "walk-child-identity",
        WindowHandleReadContext.WalkCrossRootLeft => "walk-cross-root-left",
        WindowHandleReadContext.WalkCrossRootRight => "walk-cross-root-right",
        WindowHandleReadContext.WalkParentLeft => "walk-parent-left",
        WindowHandleReadContext.WalkParentRight => "walk-parent-right",
        WindowHandleReadContext.FenceRootGuard => "fence-root-guard",
        WindowHandleReadContext.FenceRootProof => "fence-root-proof",
        WindowHandleReadContext.FenceRootLeft => "fence-root-left",
        WindowHandleReadContext.FenceRootRight => "fence-root-right",
        WindowHandleReadContext.TargetGuard => "target-guard",
        WindowHandleReadContext.TargetIdentity => "target-identity",
        WindowHandleReadContext.ContainerGuard => "container-guard",
        WindowHandleReadContext.ContainerIdentity => "container-identity",
        WindowHandleReadContext.TargetChainLeft => "target-chain-left",
        WindowHandleReadContext.TargetChainRight => "target-chain-right",
        WindowHandleReadContext.TargetChainParent => "target-chain-parent",
        WindowHandleReadContext.ContainerChainLeft => "container-chain-left",
        WindowHandleReadContext.ContainerChainRight => "container-chain-right",
        WindowHandleReadContext.ContainerChainParent => "container-chain-parent",
        WindowHandleReadContext.SelectionContainerGuard => "selection-container-guard",
        WindowHandleReadContext.SelectionContainerLeft => "selection-container-left",
        WindowHandleReadContext.SelectionContainerRight => "selection-container-right",
        _ => throw new CaptureException(CaptureCode.InvalidObservation),
    };
    internal static WindowHandleReadContext ContextFromLabel(string label) => label switch
    {
        "root-guard" => WindowHandleReadContext.RootGuard,
        "root-proof" => WindowHandleReadContext.RootProof,
        "root-identity" => WindowHandleReadContext.RootIdentity,
        "walk-node-guard" => WindowHandleReadContext.WalkNodeGuard,
        "walk-node-identity" => WindowHandleReadContext.WalkNodeIdentity,
        "walk-child-guard" => WindowHandleReadContext.WalkChildGuard,
        "walk-child-identity" => WindowHandleReadContext.WalkChildIdentity,
        "walk-cross-root-left" => WindowHandleReadContext.WalkCrossRootLeft,
        "walk-cross-root-right" => WindowHandleReadContext.WalkCrossRootRight,
        "walk-parent-left" => WindowHandleReadContext.WalkParentLeft,
        "walk-parent-right" => WindowHandleReadContext.WalkParentRight,
        "fence-root-guard" => WindowHandleReadContext.FenceRootGuard,
        "fence-root-proof" => WindowHandleReadContext.FenceRootProof,
        "fence-root-left" => WindowHandleReadContext.FenceRootLeft,
        "fence-root-right" => WindowHandleReadContext.FenceRootRight,
        "target-guard" => WindowHandleReadContext.TargetGuard,
        "target-identity" => WindowHandleReadContext.TargetIdentity,
        "container-guard" => WindowHandleReadContext.ContainerGuard,
        "container-identity" => WindowHandleReadContext.ContainerIdentity,
        "target-chain-left" => WindowHandleReadContext.TargetChainLeft,
        "target-chain-right" => WindowHandleReadContext.TargetChainRight,
        "target-chain-parent" => WindowHandleReadContext.TargetChainParent,
        "container-chain-left" => WindowHandleReadContext.ContainerChainLeft,
        "container-chain-right" => WindowHandleReadContext.ContainerChainRight,
        "container-chain-parent" => WindowHandleReadContext.ContainerChainParent,
        "selection-container-guard" => WindowHandleReadContext.SelectionContainerGuard,
        "selection-container-left" => WindowHandleReadContext.SelectionContainerLeft,
        "selection-container-right" => WindowHandleReadContext.SelectionContainerRight,
        _ => throw new CaptureException(CaptureCode.InvalidObservation),
    };
    internal static void RequireReadContext(string? label, WindowHandleReadContext? context)
    {
        if (label == "window-handle")
        {
            if (context is { } value) _ = ContextLabel(value);
            else Refuse();
        }
        else if (context != null) Refuse();
    }
    private static void RequireContextLocation(string caseId, string stage, string? label, WindowHandleReadContext? context,
        string? admissionCheck, string? admissionGuard)
    {
        RequireReadContext(label, context);
        if (context is not { } value) return;
        string text = ContextLabel(value);
        if (stage != "setup" || !FixedCaptureSuite.CaseIds.Contains(caseId, StringComparer.Ordinal) ||
            admissionCheck != null || admissionGuard != null) Refuse();
        if ((text.StartsWith("container-", StringComparison.Ordinal) || text.StartsWith("selection-container-", StringComparison.Ordinal)) &&
            caseId is not ("selection" or "tab" or "combo")) Refuse();
        if (text.StartsWith("walk-cross-root-", StringComparison.Ordinal) &&
            caseId is not ("combo" or "modal-cancel" or "modal-confirm")) Refuse();
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
