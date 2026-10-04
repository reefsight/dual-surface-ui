using System.Collections.ObjectModel;

namespace DualSurface.UiaCapture;

internal enum ExpectedAuxiliary { None, Modal, Popup }
internal sealed record OwnedWindow(nint Handle, uint Thread, uint Process, nint Owner,
    bool Visible, bool Enabled);
internal sealed record OwnedWindowFrame(OwnedWindow Main, OwnedWindow? Auxiliary,
    ReadOnlyCollection<OwnedWindow> Candidates);

// Pure admission policy over privately observed native facts. Synthetic facts
// in unit cases do NOT establish ownership, desktop admission or real HWND life.
internal static class OwnedWindowTopology
{
    public const int Candidates = 64;

    public static OwnedWindowFrame Admit(nint anchoredMain, uint anchoredThread, uint process,
        ExpectedAuxiliary expected, IReadOnlyList<OwnedWindow> observed)
    {
        if (!Enum.IsDefined(expected) || anchoredMain == 0 || anchoredThread == 0 || process == 0 ||
            observed.Count is < 1 or > Candidates) Refuse();
        var seen = new HashSet<nint>();
        foreach (var window in observed)
            if (window.Handle == 0 || !seen.Add(window.Handle) ||
                window.Thread != anchoredThread || window.Process != process) Refuse();
        var mains = observed.Where(w => w.Handle == anchoredMain).ToArray();
        if (mains.Length != 1 || !mains[0].Visible || mains[0].Owner != 0) Refuse();
        // Do not filter out an unprovable competing visible subject just because
        // its GW_OWNER is wrong. Refuse it BEFORE any auxiliary UIA acquisition.
        var additional = observed.Where(w => w.Handle != anchoredMain && w.Visible && w.Enabled).Take(2).ToArray();
        if (expected == ExpectedAuxiliary.None ? additional.Length != 0 || !mains[0].Enabled :
            additional.Length != 1 || additional[0].Owner != anchoredMain) Refuse();
        // ShowDialog disables its owner. The anchored main MUST NOT be replaced
        // by whichever enabled modal Process.MainWindowHandle later returns.
        return new(mains[0], additional.SingleOrDefault(), Array.AsReadOnly(observed
            .OrderBy(w => w.Handle.ToInt64()).ToArray()));
    }

    public static void RequireSame(OwnedWindowFrame before, OwnedWindowFrame after)
    {
        if (before.Main != after.Main || before.Auxiliary != after.Auxiliary ||
            !before.Candidates.SequenceEqual(after.Candidates)) Refuse();
    }
    public static void RequirePeerBoundary(OwnedWindowFrame admitted, OwnedWindow peer, nint nativeRoot)
    {
        if (peer.Handle == 0 || peer.Thread != admitted.Main.Thread || peer.Process != admitted.Main.Process ||
            nativeRoot == 0 || nativeRoot != admitted.Main.Handle && nativeRoot != admitted.Auxiliary?.Handle) Refuse();
    }

    // Callback budget applies BEFORE ANY PID/visibility/ownership filtering.
    // Stop reason survives the native API's ambiguous false return value.
    public static IReadOnlyList<nint> Enumerate(Func<Func<nint, bool>, bool> enumerate, CaptureBudget budget)
    {
        var handles = new List<nint>();
        bool stopped = false;
        bool result = enumerate(handle =>
        {
            try
            {
                budget.CheckTime();
                if (handles.Count >= Candidates || handle == 0) { stopped = true; return false; }
                handles.Add(handle);
                return true;
            }
            catch { stopped = true; return false; } // never unwind across unmanaged callback
        });
        budget.CheckTime();
        if (stopped || !result) Refuse();
        return handles.AsReadOnly();
    }
    private static void Refuse() => throw new CaptureException(CaptureCode.Unavailable);
}
