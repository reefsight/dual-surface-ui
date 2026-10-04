using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Automation;

namespace DualSurface.UiaReference;

internal sealed class NativeObservation(Process owned, Func<long> resetEpoch)
{
    private readonly WindowsAdmission admission = new(owned);
    private readonly string salt = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
    private Dictionary<string, AutomationElement> setupPeers = new(StringComparer.Ordinal);
    private static readonly (AutomationPattern Pattern, string Name)[] Supported = [
        (InvokePattern.Pattern, "Invoke"), (ValuePattern.Pattern, "Value"), (TogglePattern.Pattern, "Toggle"),
        (SelectionPattern.Pattern, "Selection"), (SelectionItemPattern.Pattern, "SelectionItem"),
        (ExpandCollapsePattern.Pattern, "ExpandCollapse"), (RangeValuePattern.Pattern, "RangeValue")];

    public IdentityObservation Capture()
    {
        var timer = Stopwatch.StartNew();
        nint window = admission.CurrentWindow();
        Program.Stage = "capture-root";
        long epoch = resetEpoch();
        var root = AutomationElement.FromHandle(window);
        if (root.Current.NativeWindowHandle != window || root.Current.ControlType != ControlType.Window)
            throw new GuardException(GuardCode.SurfaceUnavailable);
        var nodes = new List<ObservedElement>();
        var freshPeers = new Dictionary<string, AutomationElement>(StringComparer.Ordinal);
        var instances = new HashSet<string>(StringComparer.Ordinal);
        var walker = TreeWalker.ControlViewWalker;
        void Visit(AutomationElement element, AutomationElement? parent, string? parentId, int depth)
        {
            CheckTime();
            if (depth > IdentityLimits.Depth || nodes.Count >= IdentityLimits.Nodes)
                throw new GuardException(GuardCode.ResourceExceeded);
            Program.Stage = "capture-membership";
            var current = element.Current;
            if (current.ProcessId != owned.Id || (parent != null && !Automation.Compare(walker.GetParent(element), parent)))
                throw new GuardException(GuardCode.NotAuthorized);
            Program.Stage = "capture-instance";
            string instance = Instance(element);
            if (!instances.Add(instance)) throw new GuardException(GuardCode.PreconditionFailed);
            freshPeers.Add(instance, element);
            Program.Stage = "capture-correlation";
            string correlation = Text(current.AutomationId);
            Program.Stage = "capture-control-type";
            string type = Text(current.ControlType.ProgrammaticName);
            if (!type.StartsWith("ControlType.", StringComparison.Ordinal)) throw new GuardException(GuardCode.PreconditionFailed);
            type = type[12..];
            bool? sensitive = SafetyBoolean(element, AutomationElement.IsPasswordProperty, "capture-password", parent == null);
            bool? enabled = SafetyBoolean(element, AutomationElement.IsEnabledProperty, "capture-enabled", parent == null);
            bool? offscreen = SafetyBoolean(element, AutomationElement.IsOffscreenProperty, "capture-offscreen", parent == null);
            bool? valueReadOnly = null, rangeReadOnly = null;
            var patterns = new List<string>();
            // Password classification is observed before pattern access; no Name,
            // help text, Value.Value or password content is read in this slice.
            ObservePatterns(sensitive, enabled, offscreen, () =>
            {
                foreach (var supported in Supported)
                {
                    Program.Stage = "capture-pattern";
                    CheckTime();
                    if (!element.TryGetCurrentPattern(supported.Pattern, out object? pattern)) continue;
                    Program.Stage = "capture-pattern-shape";
                    if (!PatternShapeMatches(supported.Name, pattern)) throw new GuardException(GuardCode.PreconditionFailed);
                    patterns.Add(supported.Name);
                    if (pattern is ValuePattern) valueReadOnly = SafetyBoolean(element, ValuePattern.IsReadOnlyProperty, "capture-value-readonly", parent == null);
                    if (pattern is RangeValuePattern) rangeReadOnly = SafetyBoolean(element, RangeValuePattern.IsReadOnlyProperty, "capture-range-readonly", parent == null);
                }
            });
            nodes.Add(new(correlation, type, instance, parentId, patterns.AsReadOnly(),
                enabled, offscreen, sensitive, valueReadOnly, rangeReadOnly));
            int children = 0;
            Program.Stage = "capture-children";
            for (var child = walker.GetFirstChild(element); child != null; child = walker.GetNextSibling(child))
            {
                if (++children > IdentityLimits.Children) throw new GuardException(GuardCode.ResourceExceeded);
                Visit(child, element, instance, depth + 1);
                Program.Stage = "capture-children";
                CheckTime();
            }
        }
        Visit(root, null, null, 0);
        admission.RequireUnchanged(window);
        Program.Stage = "capture-final-fence";
        if (resetEpoch() != epoch || Instance(AutomationElement.FromHandle(window)) != nodes[0].Instance)
            throw new GuardException(GuardCode.StaleRevision);
        CheckTime();
        setupPeers = freshPeers;
        return new(Hash(window.ToInt64().ToString(CultureInfo.InvariantCulture) + ":" + nodes[0].Instance), epoch, nodes.AsReadOnly());
        void CheckTime() { if (timer.Elapsed > IdentityLimits.ObservationTime) throw new GuardException(GuardCode.ResourceExceeded); }
    }

    // Trusted fixture-setup helper only. Not exposed to receipts/callers, and
    // never used as the catalog's proof of membership or an adapter executor.
    public AutomationElement SetupElement(string fixtureId)
    {
        var observation = Capture();
        var matches = observation.Elements.Where(n => n.Correlation == fixtureId && n.ControlType == "Button" &&
            n.Patterns.Contains("Invoke", StringComparer.Ordinal)).Take(2).ToArray();
        if (matches.Length != 1) throw new GuardException(GuardCode.PreconditionFailed);
        return setupPeers[matches[0].Instance];
    }
    private string Instance(AutomationElement element)
    {
        int[] parts = element.GetRuntimeId();
        if (parts == null || parts.Length is < 1 or > IdentityLimits.RuntimeIdParts) throw new GuardException(GuardCode.ResourceExceeded);
        return Hash(string.Join(",", parts.Select(p => p.ToString(CultureInfo.InvariantCulture))));
    }
    private string Hash(string input) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(salt + ":" + input)));
    private static bool? SafetyBoolean(AutomationElement element, AutomationProperty property, string stage, bool root)
    {
        Program.Stage = stage + (root ? "-root" : "-child"); // Fixed local categories only.
        object? value = element.GetCurrentPropertyValue(property, ignoreDefaultValue: true);
        if (value is not bool) Program.Stage += "-" + BooleanCategory(value);
        return ObserveBoolean(value);
    }
    internal static bool? ObserveBoolean(object? value) => ReferenceEquals(value, AutomationElement.NotSupported) ? null : RequireBoolean(value);
    internal static bool PatternShapeMatches(string expected, object? pattern) => expected switch
    {
        "Invoke" => pattern is InvokePattern, "Value" => pattern is ValuePattern, "Toggle" => pattern is TogglePattern,
        "Selection" => pattern is SelectionPattern, "SelectionItem" => pattern is SelectionItemPattern,
        "ExpandCollapse" => pattern is ExpandCollapsePattern, "RangeValue" => pattern is RangeValuePattern,
        _ => false
    };
    internal static void ObservePatterns(bool? sensitive, bool? enabled, bool? offscreen, Action read)
    {
        // Availability reads are safe only with explicit basic classification.
        // Known disabled/offscreen patterns may be inspected, never operated.
        if (sensitive is false && enabled.HasValue && offscreen.HasValue) read();
    }
    internal static string BooleanCategory(object? value) => value is bool ? "boolean" :
        ReferenceEquals(value, AutomationElement.NotSupported) ? "not-supported" : value == null ? "null" : "wrong-type";
    internal static bool RequireBoolean(object? value) => value is bool boolean ? boolean : throw new GuardException(GuardCode.PreconditionFailed);
    private static string Text(string? input) => IdentityCatalog.ValidText(input, allowEmpty: true)
        ? input! : throw new GuardException(GuardCode.ResourceExceeded);
}
