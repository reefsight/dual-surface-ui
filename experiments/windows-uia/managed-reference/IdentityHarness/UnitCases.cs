namespace DualSurface.UiaReference;

internal static class UnitCases
{
    private static ObservedElement Node(string id, string instance, string? parent = "root", string type = "Button", string[]? patterns = null) =>
        new(id, type, instance, parent, patterns ?? ["Invoke"], true, false, false, false);
    private static IdentityObservation Healthy() => new("window", 0, [
        Node("window", "root", null, "Window", []), Node("target", "target")]);
    private static readonly HostTarget Target = new("target", "Button", "Invoke", "window");

    public static IReadOnlyList<string> Run()
    {
        var passed = new List<string>();
        void Case(string id, Action run) { run(); passed.Add(id); }
        void Denied(Action run, GuardCode code)
        {
            try { run(); }
            catch (GuardException error) { Check(error.Code == code); return; }
            throw new InvalidOperationException();
        }
        Case("current-receipt", () => { using var catalog = new IdentityCatalog(Healthy); Check(catalog.Validate(catalog.Discover(Target)).Allowed); });
        Case("malformed-receipts", () =>
        {
            using var catalog = new IdentityCatalog(Healthy);
            foreach (var value in new BindingReceipt?[] { null, new(null!, "a", "1"), new("a", "b", null!),
                new(new('a', 32), new('b', 32), ""), new(new('a', 32), new('b', 32), "x"),
                new(new('a', 32), new('b', 32), new('1', 20)) }) Check(catalog.Validate(value).Code == GuardCode.PreconditionFailed);
        });
        Case("unknown-receipt-no-observation", () =>
        {
            int observations = 0;
            using var catalog = new IdentityCatalog(() => { observations++; return Healthy(); });
            var receipt = catalog.Discover(Target); int before = observations;
            Check(catalog.Validate(receipt with { ElementRef = new('0', 32) }).Code == GuardCode.StaleRevision);
            Check(observations == before);
        });
        void Replacement(string id, Func<IdentityObservation, IdentityObservation> change)
        {
            Case(id, () =>
            {
                var observation = Healthy(); using var catalog = new IdentityCatalog(() => observation);
                var receipt = catalog.Discover(Target); observation = change(observation);
                Check(catalog.Validate(receipt).Code == GuardCode.StaleRevision);
                observation = Healthy(); Check(!catalog.Validate(receipt).Allowed);
            });
        }
        Replacement("instance-replacement", value => value with { Elements = [value.Elements[0], Node("target", "new-target")] });
        Replacement("window-replacement", value => value with { WindowEpoch = "new-window" });
        Replacement("reset-with-identical-tree", value => value with { FixtureEpoch = 1 });
        Replacement("container-replacement", value => value with { Elements = [Node("window", "new-root", null, "Window", []), Node("target", "target", "new-root")] });
        Replacement("pattern-removed", value => value with { Elements = [value.Elements[0], Node("target", "target", patterns: [])] });
        Replacement("enabled-change", value => value with { Elements = [value.Elements[0], value.Elements[1] with { Enabled = false }] });
        Replacement("target-removed", value => value with { Elements = [value.Elements[0]] });
        Replacement("container-reparented", value => value with { Elements = [value.Elements[0],
            Node("other-container", "other-container", type: "Group", patterns: []), Node("target", "target", "other-container")] });
        Replacement("ambiguity-then-recovery", value => value with { Elements = [..value.Elements, Node("target", "second")] });
        Case("observation-order-invariant", () =>
        {
            var value = Healthy(); using var catalog = new IdentityCatalog(() => value);
            var receipt = catalog.Discover(Target); value = value with { Elements = value.Elements.Reverse().ToArray() };
            Check(catalog.Validate(receipt).Allowed);
        });
        Case("exact-string-boundary", () =>
        {
            using var catalog = new IdentityCatalog(() => Healthy() with { WindowEpoch = new('w', 256) });
            Check(catalog.Validate(catalog.Discover(Target)).Allowed);
        });
        Case("exact-depth-boundary", () =>
        {
            var nodes = new List<ObservedElement> { Healthy().Elements[0] };
            for (int i = 0; i < 16; i++) nodes.Add(Node(i == 15 ? "target" : "n", "n" + i, i == 0 ? "root" : "n" + (i - 1)));
            using var catalog = new IdentityCatalog(() => new("window", 0, nodes));
            Check(catalog.Validate(catalog.Discover(Target)).Allowed);
        });
        Case("exact-node-boundary", () =>
        {
            var nodes = new List<ObservedElement>(Healthy().Elements);
            for (int group = 0; group < 4; group++)
            {
                string instance = "group" + group; nodes.Add(Node("group", instance, type: "Group", patterns: []));
                for (int child = 0; child < (group < 2 ? 63 : 62); child++) nodes.Add(Node("leaf", instance + "leaf" + child, instance));
            }
            Check(nodes.Count == 256);
            using var catalog = new IdentityCatalog(() => new("window", 0, nodes));
            Check(catalog.Validate(catalog.Discover(Target)).Allowed);
        });
        Case("exact-child-boundary", () =>
        {
            var nodes = Healthy().Elements.Concat(Enumerable.Range(0, 63).Select(i => Node("leaf", "leaf" + i))).ToArray();
            using var catalog = new IdentityCatalog(() => new("window", 0, nodes));
            Check(catalog.Validate(catalog.Discover(Target)).Allowed);
        });
        Case("readonly-nonvalue-pattern", () =>
        {
            var value = Healthy() with { Elements = [Healthy().Elements[0],
                Node("combo", "combo", type: "ComboBox", patterns: ["Value", "ExpandCollapse"]) with { ReadOnly = true }] };
            using var catalog = new IdentityCatalog(() => value);
            Check(catalog.Validate(catalog.Discover(new("combo", "ComboBox", "ExpandCollapse", "window"))).Allowed);
            Denied(() => catalog.Discover(new("combo", "ComboBox", "Value", "window")), GuardCode.PreconditionFailed);
        });
        Case("qualified-wrapper-not-ambiguity", () =>
        {
            var observation = Healthy(); observation = observation with { Elements = [..observation.Elements, Node("target", "wrapper", type: "Text", patterns: [])] };
            using var catalog = new IdentityCatalog(() => observation); Check(catalog.Validate(catalog.Discover(Target)).Allowed);
        });
        Case("duplicate-qualified-target", () =>
        {
            var observation = Healthy(); observation = observation with { Elements = [..observation.Elements, Node("target", "second")] };
            using var catalog = new IdentityCatalog(() => observation); Denied(() => catalog.Discover(Target), GuardCode.PreconditionFailed);
        });
        Case("duplicate-container", () =>
        {
            var observation = Healthy(); observation = observation with { Elements = [..observation.Elements, Node("window", "second-container", type: "Group", patterns: [])] };
            using var catalog = new IdentityCatalog(() => observation); Denied(() => catalog.Discover(Target), GuardCode.PreconditionFailed);
        });
        void Malformed(string id, IdentityObservation? observation, GuardCode expected)
        {
            Case(id, () =>
            {
                IdentityObservation? value = Healthy(); using var catalog = new IdentityCatalog(() => value!);
                var receipt = catalog.Discover(Target); value = observation;
                Check(catalog.Validate(receipt).Code == expected);
                value = Healthy(); Check(!catalog.Validate(receipt).Allowed);
            });
        }
        Malformed("null-observation", null, GuardCode.ResourceExceeded);
        Malformed("null-elements", new("window", 0, null!), GuardCode.ResourceExceeded);
        Malformed("null-node", new("window", 0, [null!]), GuardCode.ResourceExceeded);
        Malformed("null-patterns", new("window", 0, [Healthy().Elements[0], Healthy().Elements[1] with { Patterns = null! }]), GuardCode.ResourceExceeded);
        Malformed("wrong-root-type", new("window", 0, [Healthy().Elements[0] with { ControlType = "Button" }, Healthy().Elements[1]]), GuardCode.PreconditionFailed);
        Malformed("negative-reset-epoch", Healthy() with { FixtureEpoch = -1 }, GuardCode.ResourceExceeded);
        Malformed("duplicate-patterns", new("window", 0, [Healthy().Elements[0], Node("target", "target", patterns: ["Invoke", "Invoke"])]), GuardCode.PreconditionFailed);
        Malformed("self-parent", new("window", 0, [Healthy().Elements[0], Node("target", "target", "target")]), GuardCode.PreconditionFailed);
        Malformed("disconnected-cycle", new("window", 0, [Healthy().Elements[0], Node("target", "target", "other"), Node("other", "other", "target")]), GuardCode.PreconditionFailed);
        Malformed("multiple-roots", new("window", 0, [Healthy().Elements[0], Node("target", "target", null)]), GuardCode.PreconditionFailed);
        Malformed("missing-parent", new("window", 0, [Healthy().Elements[0], Node("target", "target", "absent")]), GuardCode.PreconditionFailed);
        Malformed("duplicate-instance", new("window", 0, [Healthy().Elements[0], Node("target", "root")]), GuardCode.PreconditionFailed);
        Malformed("string-overflow", new(new('w', 257), 0, Healthy().Elements), GuardCode.ResourceExceeded);
        Malformed("lone-high-surrogate", Healthy() with { WindowEpoch = "\ud800" }, GuardCode.ResourceExceeded);
        Malformed("lone-low-surrogate", Healthy() with { WindowEpoch = "\udc00" }, GuardCode.ResourceExceeded);
        Case("valid-surrogate-pair", () =>
        {
            using var catalog = new IdentityCatalog(() => Healthy() with { WindowEpoch = "\ud83d\ude00" });
            Check(catalog.Validate(catalog.Discover(Target)).Allowed);
        });
        Case("unknown-safety-flags", () =>
        {
            foreach (object? value in new object?[] { null, "false", 0, System.Windows.Automation.AutomationElement.NotSupported })
                Denied(() => NativeObservation.RequireBoolean(value), GuardCode.PreconditionFailed);
            Check(NativeObservation.RequireBoolean(true) && !NativeObservation.RequireBoolean(false));
        });
        Malformed("node-overflow", new("window", 0, Enumerable.Range(0, 257).Select(i => Node("n", "n" + i)).ToArray()), GuardCode.ResourceExceeded);
        Malformed("child-overflow", new("window", 0, [Healthy().Elements[0], ..Enumerable.Range(0, 65).Select(i => Node("n", "n" + i))]), GuardCode.ResourceExceeded);
        Malformed("depth-overflow", new("window", 0, [Healthy().Elements[0], ..Enumerable.Range(0, 17).Select(i => Node("n", "n" + i, i == 0 ? "root" : "n" + (i - 1)))]), GuardCode.ResourceExceeded);
        Malformed("pattern-overflow", new("window", 0, [Healthy().Elements[0], Node("target", "target", patterns: Enumerable.Range(0, 17).Select(i => "p" + i).ToArray())]), GuardCode.ResourceExceeded);
        Malformed("aggregate-text-overflow", new("window", 0, [Healthy().Elements[0], ..Enumerable.Range(0, 33).Select(i =>
            Node("n", "n" + i, patterns: Enumerable.Range(0, 16).Select(p => p.ToString("D4") + new string('x', 252)).ToArray()))]), GuardCode.ResourceExceeded);
        Case("copied-pattern-array", () =>
        {
            string[] external = ["Invoke"];
            ObservedElement[] nodes = [Healthy().Elements[0], Node("target", "target", patterns: external), Node("other", "other")];
            var changing = new IndexedList<ObservedElement>(nodes, index => { if (index == 2) external[0] = "Value"; });
            var observation = new IdentityObservation("window", 0, changing);
            using var catalog = new IdentityCatalog(() => observation);
            var receipt = catalog.Discover(Target); // earlier target's pattern is privately copied before mutation
            Check(!catalog.Validate(receipt).Allowed);
        });
        Case("indexed-list-fault-recovery", () =>
        {
            var healthy = Healthy(); bool broken = false;
            var throwing = new IndexedList<ObservedElement>(healthy.Elements, _ => throw new Exception("untrusted collection text"));
            using var catalog = new IdentityCatalog(() => broken ? healthy with { Elements = throwing } : healthy);
            var receipt = catalog.Discover(Target); broken = true;
            Check(catalog.Validate(receipt).Code == GuardCode.SurfaceUnavailable);
            broken = false; Check(!catalog.Validate(receipt).Allowed);
        });
        Case("observation-deadline-recovery", () =>
        {
            bool delayed = false;
            using var catalog = new IdentityCatalog(() => { if (delayed) Thread.Sleep(10050); return Healthy(); });
            var receipt = catalog.Discover(Target); delayed = true;
            Check(catalog.Validate(receipt).Code == GuardCode.ResourceExceeded);
            delayed = false; Check(!catalog.Validate(receipt).Allowed);
        });
        Case("provider-disconnect-recovery", () =>
        {
            bool broken = false; using var catalog = new IdentityCatalog(() => broken ? throw new Exception("never serialize provider text") : Healthy());
            var receipt = catalog.Discover(Target); broken = true;
            Check(catalog.Validate(receipt).Code == GuardCode.SurfaceUnavailable);
            broken = false; Check(!catalog.Validate(receipt).Allowed);
        });
        foreach (string flag in new[] { "disabled", "offscreen", "sensitive", "readonly" })
        {
            Case(flag, () =>
            {
                var value = Healthy(); var node = value.Elements[1];
                node = flag switch { "disabled" => node with { Enabled = false }, "offscreen" => node with { Offscreen = true },
                    "sensitive" => node with { Sensitive = true }, _ => node with { ReadOnly = true, ControlType = "Edit", Patterns = new[] { "Value" } } };
                value = value with { Elements = [value.Elements[0], node] };
                using var catalog = new IdentityCatalog(() => value);
                var definition = flag == "readonly" ? new HostTarget("target", "Edit", "Value", "window") : Target;
                Denied(() => catalog.Discover(definition), flag == "sensitive" ? GuardCode.NotAuthorized : GuardCode.PreconditionFailed);
            });
        }
        Case("binding-cap", () =>
        {
            using var catalog = new IdentityCatalog(Healthy);
            for (int i = 0; i < IdentityLimits.Bindings; i++) catalog.Discover(Target);
            Denied(() => catalog.Discover(Target), GuardCode.ResourceExceeded);
        });
        Case("dispose-invalidates", () =>
        {
            using var catalog = new IdentityCatalog(Healthy); var receipt = catalog.Discover(Target); catalog.Dispose();
            Check(catalog.Validate(receipt).Code == GuardCode.StaleRevision);
            Denied(() => catalog.Discover(Target), GuardCode.SurfaceUnavailable);
        });
        Case("serialized-validation", () =>
        {
            using var catalog = new IdentityCatalog(Healthy); var receipt = catalog.Discover(Target);
            Parallel.For(0, 64, _ => Check(catalog.Validate(receipt).Allowed));
        });
        return passed.AsReadOnly();
    }
    public static void Check(bool value) { if (!value) throw new InvalidOperationException("identity_assertion_failed"); }

    private sealed class IndexedList<T>(IReadOnlyList<T> values, Action<int> onRead) : IReadOnlyList<T>
    {
        public int Count => values.Count;
        public T this[int index] { get { onRead(index); return values[index]; } }
        public IEnumerator<T> GetEnumerator() => values.GetEnumerator();
        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    }
}
