using System.Text;
using System.Text.Json;

namespace DualSurface.UiaCapture;

internal static class SuiteUnitCases
{
    public static int Run()
    {
        int cases = 0;
        const string state = "{\"schemaVersion\":\"0.1\",\"kind\":\"p4.2-fixture-state\",\"seed\":\"p4.2-seed-1\",\"revision\":0,\"count\":0,\"value\":\"initial\",\"toggle\":false,\"selection\":\"selection-a\",\"combo\":\"combo-a\",\"radio\":\"radio-a\",\"tab\":\"tab-a\",\"expanded\":false,\"range\":2,\"generation\":1,\"modalResult\":\"none\",\"sensitivePresent\":true}";
        const string ack = "{\"schemaVersion\":\"0.1\",\"kind\":\"p4.2-reset-ack\",\"sequence\":0}";
        Pass(() => Check(FixtureRecords.ParseState(Utf8(state)).Revision == 0));
        Pass(() => Check(FixtureRecords.ParseAck(Utf8(ack)) == 0));
        Pass(() => Check(FixtureRecords.ParseAck(Utf8(ack.Replace("\"sequence\":0", "\"sequence\":512"))) == 512));
        foreach (string prefix in new[] { "state", "reset-ack" })
        {
            Pass(() => Check(FixtureRecords.Ordinal(prefix + "-0001.json", prefix) == 1));
            Pass(() => Check(FixtureRecords.Ordinal(prefix + "-0512.json", prefix) == 512));
            foreach (string suffix in new[] { "0000.json", "0513.json", "9999.json", "001.json", "00001.json", "0001.JSON", "0001.json.extra", "0001.tmp", "00x1.json" })
                Deny(() => FixtureRecords.Ordinal(prefix + "-" + suffix, prefix));
        }
        Deny(() => FixtureRecords.Ordinal("state-0001.json", "unknown"));
        foreach (string invalid in new[] { "", "[]", "null", state + "{}", state[..^1], state.Replace("\"range\":2", "\"range\":null"),
            state.Replace("\"revision\":0", "\"revision\":-1"), state.Replace("\"revision\":0", "\"revision\":1025"),
            state.Replace("\"revision\":0", "\"revision\":0.5"), state.Replace("\"count\":0", "\"count\":129"),
            state.Replace("\"generation\":1", "\"generation\":3"), state.Replace("\"toggle\":false", "\"toggle\":null"),
            state.Replace("\"toggle\":false", "\"toggle\":\"false\""), state.Replace("\"sensitivePresent\":true", "\"sensitivePresent\":false"),
            state.Replace("\"selection-a\"", "\"selection-x\""), state.Replace("\"combo-a\"", "\"combo-x\""),
            state.Replace("\"range\":2", "\"range\":11"), state.Replace("\"range\":2", "\"range\":1e999"),
            state.Replace("\"value\":\"initial\"", "\"value\":\"" + new string('a', 65) + "\""),
            state.Replace("\"schemaVersion\":\"0.1\"", "\"schemaVersion\":\"0.2\""),
            state.Replace("\"kind\":\"p4.2-fixture-state\"", "\"kind\":\"other\""),
            state[..^1] + ",\"extra\":0}", state[..^1] + ",\"toggle\":true}", state[..^1] + ",\"togg\\u006ce\":false}",
            state.Replace("\"value\":\"initial\"", "\"value\":[]"), state.Replace("\"value\":\"initial\"", "\"value\":{}"),
            state.Replace("\"value\":\"initial\"", "\"value\":\"\\ud800\""), new string(' ', 4097) })
            Deny(() => FixtureRecords.ParseState(Utf8(invalid)));
        Deny(() => FixtureRecords.ParseState(new byte[] { 0xef, 0xbb, 0xbf }.Concat(Utf8(state)).ToArray()));
        Deny(() => FixtureRecords.ParseState([0xc0, 0xaf]));
        foreach (string invalid in new[] { ack[..^1] + ",\"sequence\":0}", ack.Replace("\"sequence\":0", "\"sequence\":-1"),
            ack.Replace("\"sequence\":0", "\"sequence\":513"), ack.Replace("\"sequence\":0", "\"sequence\":\"0\""),
            ack.Replace("\"kind\":\"p4.2-reset-ack\"", "\"kind\":\"other\""), ack[..^1] + ",\"extra\":false}" })
            Deny(() => FixtureRecords.ParseAck(Utf8(invalid)));
        Pass(() => Check(SuiteFreeze.Parse(Utf8("{\"a\":{\"x\":1},\"b\":{\"x\":2}}" )).GetProperty("a").GetProperty("x").GetInt32() == 1));
        foreach (string invalid in new[] { "{\"a\":1,\"a\":2}", "{\"a\":{\"x\":1,\"x\":2}}", "{\"a\":[{\"x\":1,\"x\":2}]}",
            "{}{}", "{\"a\":\"\\ud800\"}", new string(' ', 32769) }) Deny(() => SuiteFreeze.Parse(Utf8(invalid)));
        Pass(() => Check(SuiteFreeze.GitBlob("hello\n") == "ce013625030ba8dba906f756967f9e9ca394464a"));
        Pass(() => Check(FixedCaptureSuite.CaseIds.Length == 22 && FixedCaptureSuite.CaseIds.Distinct().Count() == 22));
        Pass(() => Check(FixedCaptureSuite.CaptureIds.Length == 32 && FixedCaptureSuite.CaptureIds.Distinct().Count() == 32));
        Pass(() => Check(SuiteFreeze.SourcePaths.Length == 17 && SuiteFreeze.SourcePaths.Distinct().Count() == 17));
        Pass(() => Check(FixtureRecords.ParseState(Utf8(state)).Same(FixtureRecords.ParseState(Utf8(state)))));
        Pass(() => Check(!FixtureRecords.ParseState(Utf8(state)).Same(FixtureRecords.ParseState(Utf8(state.Replace("\"revision\":0", "\"revision\":1"))))));
        Pass(() => TrustedSetup.RequireRootProof(123, 123, "ControlType.Window", true));
        Pass(() => TrustedSetup.RequireRootProof(123, 123, "ControlType.Pane", false));
        Deny(() => TrustedSetup.RequireRootProof(123, 0, "ControlType.Window", true));
        Deny(() => TrustedSetup.RequireRootProof(123, 124, "ControlType.Window", true));
        Deny(() => TrustedSetup.RequireRootProof(123, 123, "ControlType.Button", true));
        Deny(() => TrustedSetup.RequireRootProof(0, 0, "ControlType.Window", true));
        Deny(() => TrustedSetup.RequireRootProof(123, 123, "Window", false));
        Pass(() => TrustedSetup.RequireContainerProof("fixture-window", "fixture-window"));
        Deny(() => TrustedSetup.RequireContainerProof("fixture-window", null));
        Deny(() => TrustedSetup.RequireContainerProof("fixture-window", "modal-window"));
        Pass(() => Check(FixedCaptureSuite.AuxiliaryCue(123, 0) == ExpectedAuxiliary.None));
        Pass(() => Check(FixedCaptureSuite.AuxiliaryCue(123, 123) == ExpectedAuxiliary.None));
        Pass(() => Check(FixedCaptureSuite.AuxiliaryCue(123, 456) == ExpectedAuxiliary.Popup));
        Deny(() => FixedCaptureSuite.AuxiliaryCue(0, 456));
        Pass(() =>
        {
            var shared = new CaptureBudget();
            Check(shared.AccountInstance("existing")); Check(!shared.AccountInstance("existing"));
            Check(shared.UniqueNodes == 1); // repeats do not become local cycle proof
        });
        Pass(() =>
        {
            var auxiliary = new HashSet<string>();
            for (int index = 0; index < 64; index++) TrustedSetup.AccountAuxiliary(auxiliary, "peer-" + index);
            TrustedSetup.AccountAuxiliary(auxiliary, "peer-0"); Check(auxiliary.Count == 64);
            bool refused = false;
            try { TrustedSetup.AccountAuxiliary(auxiliary, "peer-64"); }
            catch (CaptureException error) when (error.Code == CaptureCode.ResourceExceeded) { refused = true; }
            Check(refused && auxiliary.Count == 64); // before growth
        });
        Pass(() =>
        {
            int calls = 0;
            bool refused = false;
            try { TrustedSetup.MutateBeforeDeadline(() => throw new CaptureException(CaptureCode.ResourceExceeded), () => calls++); }
            catch (CaptureException error) when (error.Code == CaptureCode.ResourceExceeded) { refused = true; }
            Check(refused && calls == 0);
        });
        Pass(() =>
        {
            int checks = 0, calls = 0;
            bool refused = false;
            try { TrustedSetup.MutateBeforeDeadline(() => { if (++checks == 2) throw new CaptureException(CaptureCode.ResourceExceeded); }, () => calls++); }
            catch (CaptureException error) when (error.Code == CaptureCode.ResourceExceeded) { refused = true; }
            Check(refused && calls == 1 && checks == 2); // post-call timeout is not native success
        });
        Pass(() =>
        {
            int checks = 0, calls = 0;
            TrustedSetup.MutateBeforeDeadline(() => checks++, () => calls++);
            Check(calls == 1 && checks == 2);
        });
        // Synthetic grammar input only, never repository review or authorization.
        string source = "sha256:" + new string('a', 64), stale = "sha256:" + new string('9', 64);
        string[] agents = ["/root/p42_security_review", "/root/p42_accessibility_interop_review", "/root/p42_package_gate_review"];
        string Review(string agent) => "# Synthetic parser review\n\nReviewer agent: " + agent +
            "\nDisposition: source-approved\nReviewed source: " + source + "\nUnresolved Critical/High/Medium: 0\n\nSynthetic only.\n";
        string decision = "# Synthetic parser decision\n\nNative execution: authorized for the frozen fixed suite only\nReviewed source: " + source + "\n\nSynthetic only.\n";
        foreach (string agent in agents) Pass(() => SuiteFreeze.RequireApprovalMetadata(Review(agent), source, agent));
        Pass(() => SuiteFreeze.RequireApprovalMetadata(decision, source));
        Pass(() => { SuiteFreeze.RequireApprovalMetadata(Review(agents[0]).Replace("\n", "\r\n"), source, agents[0]);
            SuiteFreeze.RequireApprovalMetadata(decision.Replace("\n", "\r\n"), source); });
        string synthetic = Review(agents[0]);
        foreach (string opening in new[] { "<div hidden>", "<script>", "<pre>", "<template>", "<div>\n<pre>",
            "<!DOCTYPE hidden>", "<?hidden?>", "<!-- hidden", "<div>" })
        {
            Deny(() => SuiteFreeze.RequireApprovalMetadata(synthetic.Replace("\n\nReviewer agent:", "\n\n" + opening + "\nReviewer agent:") + "\n</div>\n", source, agents[0]));
            Deny(() => SuiteFreeze.RequireApprovalMetadata(decision.Replace("\n\nNative execution:", "\n\n" + opening + "\nNative execution:") + "\n</div>\n", source));
        }
        foreach (string invalid in new[] {
            string.Join("\n", synthetic.Split('\n').Select(line => "> " + line)),
            synthetic.Replace("Disposition: source-approved", "> Disposition: source-approved"),
            synthetic.Replace("Disposition: source-approved", "\"Disposition: source-approved\""),
            synthetic.Replace("Disposition: source-approved", "`Disposition: source-approved`"),
            synthetic.Replace("Disposition: source-approved", "    Disposition: source-approved"),
            "```md\n" + synthetic + "```\n", "~~~~markdown\n" + synthetic + "~~~~\n",
            "````md\n```\n" + synthetic + "````\n", "```\u2028markdown\n" + synthetic + "```\n",
            synthetic + "```md\nunfinished history\n", synthetic + "\nDisposition: source-approved\n",
            synthetic + "\nDisposition: refused\n", synthetic + "\n> History \"Disposition: source-approved\"\n",
            synthetic + "\n~~~\nReviewed source: " + stale + "\n~~~\n",
            synthetic.Replace("Disposition: source-approved", "Historical marker reference Disposition: source-approved"),
            synthetic.Replace(source, stale), synthetic.Replace(agents[0], agents[1]),
            synthetic.Replace("Unresolved Critical/High/Medium: 0", "Unresolved Critical/High/Medium: 1"),
            synthetic.Replace("Unresolved Critical/High/Medium: 0\n", ""), synthetic + "\nNative execution: not authorized\n",
            "<!--\n" + synthetic + "-->\n", synthetic.Replace("Reviewed source: " + source, "> Historical note\nReviewed source: " + source),
            synthetic + "\n<!-- unfinished\n", "\ufeff" + synthetic, synthetic.Replace("\n", "\r"),
            synthetic + "\ud800", synthetic + "\0", synthetic + new string('ก', 350000),
        }) Deny(() => SuiteFreeze.RequireApprovalMetadata(invalid, source, agents[0]));
        foreach (string invalid in new[] {
            decision.Replace("Native execution:", "> Native execution:"), "~~~\n" + decision + "~~~\n",
            decision + "\nNative execution: authorized for the frozen fixed suite only\n", decision + "\nNative execution: not authorized\n",
            decision.Replace("Native execution:", "History quotation Native execution:"), decision.Replace(source, stale),
            decision + "\nReviewer agent: " + agents[0] + "\n", decision + "\nDisposition: source-approved\n",
            decision.Replace("Reviewed source: " + source + "\n", ""),
            decision.Replace("authorized for the frozen fixed suite only", "authorized for any application"),
        }) Deny(() => SuiteFreeze.RequireApprovalMetadata(invalid, source));
        Pass(() => {
            bool refused = false;
            try { SuiteFreeze.RequireApprovalMetadata(synthetic, source, "/root"); }
            catch (CaptureException error) when (error.Code == CaptureCode.InvalidObservation) { refused = true; }
            Check(refused);
        });
        Deny(() => SuiteFreeze.RequireApprovalMetadata(synthetic, source + "\n", agents[0]));
        Deny(() => SuiteFreeze.RequireApprovalMetadata(decision, source.ToUpperInvariant()));
        var diagnosticPins = new SuitePins(source, "sha256:" + new string('2', 64), "sha256:" + new string('3', 64));
        const string time = "2026-10-04T08:00:00.000Z";
        var tuple = new FailureTuple("initial", "setup", "is-password", "not-supported", "InvalidObservation");
        string failure = Encoding.UTF8.GetString(FailureDiagnostics.Encode(diagnosticPins, tuple, null, time));
        foreach (string stage in FailureDiagnostics.Stages)
            Pass(() => FailureDiagnostics.Encode(diagnosticPins, new(stage is "output" or "startup" or "cleanup" ? "bootstrap" : "initial",
                stage, null, "guard-refused", "InvalidObservation"), null, time));
        foreach (string code in FailureDiagnostics.Codes)
            Pass(() => FailureDiagnostics.Encode(diagnosticPins, new("initial", "setup", null,
                code == "Timeout" ? "timeout" : code == "Unexpected" ? "unexpected" : "guard-refused", code), null, time));
        foreach (string label in FailureDiagnostics.PropertySites)
            foreach (string classification in new[] { "not-supported", "malformed-property" })
                Pass(() => FailureDiagnostics.Encode(diagnosticPins, tuple with { Site = label, Classification = classification }, null, time));
        foreach (string invalid in new[]
        {
            "", "[]", "null", failure + "{}", failure[..^1], failure[..^1] + ",\"extra\":null}",
            failure[..^1] + ",\"site\":null}", failure[..^1] + ",\"s\\u0069te\":null}",
            failure.Replace("\"site\":\"is-password\"", "\"site\":{}"),
            failure.Replace("\"site\":\"is-password\"", "\"site\":42"),
            failure.Replace("\"site\":\"is-password\"", "\"site\":true"),
            failure.Replace("\"site\":\"is-password\"", "\"site\":\"unknown\""),
            failure.Replace("\"case\":\"initial\"", "\"case\":\"bootstrap\""),
            failure.Replace("\"case\":\"initial\"", "\"case\":\"unknown\""),
            failure.Replace("\"stage\":\"setup\"", "\"stage\":\"capture\""),
            failure.Replace("\"classification\":\"not-supported\"", "\"classification\":\"typed-supported\""),
            failure.Replace("\"code\":\"InvalidObservation\"", "\"code\":\"Unexpected\""),
            failure.Replace("\"cleanupCode\":null", "\"cleanupCode\":\"unknown\""),
            failure.Replace(time, "2026-02-30T08:00:00.000Z"), failure.Replace(time, "2026-10-04T25:00:00.000Z"),
            failure.Replace(time, "2026-10-04T08:00:00.000+00:00"), failure.Replace(time, "2026-10-04T08:00:00Z"),
            failure.Replace(source, stale), failure.Replace("\"schemaVersion\":\"0.1\"", "\"schemaVersion\":null"),
            failure.Replace("\"site\":\"is-password\"", "\"site\":\"\\ud800\""), new string(' ', 4097),
        }) Deny(() => FailureDiagnostics.Parse(Utf8(invalid), diagnosticPins));
        Deny(() => FailureDiagnostics.Parse([0xc0, 0xaf], diagnosticPins));
        Deny(() => FailureDiagnostics.Parse(new byte[] { 0xef, 0xbb, 0xbf }.Concat(Utf8(failure)).ToArray(), diagnosticPins));
        foreach (var malformed in new[] { diagnosticPins with { SourceDigest = source + "\n" },
            diagnosticPins with { CollectorBinaryDigest = diagnosticPins.CollectorBinaryDigest + "\n" },
            diagnosticPins with { FixtureBinaryDigest = diagnosticPins.FixtureBinaryDigest + "\n" } })
            Deny(() => FailureDiagnostics.Encode(malformed, tuple, null, time));
        Deny(() => FailureDiagnostics.Encode(diagnosticPins, new("bootstrap", "cleanup", "owned-stop", "unexpected", "Unexpected"), "Timeout", time));
        Pass(() =>
        {
            var context = new FailureDiagnostics(); context.SetCase("initial");
            object unsupported = new object(); int reads = 0, deadlines = 0;
            bool denied = false;
            try { context.ReadRequired<bool>("is-password", () => { reads++; return unsupported; },
                () => { if (++deadlines == 2) throw new CaptureException(CaptureCode.ResourceExceeded); }, unsupported); }
            catch (CaptureException error) when (error.Code == CaptureCode.ResourceExceeded) { denied = true; }
            Check(denied && reads == 1 && deadlines == 2 && context.Primary is { Classification: "guard-refused", Code: "ResourceExceeded", Site: "is-password" });
        });
        Pass(() =>
        {
            var context = new FailureDiagnostics(); context.SetCase("initial"); object sentinel = new object();
            try { context.ReadRequired<bool>("is-password", () => sentinel, () => { }, sentinel); } catch (CaptureException) { }
            var primary = context.Primary; int afterRefusal = 0;
            try { context.At("sdk-mutation", () => afterRefusal++); } catch (CaptureException) { }
            context.Cleanup(() => throw new TimeoutException("secret provider / path / native ID"));
            context.Latch(new SecretException());
            Check(afterRefusal == 0 && primary == context.Primary && context.CleanupCode == "Timeout" && !context.TryPublish());
            string encoded = Encoding.UTF8.GetString(FailureDiagnostics.Encode(diagnosticPins, context.Primary!, context.CleanupCode, time));
            Check(!encoded.Contains("secret", StringComparison.Ordinal) && context.Primary is { Classification: "not-supported" });
        });
        Pass(() =>
        {
            var context = new FailureDiagnostics(); context.SetCase("initial"); int reads = 0;
            try { context.ReadRequired<bool>("is-password", () => { reads++; return new SecretObject(); }, () => { }, new object()); }
            catch (CaptureException) { }
            Check(reads == 1 && context.Primary is { Classification: "malformed-property" });
        });
        Pass(() =>
        {
            var context = new FailureDiagnostics(); context.SetCase("initial");
            context.At("is-password", () => true); context.SetStage("capture");
            try { context.At("capture-call", () => throw new SecretException()); } catch (SecretException) { }
            Check(context.Primary is { Site: "capture-call", Classification: "unexpected", Code: "Unexpected" });
        });
        foreach (Type expected in new[] { typeof(System.Windows.Automation.ElementNotEnabledException),
            typeof(System.Windows.Automation.ElementNotEnabledException), typeof(InvalidOperationException), typeof(ArgumentException) })
            Pass(() =>
            {
                var context = new FailureDiagnostics(); context.SetCase("disabled");
                bool rejected = context.At("sdk-mutation", () => TrustedSetup.Rejected(
                    () => throw (Exception)Activator.CreateInstance(expected)!, expected));
                int continued = 0; context.At("sdk-mutation", () => continued++);
                Check(rejected && context.Primary == null && continued == 1);
            });
        Pass(() =>
        {
            var context = new FailureDiagnostics(); context.SetCase("initial");
            bool stopped = false; int closed = 0;
            Action[] closures = [() => { Check(stopped); closed++; throw new SecretException(); }, () => closed++, () => closed++, () => closed++, () => closed++];
            Check(!context.CleanupOnce(ref stopped, closures));
            Check(context.CleanupOnce(ref stopped, closures) && closed == 5);
            Check(context.Primary is { Stage: "cleanup", Site: "owned-stop" } && context.CleanupCode == null);
            stopped = false; // pure seam simulates a separately created owned lifetime, no actual process
            Check(context.CleanupOnce(ref stopped, [() => closed++]) && closed == 6);
        });
        Pass(() =>
        {
            bool attempted = false; int writes = 0;
            Check(!FailureDiagnostics.PublishOnce(ref attempted, () => { writes++; throw new System.IO.IOException("collision/partial secret"); }));
            Check(!FailureDiagnostics.PublishOnce(ref attempted, () => writes++) && writes == 1);
        });
        foreach (Type fault in new[] { typeof(System.Windows.Automation.ElementNotAvailableException),
            typeof(System.Windows.Automation.ElementNotEnabledException), typeof(TimeoutException) })
            Pass(() =>
            {
                var context = new FailureDiagnostics(); context.SetCase("initial");
                try { context.At("is-password", () => throw (Exception)Activator.CreateInstance(fault)!); } catch (Exception) { }
                Check(context.Primary?.Classification == (fault == typeof(TimeoutException) ? "timeout" : "sdk-fault"));
                _ = FailureDiagnostics.Encode(diagnosticPins, context.Primary!, null, time);
            });
        // No native admission, process, property getter, filesystem API or fixture
        // startup is called by these parsing/workload units.
        return cases;
        void Pass(Action action) { action(); cases++; }
        void Deny(Action action)
        {
            bool denied = false;
            try { action(); } catch (CaptureException error) when (error.Code == CaptureCode.InvalidObservation) { denied = true; }
            if (!denied) throw new InvalidOperationException("suite_unit_failed"); cases++;
        }
    }
    private static byte[] Utf8(string text) => Encoding.UTF8.GetBytes(text);
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("suite_unit_failed"); }
    private sealed class SecretObject { public override string ToString() => throw new InvalidOperationException("must_not_stringify"); }
    private sealed class SecretException : Exception
    {
        public override string Message => throw new InvalidOperationException("must_not_inspect_message");
        public override string ToString() => throw new InvalidOperationException("must_not_stringify_error");
    }
}
