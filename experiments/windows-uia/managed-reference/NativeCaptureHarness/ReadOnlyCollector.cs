using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Automation;

namespace DualSurface.UiaCapture;

// No mutating pattern method, retained setup peer, oracle state or external
// selector crosses this collector. Native execution remains behind future fixed
// owned-fixture setup and independently reviewed source/binary freeze.
internal sealed class ReadOnlyCollector(OwnedWindowsAdmission admission, Func<long> resetFence) : IDisposable
{
    internal const int RuntimeIdParts = 32; // retain accepted S1 private limit
    private readonly string salt = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
    private readonly SemanticSession session = new();
    private bool disposed;
    private static readonly (AutomationPattern Pattern, string Name)[] Families = [
        (InvokePattern.Pattern, "Invoke"), (ValuePattern.Pattern, "Value"), (TogglePattern.Pattern, "Toggle"),
        (SelectionPattern.Pattern, "Selection"), (SelectionItemPattern.Pattern, "SelectionItem"),
        (ExpandCollapsePattern.Pattern, "ExpandCollapse"), (RangeValuePattern.Pattern, "RangeValue")];

    public CapturePublication Capture(ExpectedAuxiliary expected)
    {
        if (disposed) throw new CaptureException(CaptureCode.Unavailable);
        // This same budget spans native pre/post admission, both roots, all
        // auxiliary relations, text, projection and final native fences.
        var budget = new CaptureBudget();
        try
        {
            long epoch = resetFence(); budget.CheckTime();
            var before = admission.Observe(expected, budget);
            var graph = new Collection(admission, before, salt, budget);
            string main = graph.AddRoot(before.Main, window: true);
            string? auxiliary = before.Auxiliary == null ? null : graph.AddRoot(before.Auxiliary,
                window: expected == ExpectedAuxiliary.Modal);
            graph.WalkRoots();
            graph.ResolveSelections();
            graph.RequireCurrent();
            string published = expected == ExpectedAuxiliary.Modal ? auxiliary ?? throw new CaptureException(CaptureCode.Unavailable) : main;
            string generation = Hash(salt, admission.Birth.ToString(CultureInfo.InvariantCulture) + ":" + main + ":" + epoch.ToString(CultureInfo.InvariantCulture));
            var observation = graph.Copy(generation, published);
            var publication = session.Capture(observation, DateTimeOffset.UtcNow);
            // Projector's own deterministic checks do not reset this outer budget.
            budget.CheckTime();
            graph.RequireCurrent();
            OwnedWindowTopology.RequireSame(before, admission.Observe(expected, budget));
            if (resetFence() != epoch) Refuse();
            budget.CheckTime();
            return publication;
        }
        catch { session.Invalidate(); throw; }
    }
    public void Invalidate() => session.Invalidate();
    public void Dispose() { disposed = true; session.Dispose(); }

    private sealed class Collection(OwnedWindowsAdmission admission, OwnedWindowFrame frame, string salt, CaptureBudget budget)
    {
        private sealed record Root(AutomationElement Peer, string Instance, OwnedWindow Window, bool SemanticWindow);
        private sealed record Member(AutomationElement Peer, CopiedNode Node);
        private sealed record Relation(AutomationElement Container, string Instance, AutomationElement? Selected);
        private readonly List<Root> roots = [];
        private readonly Dictionary<string, Member> members = new(StringComparer.Ordinal);
        private readonly HashSet<string> accounted = new(StringComparer.Ordinal);
        private readonly List<Relation> relations = [];
        private readonly TreeWalker walker = TreeWalker.ControlViewWalker;
        private int auxiliaryNodes;

        public string AddRoot(OwnedWindow admitted, bool window)
        {
            budget.CheckTime();
            if (roots.Count >= CaptureLimits.Roots) Limit();
            var peer = AutomationElement.FromHandle(admitted.Handle);
            RequireProcess(peer);
            RequireBoundary(peer);
            if (Required<int>(Read(peer, AutomationElement.NativeWindowHandleProperty)) != admitted.Handle.ToInt64()) Refuse();
            var type = Required<ControlType>(Read(peer, AutomationElement.ControlTypeProperty));
            if (window && type != ControlType.Window) Refuse();
            string instance = Instance(peer);
            if (roots.Any(r => r.Instance == instance)) Refuse();
            roots.Add(new(peer, instance, admitted, window));
            return instance;
        }
        public void WalkRoots()
        {
            foreach (var root in roots) Visit(root.Peer, null, null, 0, root, auxiliary: root != roots[0], subtree: true);
        }
        private void Visit(AutomationElement peer, AutomationElement? parent, string? parentInstance, int depth,
            Root root, bool auxiliary, bool subtree)
        {
            budget.CheckTime();
            if (depth > CaptureLimits.Depth) Limit();
            RequireProcess(peer);
            RequireBoundary(peer);
            if (parent != null && !Same(walker.GetParent(peer), parent)) Refuse();
            string instance = Instance(peer);
            if (members.ContainsKey(instance)) Refuse(); // tree cycles/overlapping roots
            if (parentInstance == null && instance != root.Instance) Refuse();
            Account(instance, auxiliary);
            var node = Observe(peer, instance, parentInstance, parentInstance == null ? root : null);
            members.Add(instance, new(peer, node));
            if (!subtree) return;
            int children = 0;
            budget.CheckTime();
            for (var child = walker.GetFirstChild(peer); child != null; child = walker.GetNextSibling(child))
            {
                budget.CheckTime();
                if (++children > CaptureLimits.Children) Limit();
                RequireProcess(child);
                RequireBoundary(child);
                // A separately admitted HWND may also occur under main in
                // Control View. Cut only that exact admitted current instance,
                // never a Name/AutomationId match, and copy it as its own root.
                var distinctRoot = roots.SingleOrDefault(r => r.Instance != root.Instance &&
                    r.Instance == Instance(child) && Same(r.Peer, child));
                if (distinctRoot != null)
                {
                    RequireProcess(child);
                    if (Required<int>(Read(child, AutomationElement.NativeWindowHandleProperty)) != distinctRoot.Window.Handle.ToInt64()) Refuse();
                    continue;
                }
                Visit(child, peer, instance, depth + 1, root, auxiliary, subtree: true);
            }
            budget.CheckTime();
        }
        private CopiedNode Observe(AutomationElement peer, string instance, string? parent, Root? root)
        {
            string correlation = budget.CopyText(Required<string>(Read(peer, AutomationElement.AutomationIdProperty)), CaptureLimits.Characters);
            string typeName = Required<ControlType>(Read(peer, AutomationElement.ControlTypeProperty)).ProgrammaticName;
            if (!typeName.StartsWith("ControlType.", StringComparison.Ordinal)) Refuse();
            string type = budget.CopyText(typeName[12..], 32, false);
            bool? sensitive = Boolean(Read(peer, AutomationElement.IsPasswordProperty));
            bool? enabled = Boolean(Read(peer, AutomationElement.IsEnabledProperty));
            bool? offscreen = Boolean(Read(peer, AutomationElement.IsOffscreenProperty));
            bool known = sensitive.HasValue && enabled.HasValue && offscreen.HasValue;
            bool? visible = null; string? name = null;
            var patterns = new List<string>(); var values = new CopiedValues();
            if (known)
            {
                visible = RectangleVisible(Read(peer, AutomationElement.BoundingRectangleProperty));
                if (sensitive is false)
                {
                    name = budget.CopyText(Required<string>(Read(peer, AutomationElement.NameProperty)), CaptureLimits.Characters);
                    foreach (var (pattern, family) in Families)
                    {
                        budget.CheckTime();
                        bool supported = peer.TryGetCurrentPattern(pattern, out object? wrapper);
                        budget.CheckTime();
                        if (!supported) continue;
                        if (!PatternShape(family, wrapper)) Refuse();
                        patterns.Add(budget.CopyText(family, 32, false));
                    }
                    // Only reviewed typed subjects read Value/range/Toggle/Expand
                    // content. SelectionItem state is read for all known peers so
                    // unreviewed copied peers cannot hide contradictory relations.
                    var definition = FixtureSubjects.All.SingleOrDefault(d => d.Correlation == correlation && d.Type == type);
                    if (definition != null && patterns.Contains("Value") && correlation is "value" or "readonly")
                        values = values with { Value = OptionalText(Read(peer, ValuePattern.ValueProperty), CaptureLimits.ValueCharacters),
                            ValueReadOnly = Boolean(Read(peer, ValuePattern.IsReadOnlyProperty)) };
                    if (definition != null && patterns.Contains("Toggle") && correlation is "toggle" or "disabled-toggle")
                        values = values with { Toggle = OptionalEnum<ToggleState>(Read(peer, TogglePattern.ToggleStateProperty), 2) };
                    if (definition != null && patterns.Contains("ExpandCollapse") && correlation is "expand" or "combo")
                        values = values with { Expansion = OptionalEnum<ExpandCollapseState>(Read(peer, ExpandCollapsePattern.ExpandCollapseStateProperty), 3) };
                    if (definition != null && patterns.Contains("RangeValue") && correlation == "range")
                        values = values with { Range = OptionalNumber(Read(peer, RangeValuePattern.ValueProperty)),
                            Minimum = OptionalNumber(Read(peer, RangeValuePattern.MinimumProperty)), Maximum = OptionalNumber(Read(peer, RangeValuePattern.MaximumProperty)),
                            RangeReadOnly = Boolean(Read(peer, RangeValuePattern.IsReadOnlyProperty)) };
                    if (patterns.Contains("SelectionItem"))
                    {
                        values = values with { Selected = Boolean(Read(peer, SelectionItemPattern.IsSelectedProperty)) };
                        if (type != "RadioButton")
                        {
                            var container = Required<AutomationElement>(Read(peer, SelectionItemPattern.SelectionContainerProperty));
                            RequireProcess(container);
                            values = values with { SelectionContainer = Instance(container) };
                        }
                    }
                    if (definition != null && patterns.Contains("Selection") && correlation is "selection" or "combo" or "tabs")
                    {
                        object selection = Read(peer, SelectionPattern.SelectionProperty);
                        if (!ReferenceEquals(selection, AutomationElement.NotSupported))
                        {
                            var selected = Required<AutomationElement[]>(selection);
                            if (selected.Length > 1 || selected.Any(p => p == null)) Refuse();
                            foreach (var selectedPeer in selected) { RequireProcess(selectedPeer); RequireBoundary(selectedPeer); }
                            // Safety/ancestry/container proof happens before reading
                            // any selected-peer content/pattern state below.
                            relations.Add(new(peer, instance, selected.SingleOrDefault()));
                            values = values with { SelectionKnown = true,
                                SelectedInstance = selected.Length == 0 ? null : Instance(selected[0]) };
                        }
                    }
                }
            }
            return new(instance, parent, correlation, type, sensitive, enabled, offscreen, visible, name,
                patterns, values, admittedWindowRoot: root?.SemanticWindow is true, admittedGraphRoot: root != null);
        }
        public void ResolveSelections()
        {
            // Resolve may add private ancestors/selected peers, but never traverses
            // Desktop roots or grants a new top-level root through provider IDs.
            foreach (var relation in relations.ToArray())
            {
                budget.CheckTime();
                if (relation.Selected == null) continue;
                ProveSelected(relation);
            }
        }
        private void ProveSelected(Relation relation)
        {
            var peer = relation.Selected ?? throw new CaptureException(CaptureCode.InvalidObservation);
            RequireProcess(peer);
            RequireBoundary(peer);
            // Explicit safety before selected-peer content and pattern reads.
            if (Boolean(Read(peer, AutomationElement.IsPasswordProperty)) is not false ||
                !Boolean(Read(peer, AutomationElement.IsEnabledProperty)).HasValue ||
                !Boolean(Read(peer, AutomationElement.IsOffscreenProperty)).HasValue) Refuse();
            // Native-root ancestry and combined/auxiliary admission precede
            // ALL selected-peer pattern/state/content acquisition.
            var chain = CurrentChain(peer);
            Root root = roots.Single(r => r.Instance == chain[^1].Instance);
            budget.CheckTime();
            if (!peer.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object? pattern) || pattern is not SelectionItemPattern) Refuse();
            if (Boolean(Read(peer, SelectionItemPattern.IsSelectedProperty)) is not true) Refuse();
            var container = Required<AutomationElement>(Read(peer, SelectionItemPattern.SelectionContainerProperty));
            RequireProcess(container);
            if (!Same(container, relation.Container) || Instance(container) != relation.Instance) Refuse();
            // Add missing ancestry in root-to-peer order. Shared combined nodes,
            // per-parent children, auxiliary64 and text caps remain in force.
            for (int i = chain.Count - 2; i >= 0; i--)
            {
                var link = chain[i];
                string parentInstance = chain[i + 1].Instance;
                if (members.TryGetValue(link.Instance, out var existing))
                {
                    if (existing.Node.Parent != parentInstance || !Same(existing.Peer, link.Peer)) Refuse();
                }
                else
                {
                    if (members.Values.Count(m => m.Node.Parent == parentInstance) >= CaptureLimits.Children) Limit();
                    Visit(link.Peer, chain[i + 1].Peer, parentInstance, chain.Count - 1 - i, root, auxiliary: true, subtree: false);
                }
            }
            string instance = Instance(peer);
            if (!members.TryGetValue(instance, out var member) || member.Node.Values.Selected is not true ||
                member.Node.Values.SelectionContainer != relation.Instance) Refuse();
        }
        private List<(AutomationElement Peer, string Instance)> CurrentChain(AutomationElement peer)
        {
            var chain = new List<(AutomationElement Peer, string Instance)>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            while (true)
            {
                budget.CheckTime(); RequireProcess(peer); RequireBoundary(peer);
                if (chain.Count > CaptureLimits.Depth) Limit();
                string instance = Instance(peer);
                if (!seen.Add(instance)) Refuse();
                Account(instance, auxiliary: !members.ContainsKey(instance));
                chain.Add((peer, instance));
                if (roots.Any(r => r.Instance == instance && Same(r.Peer, peer))) return chain;
                var parent = walker.GetParent(peer);
                budget.CheckTime();
                if (parent == null) Refuse();
                // Ownership is checked BEFORE touching any outside-process parent.
                RequireProcess(parent);
                peer = parent;
            }
        }
        public void RequireCurrent()
        {
            foreach (var root in roots)
            {
                budget.CheckTime();
                var current = AutomationElement.FromHandle(root.Window.Handle);
                RequireProcess(current);
                if (Instance(current) != root.Instance || !Same(current, root.Peer) ||
                    Required<int>(Read(current, AutomationElement.NativeWindowHandleProperty)) != root.Window.Handle.ToInt64() ||
                    root.SemanticWindow && Required<ControlType>(Read(current, AutomationElement.ControlTypeProperty)) != ControlType.Window) Refuse();
            }
            foreach (var member in members.Values.ToArray())
            {
                budget.CheckTime(); RequireProcess(member.Peer); RequireBoundary(member.Peer);
                if (Instance(member.Peer) != member.Node.Instance) Refuse();
                if (member.Node.Parent is string parent &&
                    (!members.TryGetValue(parent, out var owner) || !Same(walker.GetParent(member.Peer), owner.Peer))) Refuse();
                if (Boolean(Read(member.Peer, AutomationElement.IsPasswordProperty)) != member.Node.Sensitive ||
                    Boolean(Read(member.Peer, AutomationElement.IsEnabledProperty)) != member.Node.Enabled ||
                    Boolean(Read(member.Peer, AutomationElement.IsOffscreenProperty)) != member.Node.Offscreen) Refuse();
                if (member.Node.Patterns.Contains("SelectionItem"))
                {
                    budget.CheckTime();
                    bool typed = member.Peer.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object? wrapper) && wrapper is SelectionItemPattern;
                    budget.CheckTime();
                    if (!typed) Refuse();
                    bool? selected = Boolean(Read(member.Peer, SelectionItemPattern.IsSelectedProperty));
                    string? containerInstance = null;
                    if (member.Node.ControlType != "RadioButton")
                    {
                        var container = Required<AutomationElement>(Read(member.Peer, SelectionItemPattern.SelectionContainerProperty));
                        RequireProcess(container); containerInstance = Instance(container);
                        if (member.Node.Values.SelectionContainer is not string former ||
                            !members.TryGetValue(former, out var expected) || !Same(container, expected.Peer)) Refuse();
                    }
                    RequireSelectionFence(member.Node.Values.Selected, member.Node.Values.SelectionContainer,
                        typed, selected, containerInstance);
                }
            }
            foreach (var relation in relations)
            {
                var selected = Required<AutomationElement[]>(Read(relation.Container, SelectionPattern.SelectionProperty));
                if (selected.Length > 1 || selected.Any(p => p == null) ||
                    (relation.Selected == null ? selected.Length != 0 : selected.Length != 1 || !Same(selected[0], relation.Selected))) Refuse();
                if (relation.Selected == null) continue;
                ProveSelected(relation);
            }
            budget.CheckTime();
        }
        public CopiedObservation Copy(string generation, string published)
        {
            budget.CheckTime();
            return new(generation, published, members.Values.Select(m => m.Node).ToArray(), roots.Select(r => r.Instance).ToArray());
        }
        private void RequireProcess(AutomationElement peer)
        {
            if (Required<int>(Read(peer, AutomationElement.ProcessIdProperty)) != admission.ProcessId) Refuse();
        }
        private void RequireBoundary(AutomationElement peer) => admission.RequirePeerBoundary(
            Required<int>(Read(peer, AutomationElement.NativeWindowHandleProperty)), frame, budget);
        private void Account(string instance, bool auxiliary)
        {
            budget.CheckTime();
            if (accounted.Contains(instance)) return;
            if (auxiliary && auxiliaryNodes >= 64) Limit();
            if (!budget.AccountInstance(instance)) Refuse();
            if (auxiliary) auxiliaryNodes++;
            accounted.Add(instance);
        }
        private object Read(AutomationElement peer, AutomationProperty property)
        {
            budget.CheckTime();
            object? result = peer.GetCurrentPropertyValue(property, ignoreDefaultValue: true);
            budget.CheckTime();
            return result ?? throw new CaptureException(CaptureCode.InvalidObservation);
        }
        private bool Same(AutomationElement? left, AutomationElement right)
        {
            budget.CheckTime();
            if (left == null) return false;
            // Automation.Compare itself calls unbounded GetRuntimeId. Gate BOTH
            // freshly returned operands first, and compare our already bounded
            // private identities instead. Parent/selection fences share this path.
            bool same = CompareAfterProof(
                () => { RequireProcess(left); RequireBoundary(left); return true; },
                () => { RequireProcess(right); RequireBoundary(right); return true; },
                () => Instance(left) == Instance(right));
            budget.CheckTime(); return same;
        }
        private string Instance(AutomationElement peer)
        {
            budget.CheckTime();
            // All identity use (including dedupe and deferred selection fields)
            // shares this testable ownership-first gate.
            int[] parts = ReadOwned(admission.ProcessId, () => Read(peer, AutomationElement.ProcessIdProperty), peer.GetRuntimeId);
            budget.CheckTime();
            RequireRuntimeParts(parts);
            return budget.CopyText(Hash(salt, string.Join(",", parts.Select(p => p.ToString(CultureInfo.InvariantCulture)))), 256, false);
        }
        private string? OptionalText(object value, int cap) => ReferenceEquals(value, AutomationElement.NotSupported)
            ? null : budget.CopyText(Required<string>(value), cap);
    }
    internal static bool? Boolean(object? value) => ReferenceEquals(value, AutomationElement.NotSupported) ? null : Required<bool>(value);
    internal static void RequireRuntimeParts(int[]? parts)
    {
        if (parts == null || parts.Length is < 1 or > RuntimeIdParts) Limit();
    }
    internal static T ReadOwned<T>(int expectedProcess, Func<object?> processGetter, Func<T> getter)
    {
        if (expectedProcess <= 0 || Required<int>(processGetter()) != expectedProcess) Refuse();
        return getter();
    }
    internal static void RequireSelectionFence(bool? capturedSelected, string? capturedContainer,
        bool typedPattern, bool? currentSelected, string? currentContainer)
    {
        if (!typedPattern || capturedSelected != currentSelected || capturedContainer != currentContainer) Refuse();
    }
    internal static bool CompareAfterProof(Func<bool> leftProof, Func<bool> rightProof, Func<bool> compare)
    {
        if (!leftProof() || !rightProof()) Refuse();
        return compare();
    }
    internal static int? OptionalEnum<T>(object? value, int maximum) where T : struct, Enum
    {
        if (ReferenceEquals(value, AutomationElement.NotSupported)) return null;
        if (value is not T typed) throw new CaptureException(CaptureCode.InvalidObservation);
        int number = Convert.ToInt32(typed, CultureInfo.InvariantCulture);
        if (number < 0 || number > maximum || !Enum.IsDefined(typed)) Refuse();
        return number;
    }
    internal static double? OptionalNumber(object? value) => ReferenceEquals(value, AutomationElement.NotSupported) ? null :
        value is double number && double.IsFinite(number) ? number : throw new CaptureException(CaptureCode.InvalidObservation);
    internal static bool RectangleVisible(object? value)
    {
        var rectangle = Required<Rect>(value);
        if (rectangle.IsEmpty) return false;
        if (!double.IsFinite(rectangle.X) || !double.IsFinite(rectangle.Y) || !double.IsFinite(rectangle.Width) ||
            !double.IsFinite(rectangle.Height) || rectangle.Width < 0 || rectangle.Height < 0) Refuse();
        return rectangle.Width > 0 && rectangle.Height > 0;
    }
    internal static bool PatternShape(string name, object? value) => name switch
    {
        "Invoke" => value is InvokePattern, "Value" => value is ValuePattern, "Toggle" => value is TogglePattern,
        "Selection" => value is SelectionPattern, "SelectionItem" => value is SelectionItemPattern,
        "ExpandCollapse" => value is ExpandCollapsePattern, "RangeValue" => value is RangeValuePattern, _ => false
    };
    private static T Required<T>(object? value) => value is T typed ? typed : throw new CaptureException(CaptureCode.InvalidObservation);
    private static string Hash(string salt, string input) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(salt + ":" + input)));
    [DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
    [DoesNotReturn] private static void Limit() => throw new CaptureException(CaptureCode.ResourceExceeded);
}
