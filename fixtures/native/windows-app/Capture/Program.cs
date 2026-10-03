using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using Microsoft.Win32;

namespace DualSurface.FixtureCapture;

internal static class Program
{
    [MTAThread]
    public static int Main(string[] args)
    {
        if (args.Length != 6 || args[0] != "--fixture" || args[2] != "--output" || args[4] != "--manifest") return 64;
        try
        {
            using var run = new CaptureRun(args[1], args[3], args[5]);
            run.Execute(); return 0;
        }
        catch (Exception error)
        {
            string category = error switch
            {
                ElementNotAvailableException => "unavailable", ElementNotEnabledException => "disabled",
                TimeoutException => "timeout", InvalidOperationException => "invalid_operation",
                ArgumentException => "argument", IOException => "io", _ => "unexpected"
            };
            Console.Error.WriteLine("fixture_capture_failed:" + CaptureRun.Stage + ":" + category); return 70;
        }
    }
}

internal sealed class CaptureRun : IDisposable
{
    public static string Stage { get; private set; } = "input";
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly string fixture, output;
    private readonly Dictionary<string, string> names;
    private readonly string salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly List<object> cases = [];
    private readonly List<ProviderEvent> events = [];
    private readonly object eventLock = new();
    private Process? process;
    private AutomationElement? root;
    private bool eventOverflow;
    private long eventSequence;
    private AutomationPropertyChangedEventHandler? eventHandler;

    public CaptureRun(string fixture, string output, string manifest)
    {
        this.fixture = Path.GetFullPath(fixture); this.output = Path.GetFullPath(output);
        if (Path.GetFileName(this.fixture) != "DualSurface.Fixture.dll" || !File.Exists(this.fixture) ||
            new FileInfo(this.fixture).Length > 8388608 || (File.GetAttributes(this.fixture) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
        if (!Directory.Exists(this.output) || Directory.EnumerateFileSystemEntries(this.output).Any() ||
            (File.GetAttributes(this.output) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
        if (new FileInfo(manifest).Length > 32768 || (File.GetAttributes(manifest) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
        byte[] bytes = File.ReadAllBytes(manifest);
        if (bytes.Length > 32768) throw new InvalidOperationException();
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
        names = document.RootElement.GetProperty("controls").EnumerateArray().ToDictionary(
            entry => entry.GetProperty("id").GetString()!, entry => entry.GetProperty("name").GetString()!);
        if (names.Count > 64 || names.Values.Any(name => name.Length > 256)) throw new InvalidOperationException();
    }

    public void Execute()
    {
        Stage = "launch";
        Launch();
        var baseline = State();
        var host = Host();
        cases.Add(new { id = "initial", disposition = "captured", before = baseline, after = baseline, raw = Tree(root!) });
        Subscribe();
        Change("invoke", () => Invoke("invoke"), state => state.GetProperty("count").GetInt32() == 1);
        Change("value", () => ((ValuePattern)Find("value").GetCurrentPattern(ValuePattern.Pattern)).SetValue("updated"), state => state.GetProperty("value").GetString() == "updated");
        Change("toggle-check", () => Toggle("toggle"), state => state.GetProperty("toggle").GetBoolean());
        // Use the same object through repeated transitions to expose stale provider state.
        Stage = "toggle-repeat";
        var toggle = Find("toggle");
        var togglePattern = (TogglePattern)toggle.GetCurrentPattern(TogglePattern.Pattern);
        var toggleStates = new List<bool>();
        for (int i = 0; i < 6; i++)
        {
            bool expected = i % 2 == 0;
            togglePattern.Toggle(); WaitState(state => state.GetProperty("toggle").GetBoolean() == expected);
            toggleStates.Add(togglePattern.Current.ToggleState == ToggleState.On);
        }
        if (!toggleStates.SequenceEqual(new[] { true, false, true, false, true, false })) throw new InvalidOperationException();
        cases.Add(new { id = "toggle-repeat", disposition = "verified", observed = toggleStates, before = baseline, after = State(), raw = Tree(root!) });
        Change("selection", () => Select("selection-b"), state => state.GetProperty("selection").GetString() == "selection-b");
        Change("radio", () => Select("radio-b"), state => state.GetProperty("radio").GetString() == "radio-b");
        Change("tab", () => Select("tab-b"), state => state.GetProperty("tab").GetString() == "tab-b");
        Change("expand", () => ((ExpandCollapsePattern)Find("expand").GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand(), state => state.GetProperty("expanded").GetBoolean());
        Change("range", () => ((RangeValuePattern)Find("range").GetCurrentPattern(RangeValuePattern.Pattern)).SetValue(7), state => state.GetProperty("range").GetDouble() == 7);
        Reset();
        Stage = "combo-expand";
        var combo = (ExpandCollapsePattern)Find("combo").GetCurrentPattern(ExpandCollapsePattern.Pattern);
        combo.Expand();
        Stage = "combo-select";
        AutomationElement? comboItem = null;
        Wait(() => { comboItem = root!.FindFirst(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.AutomationIdProperty, "combo-b"),
            new PropertyCondition(AutomationElement.IsSelectionItemPatternAvailableProperty, true))); return comboItem != null; });
        Stage = "combo-item-pattern";
        if (comboItem!.Current.ProcessId != process!.Id) throw new InvalidOperationException();
        var comboSelection = (SelectionItemPattern)comboItem.GetCurrentPattern(SelectionItemPattern.Pattern);
        Stage = "combo-item-select"; comboSelection.Select();
        Stage = "combo-state"; WaitState(state => state.GetProperty("combo").GetString() == "combo-b");
        Stage = "combo-collapse"; combo.Collapse();
        Stage = "combo-tree";
        cases.Add(new { id = "combo", disposition = "succeeded", before = baseline, after = State(), raw = Tree(root!) });
        Rejected("disabled", () => Invoke("disabled"));
        Rejected("disabled-toggle", () => Toggle("disabled-toggle"));
        Rejected("readonly", () => ((ValuePattern)Find("readonly").GetCurrentPattern(ValuePattern.Pattern)).SetValue("attempt"));
        Rejected("range-boundary", () => ((RangeValuePattern)Find("range").GetCurrentPattern(RangeValuePattern.Pattern)).SetValue(11));
        Reset();
        if (!Find("sensitive").Current.IsPassword || Find("unsupported").GetSupportedPatterns().Any(pattern =>
            new[] { InvokePattern.Pattern, ValuePattern.Pattern, TogglePattern.Pattern, SelectionItemPattern.Pattern, RangeValuePattern.Pattern }.Contains(pattern))) throw new InvalidOperationException();
        cases.Add(new { id = "sensitive-unsupported-hidden-offscreen", disposition = "metadata_only", before = baseline, after = State(), raw = Tree(root!) });
        Change("injection", () => Invoke("injection"), state => state.GetProperty("count").GetInt32() == 1);
        Reset();
        Stage = "control-replacement";
        var old = Find("dynamic-a"); var oldInstance = Identity(old);
        Invoke("replace"); WaitState(state => state.GetProperty("generation").GetInt32() == 2);
        var replacement = Find("dynamic-b");
        if (oldInstance == Identity(replacement) || root!.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, "dynamic-a")) != null) throw new InvalidOperationException();
        // A detached WPF peer can remain callable. Its removal, not a promised
        // provider exception, invalidates a binding. Probe only this synthetic
        // control to record the OS behavior, then restore the clean scenario.
        Stage = "control-replacement-stale-probe";
        var staleProbeBefore = State();
        bool stale = false;
        try
        {
            if (old.TryGetCurrentPattern(InvokePattern.Pattern, out object? retainedPattern)) ((InvokePattern)retainedPattern).Invoke();
            else stale = true;
        }
        catch (ElementNotAvailableException) { stale = true; }
        if (!stale) WaitState(state => state.GetProperty("count").GetInt32() == 1);
        else if (State().GetProperty("count").GetInt32() != 0) throw new InvalidOperationException();
        string staleProviderOutcome = stale ? "unavailable" : "retained_callable";
        var staleProbeAfter = State();
        Stage = "control-replacement-restore";
        Reset(); Invoke("replace"); WaitState(state => state.GetProperty("generation").GetInt32() == 2);
        if (root!.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "dynamic-a")) != null) throw new InvalidOperationException();
        cases.Add(new { id = "control-replacement", disposition = "old_binding_invalidated", staleProviderOutcome,
            staleProbeBefore, staleProbeAfter, before = baseline, after = State(), raw = Tree(root!) });
        Modal("modal-cancel", "cancelled"); Modal("modal-confirm", "confirmed");
        Reset();
        Stage = "window-replacement";
        var oldWindow = root!; string oldWindowRef = Identity(oldWindow);
        IntPtr oldWindowHandle = process!.MainWindowHandle;
        Unsubscribe(); Invoke("replace-window");
        Wait(() => { process!.Refresh(); return process.MainWindowHandle != IntPtr.Zero && Identity(AutomationElement.FromHandle(process.MainWindowHandle)) != oldWindowRef; });
        root = AutomationElement.FromHandle(process!.MainWindowHandle); WaitState(state => state.GetProperty("revision").GetInt32() == 0);
        if (Identity(root) == oldWindowRef) throw new InvalidOperationException();
        Wait(() => !IsWindow(oldWindowHandle));
        Stage = "window-replacement-metadata";
        string oldWindowProviderOutcome = "retained_metadata";
        try { if (oldWindow.Current.Name != names["fixture-window"]) throw new InvalidOperationException(); }
        catch (ElementNotAvailableException) { oldWindowProviderOutcome = "unavailable"; }
        cases.Add(new { id = "window-replacement", disposition = "identity_changed", oldWindowProviderOutcome,
            before = baseline, after = State(), raw = Tree(root) });
        Stage = "process-restart";
        string oldProcessRef = ProcessRef(); Stop(); Launch();
        if (ProcessRef() == oldProcessRef) throw new InvalidOperationException();
        var restarted = State();
        if (baseline.GetRawText() != restarted.GetRawText()) throw new InvalidOperationException();
        cases.Add(new { id = "process-restart", disposition = "identity_changed_state_reset", before = baseline, after = restarted, raw = Tree(root!) });
        lock (eventLock)
        {
            if (eventOverflow || events.Count == 0) throw new InvalidOperationException();
            byte[] report = JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = "0.1", kind = "p4.2-real-uia-capture", captureToolVersion = "0.1",
                seed = "p4.2-seed-1", fixtureBinaryDigest = "sha256:" + Hash(File.ReadAllBytes(fixture)),
                host, cases, events
            }, Json);
            if (report.Length > 1048576) throw new InvalidOperationException();
            File.WriteAllBytes(Path.Combine(output, "capture.json"), report);
        }
        Console.WriteLine("real_uia_capture_complete");
    }

    private void Launch()
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(fixture); start.ArgumentList.Add("--evidence-directory"); start.ArgumentList.Add(output);
        start.ArgumentList.Add("--seed"); start.ArgumentList.Add("p4.2-seed-1");
        process = Process.Start(start) ?? throw new InvalidOperationException();
        Stage = "launch-window";
        Wait(() => { process.Refresh(); if (process.HasExited) throw new InvalidOperationException(); return process.MainWindowHandle != IntPtr.Zero; });
        Stage = "launch-identity";
        root = AutomationElement.FromHandle(process.MainWindowHandle);
        if (root.Current.ProcessId != process.Id || root.Current.AutomationId != "fixture-window") throw new InvalidOperationException();
        Stage = "launch-state";
        WaitState(state => state.GetProperty("revision").GetInt32() == 0);
        Stage = "launch-reset-ack";
        Wait(() => { try { return ResetSequence() == 0; } catch (IOException) { return false; } });
    }
    private void Reset()
    {
        // Invoke is asynchronous. Revision can already be zero, so it cannot
        // acknowledge that a new reset has actually finished on the UI thread.
        int previous = ResetSequence();
        Invoke("reset"); Wait(() => ResetSequence() == previous + 1);
        WaitState(state => state.GetProperty("revision").GetInt32() == 0);
    }
    private int ResetSequence()
    {
        string path = LatestRecord("reset-ack");
        byte[] bytes = ReadBoundedFile(path, 256);
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 2 });
        var ack = document.RootElement;
        if (ack.GetProperty("schemaVersion").GetString() != "0.1" || ack.GetProperty("kind").GetString() != "p4.2-reset-ack") throw new InvalidOperationException();
        int sequence = ack.GetProperty("sequence").GetInt32();
        if (sequence is < 0 or > 1024) throw new InvalidOperationException();
        return sequence;
    }
    private void Change(string id, Action action, Func<JsonElement, bool> expected)
    {
        Stage = id + "-reset";
        Reset(); var before = State(); Stage = id + "-action"; action(); Stage = id + "-state"; WaitState(expected);
        Stage = id + "-tree";
        cases.Add(new { id, disposition = "succeeded", before, after = State(), raw = Tree(root!) });
        Stage = id + "-cleanup";
        Reset();
    }
    private void Rejected(string id, Action action)
    {
        Stage = id;
        Reset(); var before = State(); bool rejected = false;
        try { action(); }
        catch (ElementNotEnabledException) { rejected = true; }
        catch (InvalidOperationException) { rejected = true; }
        catch (ArgumentException) { rejected = true; }
        if (!rejected || State().GetRawText() != before.GetRawText()) throw new InvalidOperationException();
        cases.Add(new { id, disposition = "provider_rejected_unchanged", before, after = State(), raw = Tree(root!) });
    }
    private void Modal(string action, string result)
    {
        Stage = action + "-reset";
        Reset(); var before = State(); Invoke("modal");
        Stage = action + "-open";
        AutomationElement? modal = null;
        Wait(() =>
        {
            modal = FindModal();
            return modal != null;
        });
        Stage = action + "-tree"; var modalTree = Tree(modal!);
        var button = modal!.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, action));
        if (button == null || button.Current.ProcessId != process!.Id) throw new InvalidOperationException();
        Stage = action + "-invoke"; ((InvokePattern)button.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        Stage = action + "-state";
        WaitState(state => state.GetProperty("modalResult").GetString() == result);
        Stage = action + "-closed";
        Wait(() => FindModal() == null && root!.Current.IsEnabled);
        cases.Add(new { id = action, disposition = result, before, after = State(), modalRaw = modalTree, raw = Tree(root!) });
    }
    private AutomationElement? FindModal()
    {
        var condition = new AndCondition(new PropertyCondition(AutomationElement.ProcessIdProperty, process!.Id),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "modal-window"));
        // Owned WPF dialogs can be children of the owner in the UIA tree,
        // rather than direct desktop children. Never scan other app subtrees.
        return root!.FindFirst(TreeScope.Descendants, condition) ??
            AutomationElement.RootElement.FindFirst(TreeScope.Children, condition);
    }
    private AutomationElement Find(string id)
    {
        if (!names.ContainsKey(id)) throw new InvalidOperationException();
        var found = root!.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, id));
        if (found == null || found.Current.ProcessId != process!.Id) throw new InvalidOperationException();
        return found;
    }
    private void Invoke(string id) => ((InvokePattern)Find(id).GetCurrentPattern(InvokePattern.Pattern)).Invoke();
    private void Toggle(string id) => ((TogglePattern)Find(id).GetCurrentPattern(TogglePattern.Pattern)).Toggle();
    private void Select(string id)
    {
        if (!names.ContainsKey(id)) throw new InvalidOperationException();
        var item = root!.FindFirst(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.AutomationIdProperty, id),
            new PropertyCondition(AutomationElement.IsSelectionItemPatternAvailableProperty, true)));
        if (item == null || item.Current.ProcessId != process!.Id) throw new InvalidOperationException();
        ((SelectionItemPattern)item.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
    }

    private object Tree(AutomationElement window)
    {
        var nodes = new List<object>(); int visited = 0;
        var timer = Stopwatch.StartNew();
        void Visit(AutomationElement element, int depth, string? parent)
        {
            if (++visited > 512 || depth > 32 || timer.Elapsed > TimeSpan.FromSeconds(10)) throw new InvalidOperationException();
            var current = element.Current;
            if (current.ProcessId != process!.Id) throw new InvalidOperationException();
            string id = current.AutomationId;
            if (names.TryGetValue(id, out string? expectedName))
            {
                if (current.Name != expectedName || current.Name.Length > 256) throw new InvalidOperationException();
                var patterns = element.GetSupportedPatterns().Select(pattern => pattern.ProgrammaticName.Replace("PatternIdentifiers.Pattern", "")).Order().ToArray();
                bool sensitive = current.IsPassword;
                var values = new Dictionary<string, object>();
                if (!sensitive && element.TryGetCurrentPattern(ValuePattern.Pattern, out object? vp))
                {
                    var v = ((ValuePattern)vp).Current;
                    if (v.Value.Length > 64) throw new InvalidOperationException();
                    values["value"] = v.Value; values["readOnly"] = v.IsReadOnly;
                }
                if (!sensitive && element.TryGetCurrentPattern(TogglePattern.Pattern, out object? tp)) values["checked"] = ((TogglePattern)tp).Current.ToggleState == ToggleState.On;
                if (!sensitive && element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object? sp)) values["selected"] = ((SelectionItemPattern)sp).Current.IsSelected;
                if (!sensitive && element.TryGetCurrentPattern(SelectionPattern.Pattern, out object? selp))
                {
                    var selected = ((SelectionPattern)selp).Current.GetSelection();
                    if (selected.Length > 1 || selected.Any(item => item.Current.ProcessId != process!.Id || !names.ContainsKey(item.Current.AutomationId))) throw new InvalidOperationException();
                    values["selection"] = selected.Select(item => item.Current.AutomationId).ToArray();
                }
                if (!sensitive && element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out object? ep)) values["expanded"] = ((ExpandCollapsePattern)ep).Current.ExpandCollapseState == ExpandCollapseState.Expanded;
                if (!sensitive && element.TryGetCurrentPattern(RangeValuePattern.Pattern, out object? rp))
                {
                    var r = ((RangeValuePattern)rp).Current;
                    values["range"] = r.Value; values["minimum"] = r.Minimum; values["maximum"] = r.Maximum; values["readOnly"] = r.IsReadOnly;
                }
                nodes.Add(new
                {
                    id, parentId = parent, name = current.Name, controlType = current.ControlType.ProgrammaticName.Replace("ControlType.", ""),
                    frameworkId = current.FrameworkId, enabled = current.IsEnabled, offscreen = current.IsOffscreen,
                    focused = current.HasKeyboardFocus, sensitive, rectangle = current.BoundingRectangle.IsEmpty ? "empty" : current.IsOffscreen ? "offscreen" : "visible",
                    patterns, values, instanceRef = Identity(element)
                });
                parent = id;
            }
            var child = TreeWalker.ControlViewWalker.GetFirstChild(element);
            while (child != null) { Visit(child, depth + 1, parent); child = TreeWalker.ControlViewWalker.GetNextSibling(child); }
        }
        Visit(window, 0, null);
        return new { processRef = ProcessRef(), windowRef = Identity(window), nodes };
    }

    private void Subscribe()
    {
        int subscribedProcessId = process!.Id;
        eventHandler = (sender, args) =>
        {
            try
            {
                var element = (AutomationElement)sender;
                if (element.Current.ProcessId != subscribedProcessId || !names.ContainsKey(element.Current.AutomationId)) return;
                lock (eventLock)
                {
                    if (events.Count >= 512) { eventOverflow = true; return; }
                    events.Add(new ProviderEvent(++eventSequence, element.Current.AutomationId, args.Property.ProgrammaticName));
                }
            }
            catch (ElementNotAvailableException) { }
        };
        Automation.AddAutomationPropertyChangedEventHandler(root!, TreeScope.Subtree, eventHandler,
            ValuePattern.ValueProperty, TogglePattern.ToggleStateProperty, SelectionItemPattern.IsSelectedProperty,
            ExpandCollapsePattern.ExpandCollapseStateProperty, RangeValuePattern.ValueProperty);
    }
    private void Unsubscribe()
    {
        if (eventHandler != null && root != null)
            Automation.RemoveAutomationPropertyChangedEventHandler(root, eventHandler);
        eventHandler = null;
    }
    private JsonElement State()
    {
        string path = LatestRecord("state");
        byte[] bytes = ReadBoundedFile(path, 4096);
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
        return document.RootElement.Clone();
    }
    private static byte[] ReadBoundedFile(string path, int maximum)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
        // Immutable published records remain complete while being read. Retain
        // delete-sharing so eventual host-owned cleanup cannot race the reader.
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (file.Length > maximum) throw new InvalidOperationException();
        byte[] bytes = new byte[(int)file.Length]; file.ReadExactly(bytes); return bytes;
    }
    private string LatestRecord(string prefix)
    {
        var files = Directory.EnumerateFiles(output, prefix + "-????.json").Where(path =>
            System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(path), "^" + prefix + "-[0-9]{4}\\.json$")).Take(513).ToArray();
        if (files.Length > 512) throw new InvalidOperationException();
        if (files.Length == 0) throw new FileNotFoundException();
        return files.OrderBy(path => Path.GetFileName(path), StringComparer.Ordinal).Last();
    }
    private void WaitState(Func<JsonElement, bool> condition) => Wait(() =>
    {
        try { return condition(State()); } catch (IOException) { return false; }
    });
    private static void Wait(Func<bool> condition)
    {
        var timer = Stopwatch.StartNew();
        while (timer.Elapsed < TimeSpan.FromSeconds(10))
        {
            try { if (condition()) return; } catch (IOException) { }
            Thread.Sleep(40);
        }
        throw new TimeoutException();
    }
    private string Identity(AutomationElement element) => "sha256:" + Hash(Encoding.UTF8.GetBytes(salt + ":" + string.Join(",", element.GetRuntimeId())));
    private string ProcessRef() => "sha256:" + Hash(Encoding.UTF8.GetBytes(salt + ":process:" + process!.Id));
    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private object Host()
    {
        using var versionKey = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        var layout = new StringBuilder(9);
        if (!GetKeyboardLayoutName(layout)) throw new InvalidOperationException();
        uint dpi = GetDpiForWindow(process!.MainWindowHandle);
        return new
        {
            osBuild = Environment.OSVersion.Version.Build.ToString() + "." + versionKey?.GetValue("UBR"),
            architecture = RuntimeInformation.OSArchitecture.ToString(), runtime = RuntimeInformation.FrameworkDescription,
            culture = CultureInfo.CurrentCulture.Name, uiCulture = CultureInfo.CurrentUICulture.Name,
            keyboardLayoutId = layout.ToString(), windowDpi = dpi, displayScale = dpi / 96.0,
            uiAutomationCoreVersion = FileVersionInfo.GetVersionInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "UIAutomationCore.dll")).FileVersion
        };
    }
    [DllImport("user32.dll", EntryPoint = "GetKeyboardLayoutNameW", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetKeyboardLayoutName(StringBuilder layout);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr window);
    private void Stop()
    {
        try { Unsubscribe(); }
        finally
        {
            if (process != null)
            {
                if (!process.HasExited) { process.CloseMainWindow(); if (!process.WaitForExit(3000)) { process.Kill(true); process.WaitForExit(3000); } }
                process.Dispose(); process = null;
            }
        }
    }
    public void Dispose() => Stop();
}

internal sealed record ProviderEvent(long Sequence, string TargetId, string Property);
