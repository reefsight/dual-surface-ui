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
            var current = element.Current;
            if (current.ProcessId != owned.Id || (parent != null && !Automation.Compare(walker.GetParent(element), parent)))
                throw new GuardException(GuardCode.NotAuthorized);
            string instance = Instance(element);
            if (!instances.Add(instance)) throw new GuardException(GuardCode.PreconditionFailed);
            freshPeers.Add(instance, element);
            string correlation = Text(current.AutomationId), type = Text(current.ControlType.ProgrammaticName);
            if (!type.StartsWith("ControlType.", StringComparison.Ordinal)) throw new GuardException(GuardCode.PreconditionFailed);
            type = type[12..];
            bool sensitive = SafetyBoolean(element, AutomationElement.IsPasswordProperty);
            bool enabled = SafetyBoolean(element, AutomationElement.IsEnabledProperty);
            bool offscreen = SafetyBoolean(element, AutomationElement.IsOffscreenProperty), readOnly = false;
            var patterns = new List<string>();
            // Password classification is observed before pattern access; no Name,
            // help text, Value.Value or password content is read in this slice.
            if (!sensitive)
            {
                foreach (var supported in Supported)
                {
                    CheckTime();
                    if (!element.TryGetCurrentPattern(supported.Pattern, out object? pattern)) continue;
                    patterns.Add(supported.Name);
                    if (pattern is ValuePattern) readOnly |= SafetyBoolean(element, ValuePattern.IsReadOnlyProperty);
                    if (pattern is RangeValuePattern) readOnly |= SafetyBoolean(element, RangeValuePattern.IsReadOnlyProperty);
                }
            }
            nodes.Add(new(correlation, type, instance, parentId, patterns.AsReadOnly(),
                enabled, offscreen, sensitive, readOnly));
            int children = 0;
            for (var child = walker.GetFirstChild(element); child != null; child = walker.GetNextSibling(child))
            {
                if (++children > IdentityLimits.Children) throw new GuardException(GuardCode.ResourceExceeded);
                Visit(child, element, instance, depth + 1);
                CheckTime();
            }
        }
        Visit(root, null, null, 0);
        admission.RequireUnchanged(window);
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
    private static bool SafetyBoolean(AutomationElement element, AutomationProperty property) =>
        RequireBoolean(element.GetCurrentPropertyValue(property, ignoreDefaultValue: true));
    internal static bool RequireBoolean(object? value) => value is bool boolean ? boolean : throw new GuardException(GuardCode.PreconditionFailed);
    private static string Text(string? input) => IdentityCatalog.ValidText(input, allowEmpty: true)
        ? input! : throw new GuardException(GuardCode.ResourceExceeded);
}
