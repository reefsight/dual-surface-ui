using System.Collections.ObjectModel;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

namespace DualSurface.UiaCapture;

internal sealed record SemanticState(bool? Disabled = null, bool? Checked = null, bool? Expanded = null,
    bool? Selected = null, string? Value = null, bool? Sensitive = null);
internal sealed record SemanticAction(string Name, string Risk, SortedDictionary<string, object>? InputSchema = null);
internal sealed record SemanticNode(string Id, string Role, string Name, SemanticState State,
    IReadOnlyList<SemanticAction> Actions);
internal sealed record SemanticSnapshot(string SchemaVersion, string SurfaceId, string Revision,
    string Title, string Url, string GeneratedAt, IReadOnlyList<string> Capabilities, IReadOnlyList<SemanticNode> Nodes);
internal sealed record InverseEntry(string ElementId, string Correlation);
internal sealed record CapturePublication(SemanticSnapshot PublicSnapshot, SemanticSnapshot ComparableSnapshot,
    IReadOnlyList<InverseEntry> Inverse);
internal sealed record QualifiedSubject(CopiedNode Node, FixtureSubject Definition, string Binding,
    string Name, SemanticState State, IReadOnlyList<SemanticAction> Descriptors, bool Visible, string? SelectedBinding);

// Pure (non-provider) projection. Validates a closed copied graph, qualifies
// reviewed subjects and derives state/descriptive metadata without oracle input.
internal static class SemanticProjection
{
    private static readonly string[] Patterns = ["Invoke", "Value", "Toggle", "Selection", "SelectionItem", "ExpandCollapse", "RangeValue"];
    public static IReadOnlyList<QualifiedSubject> Project(CopiedObservation input)
    {
        var budget = new CaptureBudget();
        budget.CopyText(input.Generation, 256, false);
        if (input.Nodes.Count is < 1 or > CaptureLimits.Nodes || input.Roots.Count is < 1 or > CaptureLimits.Roots ||
            input.Roots.Distinct(StringComparer.Ordinal).Count() != input.Roots.Count || !input.Roots.Contains(input.PublishedRoot)) Refuse();
        var nodes = new Dictionary<string, CopiedNode>(StringComparer.Ordinal);
        foreach (var node in input.Nodes)
        {
            if (!budget.AccountInstance(node.Instance) || !nodes.TryAdd(node.Instance, node)) Refuse();
            budget.CopyText(node.Instance, 256, false);
            budget.CopyText(node.Correlation, CaptureLimits.Characters);
            budget.CopyText(node.ControlType, 32, false);
            if (node.Parent != null) budget.CopyText(node.Parent, 256, false);
            if (node.Name != null) budget.CopyText(node.Name, CaptureLimits.Characters);
            if (node.Values.Value != null) budget.CopyText(node.Values.Value, CaptureLimits.ValueCharacters);
            if (node.Values.SelectionContainer != null) budget.CopyText(node.Values.SelectionContainer, 256, false);
            if (node.Values.SelectedInstance != null) budget.CopyText(node.Values.SelectedInstance, 256, false);
            if (node.Patterns.Count > CaptureLimits.Patterns || node.Patterns.Distinct().Count() != node.Patterns.Count ||
                node.Patterns.Any(p => !Patterns.Contains(p, StringComparer.Ordinal))) Refuse();
            foreach (string pattern in node.Patterns) budget.CopyText(pattern, 32, false);
            bool known = Known(node);
            if ((!known || node.Sensitive is true) && (node.Name != null || node.Patterns.Count != 0 || !node.Values.Empty)) Refuse();
            if (!known && node.RectangleVisible != null) Refuse();
            if (known && node.Sensitive is false && node.Name == null) Refuse();
            if (known && node.RectangleVisible == null) Refuse();
            ValidateValues(node);
        }
        var children = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var node in nodes.Values)
        {
            if (node.Parent == null)
            {
                if (!input.Roots.Contains(node.Instance) || !node.AdmittedGraphRoot) Refuse();
            }
            else
            {
                if (!nodes.ContainsKey(node.Parent)) Refuse();
                int count = children.GetValueOrDefault(node.Parent) + 1;
                if (count > CaptureLimits.Children) throw new CaptureException(CaptureCode.ResourceExceeded);
                children[node.Parent] = count;
            }
            RootOf(node, nodes); // cycle/depth checks include private structure
            if (node.AdmittedWindowRoot && (node.Parent != null || node.ControlType != "Window" || !input.Roots.Contains(node.Instance))) Refuse();
            if (node.AdmittedGraphRoot && (node.Parent != null || !input.Roots.Contains(node.Instance))) Refuse();
        }
        if (input.Roots.Any(r => !nodes.ContainsKey(r))) Refuse();
        var root = nodes[input.PublishedRoot];
        if (!root.AdmittedWindowRoot || !Known(root) || root.Sensitive is not false ||
            root.Offscreen is not false || root.RectangleVisible is not true ||
            root.Correlation is not ("fixture-window" or "modal-window")) Refuse();

        var definitions = FixtureSubjects.All.ToDictionary(d => d.Correlation, StringComparer.Ordinal);
        var candidates = new Dictionary<string, (CopiedNode Node, FixtureSubject Definition)>(StringComparer.Ordinal);
        foreach (var node in nodes.Values)
        {
            if (!definitions.TryGetValue(node.Correlation, out var definition) || node.ControlType != definition.Type) continue;
            // Same-type private/unknown candidates do not disappear just because
            // their patterns are unavailable. Reject ambiguity BEFORE safety/pattern filtering.
            string? container = Container(node, nodes, definitions);
            if (container != definition.Container) continue;
            if (candidates.ContainsKey(node.Correlation)) throw new CaptureException(CaptureCode.AmbiguousSubject);
            candidates.Add(node.Correlation, (node, definition));
        }
        var qualified = new Dictionary<string, (CopiedNode Node, FixtureSubject Definition)>(StringComparer.Ordinal);
        foreach (var (node, definition) in candidates.Values)
        {
            if (!Known(node)) continue; // unknown structural-only; no public semantics
            if (node.Sensitive != definition.Sensitive) Refuse();
            if (definition.Type == "Window" && !node.AdmittedWindowRoot) Refuse();
            if (definition.RequiredPatterns.Any(p => !node.Patterns.Contains(p))) Refuse();
            ValidateSubjectValues(node, definition);
            qualified.Add(node.Instance, (node, definition));
        }
        foreach (var (container, definition) in qualified.Values)
        {
            if (definition.Correlation is not ("selection" or "combo" or "tabs")) continue;
            // Count private/unreviewed copied peers as well: publication filtering
            // must not hide contradictory explicitly selected current relations.
            var selectedPeers = nodes.Values.Where(p => p.Values.SelectionContainer == container.Instance &&
                p.Values.Selected is true).Take(2).ToArray();
            if (selectedPeers.Length > 1 || container.Values.SelectionKnown && selectedPeers.Any(p =>
                p.Instance != container.Values.SelectedInstance)) Refuse();
        }
        var result = new List<QualifiedSubject>(); int descriptors = 0;
        foreach (var (node, definition) in qualified.Values)
        {
            budget.CheckTime();
            string? selectedBinding = null;
            if (node.Values.SelectionKnown && node.Values.SelectedInstance is string selected)
            {
                if (!qualified.TryGetValue(selected, out var item) || item.Definition.Container != definition.Correlation ||
                    item.Node.Sensitive is not false || item.Node.Values.Selected is not true ||
                    item.Node.Values.SelectionContainer != node.Instance || !item.Node.Patterns.Contains("SelectionItem")) Refuse();
                selectedBinding = Binding(item.Node);
            }
            if (node.Values.SelectionContainer is string selectionContainer &&
                (!qualified.TryGetValue(selectionContainer, out var owner) || owner.Definition.Correlation != definition.Container ||
                 !owner.Node.Patterns.Contains("Selection"))) Refuse();
            var state = new SemanticState(node.Enabled is false ? true : null,
                node.Values.Toggle switch { 0 => false, 1 => true, _ => null },
                node.Values.Expansion switch { 0 => false, 1 => true, _ => null },
                node.Values.Selected, node.Values.Range?.ToString("R", CultureInfo.InvariantCulture) ?? node.Values.Value,
                node.Sensitive is true ? true : null);
            bool visible = node.Offscreen is false && node.RectangleVisible is true && definition.Correlation != "hidden" &&
                RootOf(node.Values.SelectionContainer is string ownerInstance ? nodes[ownerInstance] : node, nodes) == input.PublishedRoot;
            var actions = new List<SemanticAction>();
            bool semanticKnown = definition.Action switch
            {
                "click" => true,
                "set_value" => node.Values.Value != null && node.Values.ValueReadOnly is false,
                "toggle" => state.Checked.HasValue,
                "select" => state.Selected.HasValue,
                "expand" => state.Expanded.HasValue,
                "set_range" => node.Values.Range.HasValue && node.Values.RangeReadOnly is false,
                _ => false,
            };
            if (visible && node.Enabled is true && node.Sensitive is false && semanticKnown)
            {
                SortedDictionary<string, object>? schema = definition.Action switch
                {
                    "set_value" => new(StringComparer.Ordinal) { ["type"] = "string", ["maxLength"] = 64 },
                    "set_range" => new(StringComparer.Ordinal) { ["type"] = "number", ["minimum"] = node.Values.Minimum!.Value, ["maximum"] = node.Values.Maximum!.Value },
                    _ => null,
                };
                if (++descriptors > CaptureLimits.Descriptors) throw new CaptureException(CaptureCode.ResourceExceeded);
                actions.Add(new(definition.Action, "write", schema));
            }
            // Keep only public subjects or the selected peer proved by a public
            // container below. Unreviewed/offscreen subjects aren't model selectors.
            result.Add(new(node, definition, Binding(node), node.Sensitive is true ? "Sensitive value" : node.Name!,
                state, actions.AsReadOnly(), visible, selectedBinding));
        }
        var requiredRelations = result.Where(q => q.Visible && q.SelectedBinding != null).Select(q => q.SelectedBinding!).ToHashSet(StringComparer.Ordinal);
        var retained = result.Where(q => q.Visible || requiredRelations.Contains(q.Binding)).OrderBy(q => q.Definition.Correlation, StringComparer.Ordinal).ToArray();
        if (retained.Length > CaptureLimits.Bindings || retained.Count(q => q.Definition.Correlation == root.Correlation) != 1) Refuse();
        return Array.AsReadOnly(retained);
    }

    private static void ValidateValues(CopiedNode n)
    {
        var v = n.Values;
        if ((v.Value != null || v.ValueReadOnly.HasValue) && !n.Patterns.Contains("Value") ||
            v.Toggle.HasValue && !n.Patterns.Contains("Toggle") || v.Expansion.HasValue && !n.Patterns.Contains("ExpandCollapse") ||
            (v.Selected.HasValue || v.SelectionContainer != null) && !n.Patterns.Contains("SelectionItem") ||
            (v.SelectionKnown || v.SelectedInstance != null) && !n.Patterns.Contains("Selection") ||
            !v.SelectionKnown && v.SelectedInstance != null ||
            (v.Range.HasValue || v.Minimum.HasValue || v.Maximum.HasValue || v.RangeReadOnly.HasValue) && !n.Patterns.Contains("RangeValue")) Refuse();
        if (v.Toggle is < 0 or > 2 || v.Expansion is < 0 or > 3) Refuse();
        if (v.Range.HasValue || v.Minimum.HasValue || v.Maximum.HasValue)
        {
            if (!v.Range.HasValue || !v.Minimum.HasValue || !v.Maximum.HasValue ||
                !double.IsFinite(v.Range.Value) || !double.IsFinite(v.Minimum.Value) || !double.IsFinite(v.Maximum.Value) ||
                v.Minimum > v.Maximum || v.Range < v.Minimum || v.Range > v.Maximum) Refuse();
        }
        if (v.SelectionContainer != null) CaptureBudget.RequireText(v.SelectionContainer, 256, false);
        if (v.SelectedInstance != null) CaptureBudget.RequireText(v.SelectedInstance, 256, false);
    }
    private static bool Known(CopiedNode n) => n.Sensitive.HasValue && n.Enabled.HasValue && n.Offscreen.HasValue;
    private static string Binding(CopiedNode n) => JsonSerializer.Serialize(new[] { n.Instance, n.Values.SelectionContainer ?? n.Parent });
    private static void ValidateSubjectValues(CopiedNode n, FixtureSubject d)
    {
        var v = n.Values;
        bool value = d.Correlation is "value" or "readonly";
        bool toggle = d.Correlation is "toggle" or "disabled-toggle";
        bool selection = d.Correlation is "selection" or "combo" or "tabs";
        bool selected = d.RequiredPatterns.Contains("SelectionItem");
        bool expansion = d.Correlation is "expand" or "combo";
        bool range = d.Correlation == "range";
        if (!value && (v.Value != null || v.ValueReadOnly.HasValue) || !toggle && v.Toggle.HasValue ||
            !selection && (v.SelectionKnown || v.SelectedInstance != null) ||
            !selected && (v.Selected.HasValue || v.SelectionContainer != null) || !expansion && v.Expansion.HasValue ||
            !range && (v.Range.HasValue || v.Minimum.HasValue || v.Maximum.HasValue || v.RangeReadOnly.HasValue)) Refuse();
    }
    private static string RootOf(CopiedNode n, Dictionary<string, CopiedNode> nodes)
    {
        var chain = new HashSet<string>(StringComparer.Ordinal); int depth = 0;
        while (true)
        {
            if (!chain.Add(n.Instance)) Refuse();
            if (depth++ > CaptureLimits.Depth) throw new CaptureException(CaptureCode.ResourceExceeded);
            if (n.Parent == null) return n.Instance;
            if (!nodes.TryGetValue(n.Parent, out var parent)) { Refuse(); return ""; }
            n = parent;
        }
    }
    private static string? Container(CopiedNode n, Dictionary<string, CopiedNode> nodes,
        Dictionary<string, FixtureSubject> definitions)
    {
        string? next = n.Values.SelectionContainer ?? n.Parent;
        while (next != null)
        {
            if (!nodes.TryGetValue(next, out var parent)) { Refuse(); return null; }
            if (definitions.TryGetValue(parent.Correlation, out var definition) && parent.ControlType == definition.Type)
                return definition.Correlation;
            next = parent.Parent;
        }
        return null;
    }
    [DoesNotReturn] private static void Refuse() => throw new CaptureException(CaptureCode.InvalidObservation);
}

// Host-owned semantic generations and revisions. Random references NEVER encode
// provider identity/correlation. Maps persist only within this bounded generation;
// retirement cannot resurrect an old ID, and failures invalidate all references.
internal sealed class SemanticSession : IDisposable
{
    private sealed record Entry(string Reference, string Correlation);
    private Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private string? generation, publishedRoot, surface, fingerprint;
    private ulong revision;
    private int issued;
    private bool disposed;
    public CapturePublication Capture(CopiedObservation observation, DateTimeOffset at)
    {
        try
        {
            if (disposed) throw new CaptureException(CaptureCode.Unavailable);
            var projected = SemanticProjection.Project(observation);
            if (generation != observation.Generation || publishedRoot != observation.PublishedRoot)
            {
                Invalidate(); generation = observation.Generation; publishedRoot = observation.PublishedRoot; surface = Reference("surface-");
            }
            var bindings = projected.Select(p => p.Binding).ToHashSet(StringComparer.Ordinal);
            foreach (string absent in entries.Keys.Where(k => !bindings.Contains(k)).ToArray()) entries.Remove(absent);
            foreach (var p in projected)
            {
                if (entries.TryGetValue(p.Binding, out var old))
                {
                    if (old.Correlation != p.Definition.Correlation) throw new CaptureException(CaptureCode.InvalidObservation);
                }
                else
                {
                    if (issued >= CaptureLimits.Bindings) throw new CaptureException(CaptureCode.ResourceExceeded);
                    entries.Add(p.Binding, new(Reference("element-"), p.Definition.Correlation)); issued++;
                }
            }
            var comparable = projected.Where(p => p.Visible).Select(p => new SemanticNode(entries[p.Binding].Reference,
                p.Definition.Role, p.Name, SelectionState(p), p.Descriptors)).OrderBy(n => n.Id, StringComparer.Ordinal).ToArray();
            var identityState = projected.Select(p => new { p.Binding, p.Definition.Correlation, p.Visible, p.SelectedBinding,
                p.Node.Parent, p.Node.Values.SelectionContainer }).ToArray();
            // GeneratedAt, oracle counters and report/case metadata are excluded.
            string nextFingerprint = Convert.ToHexStringLower(SHA256.HashData(CaptureEncoding.Encode(new
            { generation, identityState, comparable }, CaptureLimits.SnapshotBytes)));
            if (nextFingerprint != fingerprint)
            {
                if (revision == ulong.MaxValue) throw new CaptureException(CaptureCode.ResourceExceeded);
                revision++; fingerprint = nextFingerprint;
            }
            string title = projected.Single(p => p.Node.Instance == observation.PublishedRoot).Name;
            string url = "native-uia://windows/" + (projected.Single(p => p.Node.Instance == observation.PublishedRoot).Definition.Correlation == "modal-window" ? "modal" : "main");
            var catalog = new SemanticSnapshot("0.1", surface!, revision.ToString(CultureInfo.InvariantCulture), title,
                url, at.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture), Array.AsReadOnly(new[] { "snapshots" }), Array.AsReadOnly(comparable));
            var model = catalog with { Nodes = Array.AsReadOnly(comparable.Select(n => n with { Actions = Array.AsReadOnly(Array.Empty<SemanticAction>()) }).ToArray()) };
            var inverse = entries.Values.Select(e => new InverseEntry(e.Reference, e.Correlation)).OrderBy(e => e.ElementId, StringComparer.Ordinal).ToArray();
            if (inverse.Select(i => i.Correlation).Distinct(StringComparer.Ordinal).Count() != inverse.Length) throw new CaptureException(CaptureCode.AmbiguousSubject);
            CaptureEncoding.Encode(model, CaptureLimits.SnapshotBytes);
            CaptureEncoding.Encode(catalog, CaptureLimits.SnapshotBytes);
            return new(model, catalog, Array.AsReadOnly(inverse));
        }
        catch { Invalidate(); throw; }
        SemanticState SelectionState(QualifiedSubject p) => p.Node.Values.SelectionKnown
            ? p.State with { Value = p.SelectedBinding == null ? "" : entries[p.SelectedBinding].Reference } : p.State;
    }
    public void Invalidate()
    {
        entries.Clear(); generation = publishedRoot = surface = fingerprint = null; issued = 0;
        // revision is monotonic across invalidation, not resettable fixture state.
    }
    private static string Reference(string prefix) => prefix + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
    public void Dispose() { Invalidate(); disposed = true; }
}
