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
        Pass(() => Check(SuiteFreeze.SourcePaths.Length == 13 && SuiteFreeze.SourcePaths.Distinct().Count() == 13));
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
}
