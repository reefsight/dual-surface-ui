using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows.Automation;

namespace DualSurface.UiaReference;

internal static class Program
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static string Stage { get; set; } = "input";
    [MTAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args.SequenceEqual(new[] { "--unit" }))
            {
                Stage = "unit";
                Console.WriteLine(JsonSerializer.Serialize(new { kind = "p4.3-identity-unit", cases = UnitCases.Run() }, Json));
                return 0;
            }
            if (args.Length != 5 || args[0] != "--native" || args[1] != "--repo" || args[3] != "--output") return 64;
            using var fixture = new OwnedFixture(args[2], args[4]);
            var cases = fixture.Execute();
            byte[] report = JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = "0.1", kind = "p4.3-identity-native-development", slice = "identity-decision-only",
                recordedAt = DateTimeOffset.UtcNow.ToString("O"),
                host = new { os = "windows", osVersion = Environment.OSVersion.Version.ToString(), architecture = RuntimeInformation.ProcessArchitecture.ToString() },
                limits = new { nodes = IdentityLimits.Nodes, depth = IdentityLimits.Depth, children = IdentityLimits.Children,
                    characters = IdentityLimits.Characters, runtimeIdParts = IdentityLimits.RuntimeIdParts, bindings = IdentityLimits.Bindings,
                    totalCharacters = IdentityLimits.TotalCharacters, observationMilliseconds = 10000, workerMilliseconds = 240000 },
                fixtureDigest = OwnedFixture.FixtureDigest,
                nativeCases = cases,
                nonClaims = new[] { "not a guarded executor", "not full P4.3 acceptance", "no real secure-desktop or alternate-session transition",
                    "no provider-internal allocation bound", "no Rust or production-language selection", "not public native protocol output" }
            }, Json);
            if (report.Length > IdentityLimits.ReportBytes) throw new GuardException(GuardCode.ResourceExceeded);
            File.WriteAllBytes(Path.Combine(fixture.Output, "identity-report.json"), report);
            Console.WriteLine("p4.3_identity_native_development_passed");
            return 0;
        }
        catch (Exception error)
        {
            string code = error is GuardException guard ? guard.Code.ToString() : error is TimeoutException ? "Timeout" : "Unexpected";
            // Only closed local categories, never exception text, paths, IDs or stacks.
            Console.Error.WriteLine("p4.3_identity_failed:" + Stage + ":" + code);
            return 70;
        }
    }
}

internal sealed record NativeCase(string Id, string Decision, bool StateUnchanged, string ProviderProbe);
internal sealed class OwnedFixture : IDisposable
{
    public const string FixtureDigest = "05491f5a44d01e9a25f5098d86a4919abb9bb8d6f4d44a4050dcf2560107161d";
    private readonly Process process;
    private readonly Task<string> stdout, stderr;
    public string Output { get; }

    public OwnedFixture(string repo, string output)
    {
        Output = Path.GetFullPath(output);
        string evidenceBase = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "dual-surface-ui-native-evidence")) + Path.DirectorySeparatorChar;
        if (!Output.StartsWith(evidenceBase, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(Output) ||
            Directory.EnumerateFileSystemEntries(Output).Any() || IsLink(Output) || IsLink(evidenceBase.TrimEnd(Path.DirectorySeparatorChar)))
            throw new GuardException(GuardCode.NotAuthorized);
        string fixture = Path.Combine(Path.GetFullPath(repo), "fixtures/native/windows-app/Fixture/bin/Release/net10.0-windows/DualSurface.Fixture.dll");
        byte[] bytes = ReadBounded(fixture, 8388608);
        if (Convert.ToHexStringLower(SHA256.HashData(bytes)) != FixtureDigest) throw new GuardException(GuardCode.NotAuthorized);
        // Environment.ProcessPath is the pinned host that launched this worker;
        // the runner checks the SDK digest marker/version before launching.
        var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new GuardException(GuardCode.NotAuthorized))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string argument in new[] { fixture, "--evidence-directory", Output, "--seed", "p4.2-seed-1" }) start.ArgumentList.Add(argument);
        Program.Stage = "launch";
        process = Process.Start(start) ?? throw new GuardException(GuardCode.SurfaceUnavailable);
        stdout = process.StandardOutput.ReadToEndAsync(); stderr = process.StandardError.ReadToEndAsync();
    }

    public IReadOnlyList<NativeCase> Execute()
    {
        var cases = new List<NativeCase>();
        Program.Stage = "launch-window";
        Wait(() => { process.Refresh(); return process.MainWindowHandle != 0; });
        Program.Stage = "launch-state"; Wait(() => Records("state").Length > 0 && Records("reset-ack").Length > 0);
        var native = new NativeObservation(process, ResetEpoch);
        using var catalog = new IdentityCatalog(native.Capture);
        var target = new HostTarget("dynamic-a", "Button", "Invoke", "fixture-window");
        Program.Stage = "current";
        var receipt = catalog.Discover(target);
        CheckNoMutation("current-owned-target", () => catalog.Validate(receipt), GuardCode.None);
        Program.Stage = "removed-peer";
        var retained = native.SetupElement("dynamic-a");
        Setup(native, "replace"); Wait(() => State().GetProperty("generation").GetInt32() == 2);
        string probe;
        try { probe = retained.TryGetCurrentPattern(InvokePattern.Pattern, out _) ? "pattern_readable" : "pattern_absent"; }
        catch (ElementNotAvailableException) { probe = "unavailable"; }
        // Do not invoke the retained peer. P4.2 separately demonstrated its
        // callability; this decision-only slice must not mutate through it.
        CheckNoMutation("removed-peer-receipt", () => catalog.Validate(receipt), GuardCode.StaleRevision, probe);
        HealthyRecovery("replacement-healthy-recovery", new("dynamic-b", "Button", "Invoke", "fixture-window"));
        Program.Stage = "reset";
        var invoke = new HostTarget("invoke", "Button", "Invoke", "fixture-window");
        receipt = catalog.Discover(invoke); long priorEpoch = ResetEpoch();
        Setup(native, "reset"); Wait(() => ResetEpoch() > priorEpoch);
        CheckNoMutation("reset-receipt", () => catalog.Validate(receipt), GuardCode.StaleRevision);
        HealthyRecovery("reset-healthy-recovery", invoke);
        Program.Stage = "disabled";
        CheckDiscoveryDenied("disabled-target", new("disabled", "Button", "Invoke", "fixture-window"), GuardCode.PreconditionFailed);
        Program.Stage = "readonly";
        CheckDiscoveryDenied("readonly-target", new("readonly", "Edit", "Value", "fixture-window"), GuardCode.PreconditionFailed);
        Program.Stage = "sensitive";
        CheckDiscoveryDenied("sensitive-target", new("sensitive", "Edit", "Value", "fixture-window"), GuardCode.UnsupportedAction);
        Program.Stage = "missing";
        CheckDiscoveryDenied("missing-target", new("missing", "Button", "Invoke", "fixture-window"), GuardCode.UnsupportedAction);
        Program.Stage = "unsupported";
        CheckDiscoveryDenied("unsupported-target", new("unsupported", "Custom", "Invoke", "fixture-window"), GuardCode.UnsupportedAction);
        Program.Stage = "offscreen";
        CheckDiscoveryDenied("offscreen-target", new("offscreen", "Button", "Invoke", "fixture-window"), GuardCode.PreconditionFailed);
        Program.Stage = "combo-wrapper";
        HealthyRecovery("collapsed-combo-qualified", new("combo", "ComboBox", "ExpandCollapse", "fixture-window"));
        Program.Stage = "window-replacement";
        receipt = catalog.Discover(invoke); process.Refresh(); nint oldWindow = process.MainWindowHandle;
        var oldRoot = AutomationElement.FromHandle(oldWindow);
        Setup(native, "replace-window");
        Wait(() => { process.Refresh(); return process.MainWindowHandle != 0 && process.MainWindowHandle != oldWindow; });
        Wait(() => WindowsAdmission.OwnedFormerWindowDestroyed(oldWindow));
        // New window writes a separate reset acknowledgement, with reset sequence
        // zero; catalog invalidation is not based solely on that fixture number.
        Wait(() => State().GetProperty("revision").GetInt32() == 0);
        try { probe = oldRoot.Current.AutomationId == "fixture-window" ? "metadata_readable" : "metadata_changed"; }
        catch (ElementNotAvailableException) { probe = "unavailable"; }
        CheckNoMutation("destroyed-window-receipt", () => catalog.Validate(receipt), GuardCode.StaleRevision, probe);
        HealthyRecovery("window-healthy-recovery", invoke);
        Program.Stage = "process-exit";
        receipt = catalog.Discover(invoke);
        process.Kill(entireProcessTree: true);
        if (!process.WaitForExit(5000)) throw new TimeoutException();
        CheckNoMutation("process-exit-receipt", () => catalog.Validate(receipt), GuardCode.SurfaceUnavailable);
        return cases.AsReadOnly();

        void CheckNoMutation(string id, Func<GuardDecision> decision, GuardCode expected, string providerProbe = "not_probed")
        {
            string before = State().GetRawText(); var result = decision();
            UnitCases.Check(result.Allowed == (expected == GuardCode.None) && result.Code == expected && State().GetRawText() == before);
            cases.Add(new(id, result.Code.ToString(), true, providerProbe));
        }
        void HealthyRecovery(string id, HostTarget definition)
        {
            var fresh = catalog.Discover(definition);
            CheckNoMutation(id, () => catalog.Validate(fresh), GuardCode.None);
        }
        void CheckDiscoveryDenied(string id, HostTarget definition, GuardCode expected)
        {
            CheckNoMutation(id, () =>
            {
                try { catalog.Discover(definition); return new(true, GuardCode.None); }
                catch (GuardException error) { return new(false, error.Code); }
            }, expected);
        }
    }

    private static void Setup(NativeObservation native, string id) =>
        ((InvokePattern)native.SetupElement(id).GetCurrentPattern(InvokePattern.Pattern)).Invoke();
    private string[] Records(string prefix)
    {
        string[] files = Directory.EnumerateFiles(Output, prefix + "-????.json").Take(513).ToArray();
        if (files.Length > 512) throw new GuardException(GuardCode.ResourceExceeded);
        if (files.Any(file => !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(file), "^" + prefix + "-[0-9]{4}\\.json$")))
            throw new GuardException(GuardCode.PreconditionFailed);
        return files.Order(StringComparer.Ordinal).ToArray();
    }
    private JsonElement Record(string prefix)
    {
        string[] files = Records(prefix);
        if (files.Length == 0) throw new GuardException(GuardCode.SurfaceUnavailable);
        using var json = JsonDocument.Parse(ReadBounded(files[^1], 4096), new JsonDocumentOptions { MaxDepth = 4 });
        var value = json.RootElement;
        if (value.GetProperty("schemaVersion").GetString() != "0.1" ||
            value.GetProperty("kind").GetString() != (prefix == "state" ? "p4.2-fixture-state" : "p4.2-reset-ack"))
            throw new GuardException(GuardCode.PreconditionFailed);
        return value.Clone();
    }
    private JsonElement State() => Record("state");
    private long ResetEpoch()
    {
        // Append-only acknowledgement record ordinal fences reset ABA and new
        // windows; the resettable sequence inside each JSON is not authority.
        string[] records = Records("reset-ack");
        if (records.Length == 0) throw new GuardException(GuardCode.SurfaceUnavailable);
        var ack = Record("reset-ack");
        if (ack.GetProperty("sequence").GetInt32() < 0) throw new GuardException(GuardCode.PreconditionFailed);
        return int.Parse(Path.GetFileName(records[^1]).AsSpan(10, 4), System.Globalization.CultureInfo.InvariantCulture);
    }
    private void Wait(Func<bool> predicate)
    {
        var clock = Stopwatch.StartNew();
        while (!predicate())
        {
            if (process.HasExited) throw new GuardException(GuardCode.SurfaceUnavailable);
            if (clock.Elapsed > IdentityLimits.ObservationTime) throw new TimeoutException();
            Thread.Sleep(25);
        }
    }
    private static bool IsLink(string path) => (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
    private static byte[] ReadBounded(string path, int maximum)
    {
        if (IsLink(path)) throw new GuardException(GuardCode.NotAuthorized);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > maximum) throw new GuardException(GuardCode.ResourceExceeded);
        var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new GuardException(GuardCode.ResourceExceeded);
        return bytes;
    }
    public void Dispose()
    {
        try { if (!process.HasExited) { process.Kill(entireProcessTree: true); process.WaitForExit(5000); } }
        finally
        {
            // Synthetic fixture emits only a fixed failure category. Do not echo
            // streams, and do not publish a partial successful report on failure.
            if (stdout.IsCompleted) _ = stdout.GetAwaiter().GetResult();
            if (stderr.IsCompleted) _ = stderr.GetAwaiter().GetResult();
            process.Dispose();
        }
    }
}
