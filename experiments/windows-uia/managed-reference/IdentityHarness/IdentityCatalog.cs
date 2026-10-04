using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace DualSurface.UiaReference;

// Internal development boundary only: not a public SDK/protocol or executor.
internal enum GuardCode { None, NotAuthorized, SurfaceUnavailable, StaleRevision, UnsupportedAction, PreconditionFailed, ResourceExceeded }
internal sealed class GuardException(GuardCode code) : Exception("native_guard_failed")
{
    public GuardCode Code { get; } = code;
}
internal static class IdentityLimits
{
    public const int Nodes = 256, Depth = 16, Children = 64, Characters = 256,
        RuntimeIdParts = 32, Bindings = 64, ReportBytes = 16384, TotalCharacters = 131072;
    public static readonly TimeSpan ObservationTime = TimeSpan.FromSeconds(10);
}
internal sealed record HostTarget(string Correlation, string ControlType, string Pattern, string? Container = null);
internal sealed record ObservedElement(string Correlation, string ControlType, string Instance,
    string? Parent, IReadOnlyList<string> Patterns,
    bool? Enabled, bool? Offscreen, bool? Sensitive, bool? ValueReadOnly, bool? RangeReadOnly);
internal sealed record IdentityObservation(string WindowEpoch, long FixtureEpoch, IReadOnlyList<ObservedElement> Elements);
internal sealed record BindingReceipt(string SurfaceRef, string ElementRef, string IdentityRevision);
internal sealed record GuardDecision(bool Allowed, GuardCode Code);

internal sealed class IdentityCatalog(Func<IdentityObservation> observe) : IDisposable
{
    private sealed record Binding(HostTarget Definition, string Instance, string? Parent);
    private readonly Dictionary<string, Binding> bindings = new(StringComparer.Ordinal);
    private readonly object serial = new();
    private string surface = NewReference(), revision = "0", fingerprint = "";
    private long sequence;
    private bool disposed;

    // Only a trusted host constructs HostTarget. A caller supplies opaque
    // receipts, never provider IDs, selectors or executable objects.
    public BindingReceipt Discover(HostTarget target)
    {
        lock (serial)
        {
            if (target == null || !ValidText(target.Correlation) || !ValidText(target.ControlType) ||
                !ValidText(target.Pattern) || (target.Container != null && !ValidText(target.Container)))
                throw new GuardException(GuardCode.PreconditionFailed);
            var current = Fresh();
            Program.Stage = "catalog-qualification";
            var candidate = Qualified(current, target);
            Program.Stage = "catalog-operability";
            RequireOperable(candidate, target.Pattern);
            if (bindings.Count >= IdentityLimits.Bindings) throw new GuardException(GuardCode.ResourceExceeded);
            string reference = NewReference();
            bindings.Add(reference, new(target, candidate.Instance, candidate.Parent));
            return new(surface, reference, revision);
        }
    }

    public GuardDecision Validate(BindingReceipt? request)
    {
        lock (serial)
        {
            try
            {
                if (request == null || !ValidReference(request.SurfaceRef) || !ValidReference(request.ElementRef) ||
                    request.IdentityRevision == null || request.IdentityRevision.Length is < 1 or > 19 ||
                    !request.IdentityRevision.All(c => c is >= '0' and <= '9'))
                    throw new GuardException(GuardCode.PreconditionFailed);
                if (request.SurfaceRef != surface || request.IdentityRevision != revision ||
                    !bindings.TryGetValue(request.ElementRef, out var binding)) throw new GuardException(GuardCode.StaleRevision);
                var current = Fresh();
                if (request.SurfaceRef != surface || request.IdentityRevision != revision ||
                    !bindings.ContainsKey(request.ElementRef)) throw new GuardException(GuardCode.StaleRevision);
                Program.Stage = "catalog-qualification";
                var candidate = Qualified(current, binding.Definition);
                if (candidate.Instance != binding.Instance || candidate.Parent != binding.Parent)
                    throw new GuardException(GuardCode.StaleRevision);
                Program.Stage = "catalog-operability";
                RequireOperable(candidate, binding.Definition.Pattern);
                // Decision only: no retained peer, callback or pattern escapes.
                return new(true, GuardCode.None);
            }
            catch (GuardException error) { return new(false, error.Code); }
        }
    }

    private IdentityObservation Fresh()
    {
        if (disposed) throw new GuardException(GuardCode.SurfaceUnavailable);
        try
        {
            var deadline = Stopwatch.StartNew();
            var observed = observe();
            Program.Stage = "catalog-observation-validation";
            var current = CopyAndCheck(observed);
            if (deadline.Elapsed > IdentityLimits.ObservationTime) throw new GuardException(GuardCode.ResourceExceeded);
            // Incremental hashing avoids a provider-shaped aggregate string.
            // Private identity/state fingerprint, not a semantic revision.
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            void Field(string value) { hash.AppendData(Encoding.UTF8.GetBytes(value)); hash.AppendData([0]); }
            Field(current.WindowEpoch); Field(current.FixtureEpoch.ToString(System.Globalization.CultureInfo.InvariantCulture));
            foreach (var element in current.Elements.OrderBy(e => e.Instance, StringComparer.Ordinal))
            {
                Field(element.Instance); Field(element.Parent ?? ""); Field(element.Correlation); Field(element.ControlType);
                Field(Flag(element.Enabled)); Field(Flag(element.Offscreen)); Field(Flag(element.Sensitive));
                Field(Flag(element.ValueReadOnly)); Field(Flag(element.RangeReadOnly));
                Field(element.Patterns.Count.ToString(System.Globalization.CultureInfo.InvariantCulture));
                foreach (string pattern in element.Patterns.Order(StringComparer.Ordinal)) Field(pattern);
            }
            string next = Convert.ToHexStringLower(hash.GetHashAndReset());
            if (next != fingerprint) { Invalidate(); fingerprint = next; }
            return current;
        }
        catch (GuardException) { Invalidate(); throw; }
        catch { Invalidate(); throw new GuardException(GuardCode.SurfaceUnavailable); }
    }

    private static IdentityObservation CopyAndCheck(IdentityObservation? value)
    {
        if (value == null || !ValidText(value.WindowEpoch) || value.FixtureEpoch < 0 || value.Elements == null)
            throw new GuardException(GuardCode.ResourceExceeded);
        int count = value.Elements.Count, characters = value.WindowEpoch.Length;
        if (count is < 1 or > IdentityLimits.Nodes) throw new GuardException(GuardCode.ResourceExceeded);
        var nodes = new List<ObservedElement>(count);
        for (int index = 0; index < count; index++)
        {
            var node = value.Elements[index];
            if (node == null || !ValidText(node.Correlation, allowEmpty: true) || !ValidText(node.ControlType) ||
                !ValidText(node.Instance) || (node.Parent != null && !ValidText(node.Parent)) ||
                node.Patterns == null) throw new GuardException(GuardCode.ResourceExceeded);
            int patternCount = node.Patterns.Count;
            if (patternCount is < 0 or > 16) throw new GuardException(GuardCode.ResourceExceeded);
            var patterns = new string[patternCount];
            for (int pattern = 0; pattern < patterns.Length; pattern++)
            {
                string item = node.Patterns[pattern];
                if (!ValidText(item)) throw new GuardException(GuardCode.ResourceExceeded);
                patterns[pattern] = item; characters += item.Length;
            }
            if (patterns.Distinct(StringComparer.Ordinal).Count() != patterns.Length) throw new GuardException(GuardCode.PreconditionFailed);
            if ((node.Enabled == null || node.Offscreen == null || node.Sensitive == null) && patterns.Length != 0)
                throw new GuardException(GuardCode.PreconditionFailed);
            characters += node.Correlation.Length + node.ControlType.Length + node.Instance.Length + (node.Parent?.Length ?? 0);
            if (characters > IdentityLimits.TotalCharacters) throw new GuardException(GuardCode.ResourceExceeded);
            nodes.Add(node with { Patterns = Array.AsReadOnly(patterns) });
        }
        if (nodes.Select(n => n.Instance).Distinct(StringComparer.Ordinal).Count() != nodes.Count ||
            nodes.Count(n => n.Parent == null) != 1) throw new GuardException(GuardCode.PreconditionFailed);
        var byInstance = nodes.ToDictionary(n => n.Instance, StringComparer.Ordinal);
        var root = nodes.Single(n => n.Parent == null);
        if (root.ControlType != "Window") throw new GuardException(GuardCode.PreconditionFailed);
        foreach (var node in nodes)
        {
            var path = new HashSet<string>(StringComparer.Ordinal);
            var cursor = node;
            int depth = 0;
            while (true)
            {
                if (!path.Add(cursor.Instance)) throw new GuardException(GuardCode.PreconditionFailed);
                if (++depth > IdentityLimits.Depth + 1) throw new GuardException(GuardCode.ResourceExceeded);
                if (cursor.Parent == null) break;
                if (!byInstance.TryGetValue(cursor.Parent, out cursor!)) throw new GuardException(GuardCode.PreconditionFailed);
            }
            if (cursor.Instance != root.Instance) throw new GuardException(GuardCode.PreconditionFailed);
        }
        if (nodes.Where(n => n.Parent != null).GroupBy(n => n.Parent).Any(g => g.Count() > IdentityLimits.Children))
            throw new GuardException(GuardCode.ResourceExceeded);
        return new(value.WindowEpoch, value.FixtureEpoch, nodes.AsReadOnly());
    }

    private static ObservedElement Qualified(IdentityObservation observation, HostTarget definition)
    {
        var byInstance = observation.Elements.ToDictionary(n => n.Instance, StringComparer.Ordinal);
        string? containerInstance = null;
        if (definition.Container != null)
        {
            var containers = observation.Elements.Where(n => n.Correlation == definition.Container).Take(2).ToArray();
            if (containers.Length != 1) throw new GuardException(GuardCode.PreconditionFailed);
            containerInstance = containers[0].Instance;
        }
        bool InContainer(ObservedElement node)
        {
            if (definition.Container == null) return true;
            while (node.Parent != null)
            {
                node = byInstance[node.Parent];
                if (node.Instance == containerInstance) return true;
            }
            return false;
        }
        // Suppressed unknown pattern reads do not prove pattern absence. Never
        // resolve same-type unknown qualification in favor of a safe sibling.
        var typed = observation.Elements.Where(element => element.Correlation == definition.Correlation &&
            element.ControlType == definition.ControlType && InContainer(element)).ToArray();
        if (typed.Any(element => element.Enabled == null || element.Offscreen == null || element.Sensitive == null))
            throw new GuardException(GuardCode.PreconditionFailed);
        // Qualify known wrappers first, then reject ambiguity; never first-ID match.
        var candidates = typed.Where(element => element.Patterns.Contains(definition.Pattern, StringComparer.Ordinal)).Take(2).ToArray();
        if (candidates.Length == 2) throw new GuardException(GuardCode.PreconditionFailed);
        if (candidates.Length == 0) throw new GuardException(GuardCode.UnsupportedAction);
        return candidates[0];
    }
    private static void RequireOperable(ObservedElement element, string pattern)
    {
        if (element.Sensitive is not false) throw new GuardException(GuardCode.NotAuthorized);
        if (element.Enabled is not true || element.Offscreen is not false ||
            (pattern == "Value" && element.ValueReadOnly is not false) ||
            (pattern == "RangeValue" && element.RangeReadOnly is not false))
            throw new GuardException(GuardCode.PreconditionFailed);
    }
    private static string Flag(bool? flag) => flag switch { true => "1", false => "0", null => "?" };
    private void Invalidate()
    {
        bindings.Clear(); surface = NewReference();
        if (sequence == long.MaxValue) { disposed = true; throw new GuardException(GuardCode.ResourceExceeded); }
        revision = (++sequence).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    internal static bool ValidText(string? text, bool allowEmpty = false)
    {
        if (text == null || (!allowEmpty && text.Length == 0) || text.Length > IdentityLimits.Characters) return false;
        for (int index = 0; index < text.Length; index++)
        {
            char character = text[index];
            if (char.IsControl(character) || char.IsLowSurrogate(character)) return false;
            if (char.IsHighSurrogate(character) && (++index >= text.Length || !char.IsLowSurrogate(text[index]))) return false;
        }
        return true;
    }
    private static bool ValidReference(string? text) => text?.Length == 32 && text.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static string NewReference() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
    public void Dispose() { lock (serial) { if (!disposed) { disposed = true; Invalidate(); } } }
}
