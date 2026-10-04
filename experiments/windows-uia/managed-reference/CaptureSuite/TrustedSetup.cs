using System.Windows.Automation;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace DualSurface.UiaCapture;

// Fixed synthetic setup only, NOT an action API, receipt, policy or executor.
// Every operation freshly walks the already admitted owned root(s); no retained
// removed peer, Name match, Desktop search or input fallback is used.
internal sealed class TrustedSetup(OwnedWindowsAdmission admission, Func<CaptureBudget> sharedBudget)
{
    private sealed record Entry(AutomationElement Peer, string Identity, string? Parent, string Root,
        string Correlation, string Type);
    private sealed record Root(AutomationElement Peer, string Identity, string Label, OwnedWindow Window, string Type, bool SemanticWindow);
    private readonly TreeWalker walker = TreeWalker.ControlViewWalker;
    private CaptureBudget? activeBudget; // fixed serial caller only, no concurrency claim
    private Action? currentFence;
    private readonly string salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly HashSet<string> auxiliaryInstances = new(StringComparer.Ordinal);

    public void Invoke(string id, ExpectedAuxiliary auxiliary = ExpectedAuxiliary.None, bool disabledProbe = false)
    {
        if (!new[] { "invoke", "reset", "replace", "modal", "modal-confirm", "modal-cancel", "replace-window", "injection", "disabled" }.Contains(id)) Refuse();
        if (disabledProbe != (id == "disabled")) Refuse();
        Operation<InvokePattern>(id, InvokePattern.Pattern, auxiliary, disabledProbe, (pattern, _) => Mutate(pattern.Invoke));
    }
    public void Toggle(string id, bool disabledProbe = false)
    {
        if (id is not ("toggle" or "disabled-toggle")) Refuse();
        if (disabledProbe != (id == "disabled-toggle")) Refuse();
        Operation<TogglePattern>(id, TogglePattern.Pattern, ExpectedAuxiliary.None, disabledProbe, (pattern, _) => Mutate(pattern.Toggle));
    }
    public void Value(string id, string value, bool readOnlyProbe = false)
    {
        if (id is not ("value" or "readonly") || readOnlyProbe != (id == "readonly")) Refuse();
        CaptureBudget.RequireText(value, 64);
        Operation<ValuePattern>(id, ValuePattern.Pattern, ExpectedAuxiliary.None, false, (pattern, peer) =>
        {
            if (Read<bool>(peer, ValuePattern.IsReadOnlyProperty) != readOnlyProbe) Refuse();
            Mutate(() => pattern.SetValue(value));
        });
    }
    public void Select(string id, ExpectedAuxiliary auxiliary = ExpectedAuxiliary.None)
    {
        if (id is not ("selection-b" or "radio-b" or "tab-b" or "combo-b")) Refuse();
        Operation<SelectionItemPattern>(id, SelectionItemPattern.Pattern, auxiliary, false, (pattern, _) => Mutate(pattern.Select));
    }
    public void Expand(string id)
    {
        if (id is not ("expand" or "combo")) Refuse();
        Operation<ExpandCollapsePattern>(id, ExpandCollapsePattern.Pattern, ExpectedAuxiliary.None, false, (pattern, _) => Mutate(pattern.Expand));
    }
    public void CollapseCombo(ExpectedAuxiliary auxiliary)
        => Operation<ExpandCollapsePattern>("combo", ExpandCollapsePattern.Pattern, auxiliary, false, (pattern, _) => Mutate(pattern.Collapse));
    public bool ComboExpanded(ExpectedAuxiliary auxiliary)
    {
        bool expanded = false;
        Operation<ExpandCollapsePattern>("combo", ExpandCollapsePattern.Pattern, auxiliary, false, (_, peer) =>
        {
            var state = Read<ExpandCollapseState>(peer, ExpandCollapsePattern.ExpandCollapseStateProperty);
            if (state is not (ExpandCollapseState.Collapsed or ExpandCollapseState.Expanded)) Refuse();
            expanded = state == ExpandCollapseState.Expanded;
        });
        return expanded;
    }
    public void Range(double value, bool boundaryProbe = false)
    {
        if (!double.IsFinite(value) || (boundaryProbe ? value != 11 : value != 7)) Refuse();
        Operation<RangeValuePattern>("range", RangeValuePattern.Pattern, ExpectedAuxiliary.None, false, (pattern, peer) =>
        {
            if (Read<bool>(peer, RangeValuePattern.IsReadOnlyProperty)) Refuse();
            Mutate(() => pattern.SetValue(value));
        });
    }
    public bool ProviderProbe(string id)
    {
        bool rejected = false;
        switch (id)
        {
            case "disabled":
                Operation<InvokePattern>(id, InvokePattern.Pattern, ExpectedAuxiliary.None, true,
                    (pattern, _) => Mutate(() => rejected = Rejected(pattern.Invoke, typeof(ElementNotEnabledException))));
                break;
            case "disabled-toggle":
                Operation<TogglePattern>(id, TogglePattern.Pattern, ExpectedAuxiliary.None, true,
                    (pattern, _) => Mutate(() => rejected = Rejected(pattern.Toggle, typeof(ElementNotEnabledException))));
                break;
            case "readonly":
                Operation<ValuePattern>(id, ValuePattern.Pattern, ExpectedAuxiliary.None, false, (pattern, peer) =>
                {
                    if (!Read<bool>(peer, ValuePattern.IsReadOnlyProperty)) Refuse();
                    Mutate(() => rejected = Rejected(() => pattern.SetValue("attempt"), typeof(InvalidOperationException)));
                });
                break;
            case "range-boundary":
                Operation<RangeValuePattern>("range", RangeValuePattern.Pattern, ExpectedAuxiliary.None, false, (pattern, peer) =>
                {
                    if (Read<bool>(peer, RangeValuePattern.IsReadOnlyProperty)) Refuse();
                    Mutate(() => rejected = Rejected(() => pattern.SetValue(11), typeof(ArgumentException)));
                });
                break;
            default: Refuse(); break;
        }
        return rejected;
    }
    private static bool Rejected(Action operation, Type expected)
    {
        // Catch only the actual fixed mutation call, not discovery/admission or
        // property reads. A source guard refusal is not a provider rejection.
        try { operation(); return false; }
        catch (Exception error) when (expected.IsInstanceOfType(error)) { return true; }
    }
    private void Operation<T>(string id, AutomationPattern family, ExpectedAuxiliary auxiliary, bool disabledProbe, Action<T, AutomationElement> operation)
        where T : BasePattern
    {
        var budget = sharedBudget(); budget.CheckTime();
        if (!ReferenceEquals(activeBudget, budget)) auxiliaryInstances.Clear();
        activeBudget = budget;
        var frame = admission.Observe(auxiliary, budget);
        var roots = new List<Root>();
        foreach (var window in new[] { frame.Main, frame.Auxiliary }.Where(w => w != null))
        {
            var peer = AutomationElement.FromHandle(window!.Handle);
            Guard(peer, frame, budget);
            string type = Read<ControlType>(peer, AutomationElement.ControlTypeProperty).ProgrammaticName;
            bool semanticWindow = window == frame.Main || auxiliary == ExpectedAuxiliary.Modal;
            RequireRootProof(window.Handle.ToInt64(), Read<int>(peer, AutomationElement.NativeWindowHandleProperty), type, semanticWindow);
            roots.Add(new(peer, Identity(peer, frame, budget), window == frame.Main ? "main" : "auxiliary", window, type, semanticWindow));
        }
        var nodes = new Dictionary<string, Entry>(StringComparer.Ordinal);
        foreach (var root in roots) Walk(root.Peer, null, root.Label, 0);
        var definition = FixtureSubjects.All.Single(d => d.Correlation == id);
        var candidates = nodes.Values.Where(n => n.Correlation == id && n.Type == definition.Type).Take(2).ToArray();
        if (candidates.Length != 1) Refuse();
        var target = candidates[0];
        string expectedRoot = id.StartsWith("modal-", StringComparison.Ordinal) || id == "combo-b" ? "auxiliary" : "main";
        if (target.Root != expectedRoot) Refuse();
        Entry? container = null;
        if (definition.Type is "ListItem" or "TabItem")
        {
            var containerDefinition = FixtureSubjects.All.Single(d => d.Correlation == definition.Container);
            var containers = nodes.Values.Where(n => n.Correlation == definition.Container && n.Type == containerDefinition.Type).Take(2).ToArray();
            if (containers.Length != 1 || containers[0].Root != "main") Refuse();
            container = containers[0];
        }
        currentFence = Fence;
        try
        {
            Fence();
            if (!target.Peer.TryGetCurrentPattern(family, out object? wrapper) || wrapper is not T) Refuse();
            budget.CheckTime(); operation((T)wrapper, target.Peer); budget.CheckTime();
        }
        finally { currentFence = null; }
        return;

        void Fence()
        {
            budget.CheckTime();
            OwnedWindowTopology.RequireSame(frame, admission.Observe(auxiliary, budget));
            foreach (var root in roots)
            {
                var live = AutomationElement.FromHandle(root.Window.Handle);
                Guard(live, frame, budget);
                RequireRootProof(root.Window.Handle.ToInt64(), Read<int>(live, AutomationElement.NativeWindowHandleProperty),
                    Read<ControlType>(live, AutomationElement.ControlTypeProperty).ProgrammaticName, root.SemanticWindow);
                if (!Same(live, root.Peer, frame, budget) ||
                    Read<ControlType>(live, AutomationElement.ControlTypeProperty).ProgrammaticName != root.Type) Refuse();
            }
            Qualify(target, definition, disabledProbe);
            Chain(target, expectedRoot, container == null ? definition.Container : null, container != null);
            if (container != null)
            {
                var containerDefinition = FixtureSubjects.All.Single(d => d.Correlation == definition.Container);
                Qualify(container, containerDefinition, false);
                Chain(container, "main", containerDefinition.Container, false);
                var selectedContainer = Read<AutomationElement>(target.Peer, SelectionItemPattern.SelectionContainerProperty);
                Guard(selectedContainer, frame, budget);
                if (!Same(selectedContainer, container.Peer, frame, budget)) Refuse();
            }
            // Required pattern access follows fresh ancestry/semantic-container
            // and selected-container proof, not merely the earlier discovery walk.
            if (container != null) QualifyPatterns(container, FixtureSubjects.All.Single(d => d.Correlation == definition.Container));
            QualifyPatterns(target, definition);
            // Native and provider proof remain sequential, not atomic against
            // unseen ABA. No stale pattern qualification substitutes this fence.
            OwnedWindowTopology.RequireSame(frame, admission.Observe(auxiliary, budget));
            budget.CheckTime();
        }
        void Qualify(Entry entry, FixtureSubject subject, bool disabled)
        {
            Guard(entry.Peer, frame, budget);
            if (Identity(entry.Peer, frame, budget) != entry.Identity ||
                Read<string>(entry.Peer, AutomationElement.AutomationIdProperty) != subject.Correlation ||
                Read<ControlType>(entry.Peer, AutomationElement.ControlTypeProperty).ProgrammaticName != "ControlType." + subject.Type ||
                Read<bool>(entry.Peer, AutomationElement.IsPasswordProperty) ||
                Read<bool>(entry.Peer, AutomationElement.IsEnabledProperty) == disabled ||
                Read<bool>(entry.Peer, AutomationElement.IsOffscreenProperty)) Refuse();
        }
        void QualifyPatterns(Entry entry, FixtureSubject subject)
        {
            foreach (string required in subject.RequiredPatterns)
            {
                var (patternId, wrapperType) = required switch
                {
                    "Invoke" => (InvokePattern.Pattern, typeof(InvokePattern)),
                    "Value" => (ValuePattern.Pattern, typeof(ValuePattern)),
                    "Toggle" => (TogglePattern.Pattern, typeof(TogglePattern)),
                    "SelectionItem" => (SelectionItemPattern.Pattern, typeof(SelectionItemPattern)),
                    "Selection" => (SelectionPattern.Pattern, typeof(SelectionPattern)),
                    "ExpandCollapse" => (ExpandCollapsePattern.Pattern, typeof(ExpandCollapsePattern)),
                    "RangeValue" => (RangeValuePattern.Pattern, typeof(RangeValuePattern)),
                    _ => throw new CaptureException(CaptureCode.InvalidObservation),
                };
                budget.CheckTime();
                if (!entry.Peer.TryGetCurrentPattern(patternId, out object? value) || !wrapperType.IsInstanceOfType(value)) Refuse();
                budget.CheckTime();
            }
        }
        void Chain(Entry entry, string label, string? expectedContainer, bool selectionRelation)
        {
            Entry current = entry; string? nearest = null;
            for (int depth = 0; current.Parent != null; depth++)
            {
                if (depth >= CaptureLimits.Depth) Refuse();
                if (!nodes.TryGetValue(current.Parent, out var parent)) Refuse();
                if (!Same(walker.GetParent(current.Peer), parent.Peer, frame, budget) ||
                    Identity(parent.Peer, frame, budget) != parent.Identity ||
                    Read<string>(parent.Peer, AutomationElement.AutomationIdProperty) != parent.Correlation ||
                    Read<ControlType>(parent.Peer, AutomationElement.ControlTypeProperty).ProgrammaticName != "ControlType." + parent.Type) Refuse();
                if (nearest == null && FixtureSubjects.All.Any(d => d.Correlation == parent.Correlation && d.Type == parent.Type)) nearest = parent.Correlation;
                current = parent;
            }
            if (!roots.Any(r => r.Label == label && r.Identity == current.Identity)) Refuse();
            if (!selectionRelation) RequireContainerProof(expectedContainer, nearest);
        }

        void Walk(AutomationElement peer, string? parent, string root, int depth)
        {
            budget.CheckTime(); if (depth > CaptureLimits.Depth) Refuse();
            Guard(peer, frame, budget);
            string identity = Identity(peer, frame, budget);
            if (nodes.ContainsKey(identity)) Refuse(); // local cycle/duplicate, not an earlier operation
            if (root == "auxiliary") AccountAuxiliary(auxiliaryInstances, identity);
            _ = budget.AccountInstance(identity); // shared cumulative unique budget
            string correlation = budget.CopyText(Read<string>(peer, AutomationElement.AutomationIdProperty), 256);
            string type = budget.CopyText(Read<ControlType>(peer, AutomationElement.ControlTypeProperty).ProgrammaticName, 64);
            if (!type.StartsWith("ControlType.", StringComparison.Ordinal)) Refuse();
            nodes.Add(identity, new(peer, identity, parent, root, correlation, type[12..]));
            int children = 0;
            for (var child = walker.GetFirstChild(peer); child != null; child = walker.GetNextSibling(child))
            {
                budget.CheckTime(); if (++children > CaptureLimits.Children) Refuse();
                Guard(child, frame, budget);
                string childIdentity = Identity(child, frame, budget);
                if (roots.Any(r => r.Label != root && r.Identity == childIdentity && Same(r.Peer, child, frame, budget))) continue;
                if (!Same(walker.GetParent(child), peer, frame, budget)) Refuse();
                Walk(child, identity, root, depth + 1);
            }
        }
    }
    private void Mutate(Action operation)
    {
        var budget = activeBudget ?? throw new CaptureException(CaptureCode.Unavailable);
        budget.CheckTime();
        (currentFence ?? throw new CaptureException(CaptureCode.Unavailable))();
        MutateBeforeDeadline(budget.CheckTime, operation);
    }
    // Pure helper is exercised without a clock sleep or a provider call. Actual
    // SDK mutations all use the same sequence budget immediately before calling.
    internal static void MutateBeforeDeadline(Action requireLive, Action operation)
    { requireLive(); operation(); requireLive(); }
    internal static void RequireRootProof(long expected, int observed, string type, bool semanticWindow)
    {
        if (expected == 0 || observed == 0 || observed != expected ||
            !type.StartsWith("ControlType.", StringComparison.Ordinal) ||
            semanticWindow && type != "ControlType.Window") Refuse();
    }
    internal static void RequireContainerProof(string? expected, string? nearest)
    { if (expected != nearest) Refuse(); }
    internal static void AccountAuxiliary(HashSet<string> instances, string identity)
    {
        if (instances.Contains(identity)) return;
        if (instances.Count >= 64) throw new CaptureException(CaptureCode.ResourceExceeded);
        instances.Add(identity);
    }
    private void Guard(AutomationElement peer, OwnedWindowFrame frame, CaptureBudget budget)
    {
        budget.CheckTime();
        if (Read<int>(peer, AutomationElement.ProcessIdProperty) != admission.ProcessId) Refuse();
        admission.RequirePeerBoundary(Read<int>(peer, AutomationElement.NativeWindowHandleProperty), frame, budget);
        budget.CheckTime();
    }
    private string Identity(AutomationElement peer, OwnedWindowFrame frame, CaptureBudget budget)
    {
        Guard(peer, frame, budget);
        int[] parts = peer.GetRuntimeId(); ReadOnlyCollector.RequireRuntimeParts(parts);
        budget.CheckTime();
        string bounded = string.Join(",", parts.Select(part => part.ToString(CultureInfo.InvariantCulture)));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(salt + "/" + bounded))); // private only
    }
    private bool Same(AutomationElement? left, AutomationElement right, OwnedWindowFrame frame, CaptureBudget budget)
        => left != null && Identity(left, frame, budget) == Identity(right, frame, budget);
    private T Read<T>(AutomationElement peer, AutomationProperty property)
    {
        var budget = activeBudget ?? throw new CaptureException(CaptureCode.Unavailable);
        budget.CheckTime();
        object observed = peer.GetCurrentPropertyValue(property, ignoreDefaultValue: true);
        budget.CheckTime();
        return observed is T value ? value : throw new CaptureException(CaptureCode.InvalidObservation);
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
}
