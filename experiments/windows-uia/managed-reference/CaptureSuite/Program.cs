using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DualSurface.UiaCapture;

internal static class Program
{
    [MTAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args.SequenceEqual(new[] { "--binding" }))
            {
                Console.WriteLine(JsonSerializer.Serialize(new { sourceDigest = SuiteFreeze.SourceBinding(SuiteFreeze.Repository()) }, CaptureEncoding.Json));
                return 0;
            }
            if (args.SequenceEqual(new[] { "--unit" }))
            {
                int cases = SuiteUnitCases.Run();
                Console.WriteLine(JsonSerializer.Serialize(new { kind = "p4.3-native-suite-unit", cases, nativeExecuted = false }, CaptureEncoding.Json));
                return 0;
            }
            if (args.Length != 3 || args[0] != "--native" || args[1] != "--output") return 64;
            string repo = SuiteFreeze.Repository();
            SuitePins pins = SuiteFreeze.Admit(repo); // missing/unapproved freeze fails BEFORE launch
            var diagnostics = new FailureDiagnostics();
            FixedCaptureSuite? suite = null;
            try
            {
                suite = new FixedCaptureSuite(repo, args[2], pins, diagnostics);
                suite.Execute();
                Console.WriteLine("p4.3_native_suite_captured"); // independent JS verification is still required
                return 0;
            }
            catch (Exception error)
            {
                diagnostics.Latch(error); // BEFORE cleanup, never using/Dispose masking
                try { suite?.Stop(); } catch { /* Stop independently latches closed cleanup faults. */ }
                bool published = diagnostics.TryPublish(); // worker only; one admitted CreateNew attempt
                Console.Error.WriteLine(diagnostics.PublicationAttempted && !published
                    ? "p4.3_native_suite_failed_metadata_withheld" : "p4.3_native_suite_failed");
                return 70;
            }
        }
        catch
        {
            Console.Error.WriteLine("p4.3_native_suite_failed"); // early entry has no output capability
            return 70;
        }
    }
}

internal sealed class FixedCaptureSuite : IDisposable
{
    internal static readonly string[] CaseIds = ["initial", "invoke", "value", "toggle-check", "toggle-repeat", "selection",
        "radio", "tab", "expand", "range", "combo", "disabled", "disabled-toggle", "readonly", "range-boundary",
        "sensitive-unsupported-hidden-offscreen", "injection", "control-replacement", "modal-cancel", "modal-confirm",
        "window-replacement", "process-restart"];
    internal static readonly string[] CaptureIds = ["initial", "initial-repeat", "invoke", "value-before", "value", "value-repeat",
        "toggle-check", "toggle-repeat", "selection", "radio", "tab", "expand", "range", "combo-expanded", "combo-collapsed",
        "combo", "disabled", "disabled-toggle", "readonly", "range-boundary", "sensitive-unsupported-hidden-offscreen", "injection",
        "replacement-before", "control-replacement", "modal-cancel-open", "modal-cancel", "modal-confirm-open", "modal-confirm",
        "window-before", "window-replacement", "restart-before", "process-restart"];
    private sealed record CaseEvidence(string Id, string Probe, string? ProbeBeforeDigest);
    private sealed record CaptureEvidence(string Id, string PublicationDigest, string PublicEnvelopeDigest,
        string ComparisonEnvelopeDigest, string OracleDigest, long ResetOrdinal, int Roots, string Auxiliary);
    private readonly string repo, output, recordsDirectory;
    private readonly SuitePins pins;
    private readonly FailureDiagnostics diagnostics;
    private readonly FixtureRecords records;
    private readonly List<CaseEvidence> cases = [];
    private readonly List<CaptureEvidence> captures = [];
    private readonly List<bool> toggleObserved = [];
    private Process? owned;
    private Task? stdout, stderr;
    private OwnedWindowsAdmission? admission;
    private TrustedSetup? setup;
    private ReadOnlyCollector? collector;
    private CaptureBudget? sharedSetupBudget;
    private bool stopAttempted;
    public FixedCaptureSuite(string repo, string output, SuitePins pins, FailureDiagnostics diagnostics)
    {
        this.repo = repo; this.output = OwnedFiles.CanonicalDirectory(output); this.pins = pins; this.diagnostics = diagnostics;
        AdmitOutput(this.output);
        if (Directory.EnumerateFileSystemEntries(this.output).Any()) Refuse();
        diagnostics.AdmitOutput(this.output, pins);
        recordsDirectory = Path.Combine(this.output, "fixture-records");
        Directory.CreateDirectory(recordsDirectory); OwnedFiles.RequireDirectory(recordsDirectory);
        records = new(recordsDirectory);
    }
    internal static void AdmitOutput(string output)
    {
        string prefix = OwnedFiles.CanonicalDirectory(Path.Combine(Path.GetTempPath(), "dual-surface-ui-native-evidence")) + Path.DirectorySeparatorChar;
        string full = OwnedFiles.CanonicalDirectory(output);
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
            !Regex.IsMatch(full[prefix.Length..], "^p4\\.3-capture-[a-f0-9]{32}\\\\(first|repeat)$", RegexOptions.CultureInvariant)) Refuse();
        OwnedFiles.RequireDirectory(full);
    }
    public void Execute()
    {
        Launch();
        SetCase("initial"); Reset(); Save("initial"); Save("initial-repeat"); AddCase("initial");
        Change("invoke", () => Driver.Invoke("invoke"), state => Int(state, "count") == 1);
        SetCase("value"); Reset(); Save("value-before");
        ChangeAfterReset(() => Driver.Value("value", "updated"), state => Text(state, "value") == "updated");
        Save("value"); Save("value-repeat"); AddCase("value");
        Change("toggle-check", () => Driver.Toggle("toggle"), state => Bool(state, "toggle"));
        SetCase("toggle-repeat"); Reset();
        foreach (bool expected in new[] { true, false, true, false, true, false })
        {
            ChangeAfterReset(() => Driver.Toggle("toggle"), state => Bool(state, "toggle") == expected);
            toggleObserved.Add(State().Toggle);
        }
        Save("toggle-repeat"); AddCase("toggle-repeat");
        Change("selection", () => Driver.Select("selection-b"), state => Text(state, "selection") == "selection-b");
        Change("radio", () => Driver.Select("radio-b"), state => Text(state, "radio") == "radio-b");
        Change("tab", () => Driver.Select("tab-b"), state => Text(state, "tab") == "tab-b");
        Change("expand", () => Driver.Expand("expand"), state => Bool(state, "expanded"));
        Change("range", () => Driver.Range(7), state => state.GetProperty("range").GetDouble() == 7);
        SetCase("combo"); Reset();
        Within(() => { Driver.Expand("combo"); WaitAuxiliary(ExpectedAuxiliary.Popup); if (!Driver.ComboExpanded(ExpectedAuxiliary.Popup)) Refuse(); });
        Save("combo-expanded", ExpectedAuxiliary.Popup);
        Within(() => { Driver.CollapseCombo(ExpectedAuxiliary.Popup); WaitNoAuxiliary(); if (Driver.ComboExpanded(ExpectedAuxiliary.None)) Refuse(); });
        Save("combo-collapsed");
        ChangeAfterReset(() =>
        {
            Driver.Expand("combo"); WaitAuxiliary(ExpectedAuxiliary.Popup); Driver.Select("combo-b", ExpectedAuxiliary.Popup);
            // WPF selection may synchronously close its popup. Classify only as
            // a wake cue, then require the exact full frame and explicit state;
            // never re-admit a missing popup via catch/default fallback.
            Driver.CollapseCombo(CurrentComboMode()); WaitNoAuxiliary();
        }, state => Text(state, "combo") == "combo-b");
        Save("combo"); AddCase("combo");
        foreach (string id in new[] { "disabled", "disabled-toggle", "readonly", "range-boundary" })
        {
            SetCase(id); Reset(); var before = State();
            Within(() => { if (!Driver.ProviderProbe(id)) Refuse(); });
            var after = State(); if (!before.Same(after)) Refuse();
            diagnostics.SetStage("publication");
            WriteArtifact(id + ".probe-before.json", before.Bytes, 4096);
            Save(id); AddCase(id, "provider_rejected_unchanged", SuiteFreeze.Digest(before.Bytes));
        }
        SetCase("sensitive-unsupported-hidden-offscreen"); Reset(); Save(diagnostics.Case); AddCase(diagnostics.Case);
        Change("injection", () => Driver.Invoke("injection"), state => Int(state, "count") == 1);
        SetCase("control-replacement"); Reset(); Save("replacement-before");
        ChangeAfterReset(() => Driver.Invoke("replace"), state => Int(state, "generation") == 2);
        Save("control-replacement"); AddCase("control-replacement");
        foreach (string id in new[] { "modal-cancel", "modal-confirm" })
        {
            SetCase(id); Reset();
            Within(() => { Driver.Invoke("modal"); WaitAuxiliary(ExpectedAuxiliary.Modal); });
            Save(id + "-open", ExpectedAuxiliary.Modal);
            ChangeAfterReset(() => Driver.Invoke(id, ExpectedAuxiliary.Modal), state => Text(state, "modalResult") ==
                (id == "modal-cancel" ? "cancelled" : "confirmed"));
            Save(id); AddCase(id);
        }
        SetCase("window-replacement"); Reset(); Save("window-before");
        nint oldWindow = Admitted.Main; diagnostics.SetStage("setup"); long oldEpoch = Epoch();
        Within(() =>
        {
            Driver.Invoke("replace-window");
            Wait(() => !IsWindow(oldWindow) && Epoch() > oldEpoch && Int(State().Value, "revision") == 0);
            var retiredCollector = Collector; collector = null; retiredCollector.Dispose();
            admission = diagnostics.At("setup-admission", () => new OwnedWindowsAdmission(Current, SetupBudget));
            setup = new(admission, () => SetupBudget, diagnostics);
            if (admission.Main == oldWindow) Refuse(); collector = diagnostics.At("collector-start", () => new ReadOnlyCollector(admission, Epoch));
        });
        Save("window-replacement"); AddCase("window-replacement");
        SetCase("process-restart"); Reset(); Save("restart-before");
        diagnostics.SetStage("setup");
        long oldBirth = Admitted.Birth, beforeRestartEpoch = Epoch();
        oldWindow = Admitted.Main; Stop(); if (IsWindow(oldWindow)) Refuse();
        Launch();
        if (Admitted.Birth == oldBirth || Epoch() <= beforeRestartEpoch) Refuse();
        Save("process-restart"); AddCase("process-restart");
        if (!cases.Select(c => c.Id).SequenceEqual(CaseIds) || !captures.Select(c => c.Id).SequenceEqual(CaptureIds)) Refuse();
        Stop(); // all owned processes/streams close before writing a complete report
        diagnostics.SetStage("report");
        var report = new
        {
            schemaVersion = "0.1", kind = "p4.3-native-capture-suite", sourceDigest = pins.SourceDigest,
            collectorBinaryDigest = pins.CollectorBinaryDigest, fixtureBinaryDigest = pins.FixtureBinaryDigest,
            recordedAt = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
            host = new { osBuild = Environment.OSVersion.Version.Build + "." + Environment.OSVersion.Version.Revision,
                architecture = RuntimeInformation.ProcessArchitecture.ToString(), runtime = RuntimeInformation.FrameworkDescription,
                culture = CultureInfo.CurrentCulture.Name, uiCulture = CultureInfo.CurrentUICulture.Name },
            limits = new { nodes = 256, depth = 16, children = 64, roots = 2, nativeCandidates = 64, enumerationPasses = 2,
                characters = 256, valueCharacters = 64, textCharacters = 131072, bindings = 256, descriptors = 64,
                auxiliaryNodes = 64, snapshotBytes = 262144, reportBytes = 1048576, observationSeconds = 10, workerSeconds = 240 },
            cases, captures, toggleObserved,
        };
        // Preserve required explicit null ProbeBeforeDigest fields; foundation's
        // nullable semantic-state omission policy stays unchanged for snapshots.
        var complete = JsonSerializer.SerializeToElement(report, new JsonSerializerOptions
            { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, MaxDepth = 16 });
        diagnostics.At("report-write", () => OwnedFiles.WriteNew(Path.Combine(output, "suite-report.json"), CaptureEncoding.Encode(complete, CaptureLimits.ReportBytes), CaptureLimits.ReportBytes));
    }
    private void Save(string id, ExpectedAuxiliary auxiliary = ExpectedAuxiliary.None)
    {
        diagnostics.SetStage("capture");
        if (captures.Count >= CaptureIds.Length || CaptureIds[captures.Count] != id) Refuse();
        var before = State(); long epoch = Epoch();
        CapturePublication publication = diagnostics.At("capture-call", () => Collector.Capture(auxiliary));
        var after = State();
        if (!before.Same(after) || Epoch() != epoch) Refuse();
        byte[] capture = CaptureEncoding.Encode(publication, CaptureLimits.ReportBytes);
        byte[] publicEnvelope = Envelope(publication.PublicSnapshot), comparisonEnvelope = Envelope(publication.ComparableSnapshot);
        diagnostics.SetStage("publication");
        WriteArtifact(id + ".capture.json", capture, CaptureLimits.ReportBytes);
        WriteArtifact(id + ".public-response.json", publicEnvelope, CaptureLimits.SnapshotBytes);
        WriteArtifact(id + ".comparison-response.json", comparisonEnvelope, CaptureLimits.SnapshotBytes);
        WriteArtifact(id + ".oracle.json", after.Bytes, 4096);
        // Derived from successful collector's exact admission contract, not an
        // additional native enumeration pass or separately observed raw frame.
        captures.Add(new(id, SuiteFreeze.Digest(capture), SuiteFreeze.Digest(publicEnvelope), SuiteFreeze.Digest(comparisonEnvelope),
            SuiteFreeze.Digest(after.Bytes), epoch, auxiliary == ExpectedAuxiliary.None ? 1 : 2, auxiliary.ToString().ToLowerInvariant()));
        byte[] Envelope(SemanticSnapshot snapshot) => CaptureEncoding.Encode(new { schemaVersion = "0.1", kind = "snapshot-response",
            requestId = "p4.3-suite-" + id, sessionRef = "p4.3-suite-session", surfaceRef = snapshot.SurfaceId, snapshot }, CaptureLimits.SnapshotBytes);
    }
    private void Change(string id, Action change, Func<JsonElement, bool> predicate)
    { SetCase(id); Reset(); ChangeAfterReset(change, predicate); Save(id); AddCase(id); }
    private void ChangeAfterReset(Action change, Func<JsonElement, bool> predicate)
    { diagnostics.SetStage("setup"); Within(() => { change(); Wait(() => predicate(State().Value)); }); }
    private void Reset()
    {
        diagnostics.SetStage("setup");
        Within(() =>
        {
            Driver.CollapseCombo(ExpectedAuxiliary.None);
            long old = Epoch(); Driver.Invoke("reset");
            Wait(() => Epoch() > old && Initial(State().Value));
            if (Driver.ComboExpanded(ExpectedAuxiliary.None)) Refuse();
        });
    }
    private void Launch()
    {
        diagnostics.SetStage("startup");
        Within(() =>
        {
            long priorEpoch = diagnostics.At("record-read", records.HasStartupRecords) ? Epoch() : 0;
            var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new CaptureException(CaptureCode.Unavailable))
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (string arg in new[] { Path.Combine(repo, "fixtures/native/windows-app/Fixture/bin/Release/net10.0-windows/DualSurface.Fixture.dll"),
                "--evidence-directory", recordsDirectory, "--seed", "p4.2-seed-1" }) start.ArgumentList.Add(arg);
            stopAttempted = false; // new explicitly owned process lifetime
            owned = diagnostics.At("fixture-start", () => Process.Start(start) ?? throw new CaptureException(CaptureCode.Unavailable));
            stdout = Drain(owned.StandardOutput); stderr = Drain(owned.StandardError);
            diagnostics.At("fixture-ready", () => Wait(() => { Current.Refresh(); return Current.MainWindowHandle != 0 &&
                diagnostics.At("record-read", records.HasStartupRecords) && Epoch() > priorEpoch; }));
            admission = diagnostics.At("setup-admission", () => new OwnedWindowsAdmission(Current, SetupBudget));
            setup = new(admission, () => SetupBudget, diagnostics);
            collector = diagnostics.At("collector-start", () => new ReadOnlyCollector(admission, Epoch));
            if (!Initial(State().Value)) Refuse();
        });
    }
    private static async Task Drain(StreamReader reader)
    {
        var buffer = new char[257]; int total = 0;
        while (true)
        {
            int read = await reader.ReadAsync(buffer);
            if (read == 0) break;
            total += read; if (total > 256) Refuse();
        }
    }
    private void WaitAuxiliary(ExpectedAuxiliary expected)
    {
        // GW_ENABLEDPOPUP is only a bounded startup wake cue on the admitted
        // owned main, NEVER uniqueness/ownership proof or provider admission.
        // The complete strict frame is mandatory before any auxiliary UIA read.
        Wait(() => { nint candidate = GetWindow(Admitted.Main, 6); return candidate != 0 && candidate != Admitted.Main && IsWindow(candidate); });
        _ = Admitted.Observe(expected, SetupBudget);
    }
    private void WaitNoAuxiliary()
    {
        Wait(() => AuxiliaryCue(Admitted.Main, GetWindow(Admitted.Main, 6)) == ExpectedAuxiliary.None);
        _ = Admitted.Observe(ExpectedAuxiliary.None, SetupBudget);
    }
    private ExpectedAuxiliary CurrentComboMode()
    {
        SetupBudget.CheckTime();
        ExpectedAuxiliary cue = AuxiliaryCue(Admitted.Main, GetWindow(Admitted.Main, 6));
        _ = Admitted.Observe(cue, SetupBudget); // complete strict frame BEFORE provider read
        bool expanded = Driver.ComboExpanded(cue);
        if (expanded != (cue == ExpectedAuxiliary.Popup)) Refuse();
        return cue;
    }
    internal static ExpectedAuxiliary AuxiliaryCue(nint main, nint candidate)
    {
        if (main == 0) Refuse();
        return candidate == 0 || candidate == main ? ExpectedAuxiliary.None : ExpectedAuxiliary.Popup;
    }
    private void Wait(Func<bool> predicate)
    {
        var budget = SetupBudget;
        while (true)
        {
            budget.CheckTime();
            if (Current.HasExited) throw new CaptureException(CaptureCode.Unavailable);
            bool complete = predicate(); budget.CheckTime(); if (complete) return;
            Thread.Sleep(25);
            budget.CheckTime();
        }
    }
    private CaptureBudget SetupBudget => sharedSetupBudget ?? throw new CaptureException(CaptureCode.Unavailable);
    private void Within(Action operation)
    {
        if (sharedSetupBudget != null) Refuse(); // fixed serial caller, no reentrancy
        sharedSetupBudget = new CaptureBudget();
        try { SetupBudget.CheckTime(); operation(); SetupBudget.CheckTime(); }
        finally { sharedSetupBudget = null; }
    }
    private static bool Initial(JsonElement value) => Int(value, "revision") == 0 && Int(value, "count") == 0 &&
        Text(value, "value") == "initial" && !Bool(value, "toggle") && Text(value, "selection") == "selection-a" &&
        Text(value, "combo") == "combo-a" && Text(value, "radio") == "radio-a" && Text(value, "tab") == "tab-a" &&
        !Bool(value, "expanded") && value.GetProperty("range").GetDouble() == 2 && Int(value, "generation") == 1 && Text(value, "modalResult") == "none";
    private static int Int(JsonElement value, string key) => value.GetProperty(key).GetInt32();
    private static bool Bool(JsonElement value, string key) => value.GetProperty(key).GetBoolean();
    private static string? Text(JsonElement value, string key) => value.GetProperty(key).GetString();
    private void SetCase(string id) => diagnostics.SetCase(id);
    private FixtureState State() => diagnostics.At("record-read", records.State);
    private long Epoch() => diagnostics.At("record-read", records.ResetOrdinal);
    private void WriteArtifact(string name, byte[] bytes, int cap)
        => diagnostics.At("artifact-write", () => OwnedFiles.WriteNew(Path.Combine(output, name), bytes, cap));
    private void AddCase(string id, string probe = "not_probed", string? before = null)
    { if (cases.Count >= CaseIds.Length || CaseIds[cases.Count] != id) Refuse(); cases.Add(new(id, probe, before)); }
    private Process Current => owned ?? throw new CaptureException(CaptureCode.Unavailable);
    private OwnedWindowsAdmission Admitted => admission ?? throw new CaptureException(CaptureCode.Unavailable);
    private TrustedSetup Driver => setup ?? throw new CaptureException(CaptureCode.Unavailable);
    private ReadOnlyCollector Collector => collector ?? throw new CaptureException(CaptureCode.Unavailable);
    public void Stop()
    {
        if (stopAttempted) return;
        Process? current = owned;
        Action[] closures = current == null ? [() => collector?.Dispose()] :
        [
            () => collector?.Dispose(),
            () =>
            { if (!current.HasExited) { current.Kill(entireProcessTree: true); if (!current.WaitForExit(5000)) Refuse(); } },
            () => stdout?.GetAwaiter().GetResult(), () => stderr?.GetAwaiter().GetResult(), current.Dispose,
        ];
        bool clean;
        try { clean = diagnostics.CleanupOnce(ref stopAttempted, closures); }
        finally
        {
            collector = null; admission = null; setup = null; owned = null; stdout = null; stderr = null;
        }
        if (!clean) throw new InvalidOperationException("owned_cleanup_refused"); // primary already latched
    }
    public void Dispose() => Stop();
    [DllImport("user32.dll")] private static extern bool IsWindow(nint window);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint window, uint command);
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
}
