using System.Text.Json;
using System.Windows;
using System.Windows.Automation;

namespace DualSurface.UiaCapture;

internal static class Program
{
    [MTAThread]
    public static int Main(string[] args)
    {
        // Deliberately no native mode until fixed owned launcher/setup/source
        // freeze and actual independent source reviews are complete.
        if (!args.SequenceEqual(new[] { "--unit" })) return 64;
        try
        {
            int cases = CollectorUnitCases.Run();
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "p4.3-native-collector-unit", cases,
                nativeExecuted = false }, CaptureEncoding.Json));
            return 0;
        }
        catch { Console.Error.WriteLine("p4.3_native_collector_unit_failed"); return 70; }
    }
}

internal static class CollectorUnitCases
{
    public static int Run()
    {
        int cases = 0;
        var main = new OwnedWindow(1, 7, 9, 0, true, true);
        var popup = new OwnedWindow(2, 7, 9, 1, true, true);
        var hidden = new OwnedWindow(3, 7, 9, 0, false, true);
        Pass(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main]));
        Pass(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main, hidden]));
        Pass(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [popup, main]));
        Pass(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Modal, [main with { Enabled = false }, popup]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main, popup]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main with { Enabled = false }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Modal, [main]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup with { Thread = 8 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup with { Process = 10 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup with { Owner = 3 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup with { Visible = false }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup with { Enabled = false }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup, popup with { Handle = 4 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main, popup with { Owner = 0 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Modal, [main, popup, popup with { Handle = 4, Owner = 0 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup, popup with { Handle = 4, Owner = 3 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main, main]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main with { Owner = 5 }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main with { Visible = false }]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, (ExpectedAuxiliary)99, [main]));
        DenyWindow(() => OwnedWindowTopology.Admit(0, 7, 9, ExpectedAuxiliary.None, [main]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 0, 9, ExpectedAuxiliary.None, [main]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 0, ExpectedAuxiliary.None, [main]));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, []));
        var complete = Enumerable.Range(1, 64).Select(i => main with { Handle = i, Visible = i == 1 }).ToArray();
        Pass(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, complete));
        DenyWindow(() => OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [..complete, hidden with { Handle = 65 }]));
        var first = OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup, hidden]);
        Pass(() => OwnedWindowTopology.RequireSame(first, OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [hidden, popup, main])));
        DenyWindow(() => OwnedWindowTopology.RequireSame(first, OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup, [main, popup])));
        DenyWindow(() => OwnedWindowTopology.RequireSame(first, OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.Popup,
            [main, popup, hidden with { Enabled = false }])));
        Pass(() => OwnedWindowTopology.Enumerate(callback => { foreach (var w in complete) if (!callback(w.Handle)) return false; return true; }, new()));
        int delivered = 0;
        DenyWindow(() => OwnedWindowTopology.Enumerate(callback => { for (int i = 1; i <= 65; i++) { delivered++; if (!callback(i)) return false; } return true; }, new()));
        Assert(delivered == 65); // even the rejected65th callback was counted
        DenyWindow(() => OwnedWindowTopology.Enumerate(_ => false, new()));
        DenyWindow(() => OwnedWindowTopology.Enumerate(callback => { callback(0); return true; }, new()));
        Assert(ReadOnlyCollector.Boolean(AutomationElement.NotSupported) == null);
        Assert(ReadOnlyCollector.Boolean(true) is true);
        Assert(ReadOnlyCollector.Boolean(false) is false);
        Deny(() => ReadOnlyCollector.Boolean(null));
        Deny(() => ReadOnlyCollector.Boolean(0));
        Assert(ReadOnlyCollector.OptionalEnum<ToggleState>(ToggleState.On, 2) == 1);
        Assert(ReadOnlyCollector.OptionalEnum<ToggleState>(ToggleState.Indeterminate, 2) == 2);
        Assert(ReadOnlyCollector.OptionalEnum<ToggleState>(AutomationElement.NotSupported, 2) == null);
        Deny(() => ReadOnlyCollector.OptionalEnum<ToggleState>(1, 2));
        Deny(() => ReadOnlyCollector.OptionalEnum<ToggleState>((ToggleState)3, 2));
        Assert(ReadOnlyCollector.OptionalEnum<ExpandCollapseState>(ExpandCollapseState.PartiallyExpanded, 3) == 2);
        Assert(ReadOnlyCollector.OptionalNumber(7d) == 7);
        Assert(ReadOnlyCollector.OptionalNumber(AutomationElement.NotSupported) == null);
        Deny(() => ReadOnlyCollector.OptionalNumber(7));
        Deny(() => ReadOnlyCollector.OptionalNumber(double.NaN));
        Deny(() => ReadOnlyCollector.OptionalNumber(double.PositiveInfinity));
        Assert(!ReadOnlyCollector.RectangleVisible(Rect.Empty));
        Assert(!ReadOnlyCollector.RectangleVisible(new Rect(0, 0, 0, 1)));
        Assert(ReadOnlyCollector.RectangleVisible(new Rect(0, 0, 1, 1)));
        Deny(() => ReadOnlyCollector.RectangleVisible(AutomationElement.NotSupported));
        Deny(() => ReadOnlyCollector.RectangleVisible(new Rect(double.NaN, 0, 1, 1)));
        Assert(!ReadOnlyCollector.PatternShape("Invoke", new object()));
        Assert(!ReadOnlyCollector.PatternShape("Value", null));
        Assert(!ReadOnlyCollector.PatternShape("unknown", null));
        foreach (object? foreign in new object?[] { 10, null, AutomationElement.NotSupported, "9" })
        {
            bool identityRead = false, nameRead = false, patternRead = false;
            Deny(() => ReadOnlyCollector.ReadOwned(9, () => foreign, () =>
            { identityRead = nameRead = patternRead = true; return new[] { 1 }; }));
            Assert(!identityRead && !nameRead && !patternRead);
        }
        int readCalls = 0;
        Assert(ReadOnlyCollector.ReadOwned(9, () => 9, () => ++readCalls) == 1 && readCalls == 1);
        Pass(() => ReadOnlyCollector.RequireSelectionFence(false, "container-a", true, false, "container-a"));
        Pass(() => ReadOnlyCollector.RequireSelectionFence(null, "container-a", true, null, "container-a"));
        Pass(() => ReadOnlyCollector.RequireSelectionFence(true, null, true, true, null)); // radio without fabricated container
        Deny(() => ReadOnlyCollector.RequireSelectionFence(false, "container-a", true, false, "container-b")); // nonchosen/private swap
        Deny(() => ReadOnlyCollector.RequireSelectionFence(false, "container-a", true, true, "container-a")); // selected contradiction
        Deny(() => ReadOnlyCollector.RequireSelectionFence(false, "container-a", true, null, "container-a")); // known -> unknown
        Deny(() => ReadOnlyCollector.RequireSelectionFence(false, "container-a", false, false, "container-a"));
        Deny(() => ReadOnlyCollector.RequireSelectionFence(false, "container-a", true, false, null));
        Pass(() => ReadOnlyCollector.RequireRuntimeParts(new int[32]));
        Deny(() => ReadOnlyCollector.RequireRuntimeParts(new int[33]), CaptureCode.ResourceExceeded);
        Deny(() => ReadOnlyCollector.RequireRuntimeParts([]), CaptureCode.ResourceExceeded);
        Deny(() => ReadOnlyCollector.RequireRuntimeParts(null), CaptureCode.ResourceExceeded);
        var admittedMain = OwnedWindowTopology.Admit(1, 7, 9, ExpectedAuxiliary.None, [main, hidden]);
        Pass(() => OwnedWindowTopology.RequirePeerBoundary(admittedMain, main with { Handle = 8 }, 1));
        Pass(() => OwnedWindowTopology.RequirePeerBoundary(first, popup with { Handle = 8 }, 2));
        DenyWindow(() => OwnedWindowTopology.RequirePeerBoundary(admittedMain, hidden, 3));
        DenyWindow(() => OwnedWindowTopology.RequirePeerBoundary(admittedMain, main with { Handle = 8, Thread = 8 }, 1));
        DenyWindow(() => OwnedWindowTopology.RequirePeerBoundary(admittedMain, main with { Handle = 8, Process = 10 }, 1));
        DenyWindow(() => OwnedWindowTopology.RequirePeerBoundary(admittedMain, main with { Handle = 8 }, 4));
        DenyWindow(() => OwnedWindowTopology.RequirePeerBoundary(admittedMain, main with { Handle = 8 }, 0));
        int disposedFenceCalls = 0;
        // Deliberately absent native admission: early disposal MUST refuse before
        // touching either admission or the injected host fence. Not OS evidence.
        using var retired = new ReadOnlyCollector(null!, () => { disposedFenceCalls++; throw new InvalidOperationException(); });
        retired.Dispose();
        Deny(() => retired.Capture(ExpectedAuxiliary.None), CaptureCode.Unavailable);
        Assert(disposedFenceCalls == 0);
        Pass(retired.Dispose); // idempotent disposal
        foreach (object? foreign in new object?[] { 10, null, AutomationElement.NotSupported, "9" })
        {
            bool compared = false;
            Deny(() => ReadOnlyCollector.CompareAfterProof(() => ReadOnlyCollector.ReadOwned(9, () => foreign, () => true),
                () => true, () => { compared = true; return true; }));
            Assert(!compared);
            Deny(() => ReadOnlyCollector.CompareAfterProof(() => true,
                () => ReadOnlyCollector.ReadOwned(9, () => foreign, () => true), () => { compared = true; return true; }));
            Assert(!compared);
        }
        for (int operand = 0; operand < 2; operand++)
        {
            bool compared = false;
            Deny(() => ReadOnlyCollector.CompareAfterProof(() => operand != 0, () => operand != 1,
                () => { compared = true; return true; }));
            Assert(!compared);
        }
        Assert(ReadOnlyCollector.CompareAfterProof(() => true, () => true, () => true));
        Assert(!ReadOnlyCollector.CompareAfterProof(() => true, () => true, () => false));
        return cases;

        void Assert(bool condition) { if (!condition) throw new InvalidOperationException(); cases++; }
        void Pass(Action action) { action(); cases++; }
        void DenyWindow(Action action) => Deny(action, CaptureCode.Unavailable);
        void Deny(Action action, CaptureCode expected = CaptureCode.InvalidObservation)
        {
            try { action(); } catch (CaptureException error) { if (error.Code != expected) throw new InvalidOperationException(); cases++; return; }
            throw new InvalidOperationException();
        }
    }
}
