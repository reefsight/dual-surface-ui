using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

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
        Pass(() => Check(SuiteFreeze.SourcePaths.Length == 20 && SuiteFreeze.SourcePaths.Distinct().Count() == 20));
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
        string[] agents = ["/root/ctx1_source_security", "/root/ctx1_source_interop", "/root/ctx1_source_package"];
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
        foreach (string oldAgent in new[] { "/root/p42_security_review", "/root/p42_accessibility_interop_review", "/root/p42_package_gate_review" })
            Deny(() => SuiteFreeze.RequireApprovalMetadata(Review(oldAgent), source, oldAgent));
        // Synthetic fixed-input provenance. No repository approval/native proof.
        var provenancePins = new SuitePins(source, stale, SuiteFreeze.FixtureDigest);
        Pass(() => {
            int admissions = 0, launches = 0, timeChecks = 0;
            Check(SuiteFreeze.BeforeFixtureStart(provenancePins, () => { admissions++; return provenancePins; }, () => timeChecks++, () => ++launches) == 1);
            Check(admissions == 1 && launches == 1 && timeChecks == 2);
        });
        foreach (var current in new[] { provenancePins with { SourceDigest = stale }, provenancePins with { CollectorBinaryDigest = source },
            provenancePins with { FixtureBinaryDigest = stale } })
            Pass(() => {
                int launches = 0; bool refused = false;
                try { SuiteFreeze.BeforeFixtureStart(provenancePins, () => current, () => { }, () => ++launches); }
                catch (CaptureException) { refused = true; }
                Check(refused && launches == 0);
            });
        Pass(() => {
            int launches = 0; bool refused = false;
            try { SuiteFreeze.BeforeFixtureStart(provenancePins, () => throw new CaptureException(CaptureCode.InvalidObservation), () => { }, () => ++launches); }
            catch (CaptureException) { refused = true; }
            Check(refused && launches == 0);
        });
        foreach (int failedCheck in new[] { 1, 2 })
            Pass(() => {
                int admissions = 0, launches = 0, timeChecks = 0; bool refused = false;
                try { SuiteFreeze.BeforeFixtureStart(provenancePins, () => { admissions++; return provenancePins; },
                    () => { if (++timeChecks == failedCheck) throw new CaptureException(CaptureCode.ResourceExceeded); }, () => ++launches); }
                catch (CaptureException error) when (error.Code == CaptureCode.ResourceExceeded) { refused = true; }
                Check(refused && launches == 0 && admissions == failedCheck - 1);
            });
        var execution = JsonSerializer.SerializeToElement(SuiteFreeze.ExecutionPaths.Select(path => new { path, digest = stale }).ToArray());
        var buildFiles = JsonSerializer.SerializeToElement(SuiteFreeze.BuildPaths.Select(path => new { path, digest = source }).ToArray());
        const string commit = "1111111111111111111111111111111111111111";
        string provenance = JsonSerializer.Serialize(new {
            schemaVersion = "0.1", kind = "p4.3-native-suite-ctx1-build-provenance", sourceCommit = commit, sourceDigest = source,
            buildInputs = new { sdkVersion = "10.0.401", sdkArchiveDigest = "24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430",
                project = "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/CaptureSuiteCtx1.csproj", configuration = "Release",
                arguments = new[] { "build", "CaptureSuiteCtx1/CaptureSuiteCtx1.csproj", "-c", "Release", "-t:Rebuild", "--nologo" }, files = buildFiles },
            builds = new[] { "first", "repeat" }.Select(lane => new { lane, collectorBinaryDigest = stale,
                informationalRevision = commit, sourceLinkRevision = commit, executionFiles = execution }).ToArray()
        });
        Pass(() => Check(SuiteFreeze.BuildPaths.Length == 15 && SuiteFreeze.BuildPaths.Distinct().Count() == 15));
        Pass(() => SuiteFreeze.RequireBuildProvenance(Utf8(provenance), provenancePins, execution, buildFiles));
        foreach (string invalid in new[] {
            provenance.Replace("10.0.401", "10.0.402"), provenance.Replace("Release", "Debug"),
            provenance.Replace("-t:Rebuild", "-t:Build"), provenance.Replace("\"repeat\"", "\"first\""),
            provenance.Replace("\"sourceLinkRevision\":\"" + commit, "\"sourceLinkRevision\":\"" + new string('2', 40)),
            provenance.Replace("\"sourceCommit\":\"" + commit, "\"sourceCommit\":\"" + new string('2', 40)),
            provenance.Replace("\"sourceDigest\":\"" + source, "\"sourceDigest\":\"" + stale),
            provenance.Replace("\"digest\":\"" + source, "\"digest\":\"" + stale),
            provenance.Replace("\"digest\":\"" + stale, "\"digest\":\"" + source),
            provenance.Replace("global.json", "GLOBAL.json"), provenance.Replace(".deps.json", ".runtimeconfig.dev.json"),
            provenance.Replace("\"schemaVersion\":\"0.1\"", "\"schemaVersion\":\"0.1\",\"extra\":0"),
            provenance[..^1] + ",\"sourceCommit\":\"" + commit + "\"}",
            provenance + "{}", "\ufeff" + provenance, new string(' ', 32769),
        }) Deny(() => SuiteFreeze.RequireBuildProvenance(Utf8(invalid), provenancePins, execution, buildFiles));
        foreach (string invalid in new[] { "{\"x\":1,\"\\u0078\":2}", "{\"a\":\"\\ud800\"}",
            "[[[[[[[]]]]]]]", "[" + string.Join(",", Enumerable.Repeat("0", 2047)) + "]",
            "{\"a\":\"" + new string('a', 513) + "\"}", "{\"a\":\"" + new string('ก', 171) + "\"}", "1" + new string('0', 512) })
            Deny(() => SuiteFreeze.Parse(Utf8(invalid), true));
        Deny(() => SuiteFreeze.Parse([0xc0, 0xaf], true));
        Pass(() => SuiteFreeze.Parse(Utf8("{\"x\":\"" + new string('ก', 170) + "\"}"), true));
        Pass(() => SuiteFreeze.Parse(Utf8("[[[[[[]]]]]]"), true));
        Pass(() => SuiteFreeze.Parse(Utf8("1" + new string('0', 511)), true));
        Action<JsonNode>[] provenanceMutations = [
            v => v["extra"] = 1, v => v.AsObject().Remove("sourceCommit"),
            v => v["sourceCommit"] = commit + "\n", v => v["buildInputs"]!["extra"] = 1,
            v => v["buildInputs"]!["sdkArchiveDigest"] = new string('a', 128),
            v => v["buildInputs"]!["project"] = "../CaptureSuite.csproj",
            v => v["buildInputs"]!["arguments"]!.AsArray().Add("-p:SourceRevisionId=x"),
            v => v["buildInputs"]!["files"]!.AsArray().RemoveAt(14),
            v => v["buildInputs"]!["files"]![1] = v["buildInputs"]!["files"]![0]!.DeepClone(),
            v => v["buildInputs"]!["files"]![0]!["extra"] = 1,
            v => v["builds"]!.AsArray().RemoveAt(1),
            v => v["builds"]!.AsArray().Add(v["builds"]![0]!.DeepClone()),
            v => v["builds"]![0]!.AsObject().Remove("sourceLinkRevision"),
            v => v["builds"]![1]!["extra"] = 1,
            v => v["builds"]![1]!["collectorBinaryDigest"] = source,
            v => v["builds"]![1]!["informationalRevision"] = new string('2', 40),
            v => v["builds"]![1]!["executionFiles"]!.AsArray().RemoveAt(3),
            v => v["builds"]![0]!["executionFiles"]!.AsArray().Add(v["builds"]![0]!["executionFiles"]![0]!.DeepClone()),
            v => v["builds"]![0]!["executionFiles"]![0]!["digest"] = new JsonArray(stale),
        ];
        foreach (var mutate in provenanceMutations)
        {
            var v = JsonNode.Parse(provenance)!; mutate(v);
            Deny(() => SuiteFreeze.RequireBuildProvenance(Utf8(v.ToJsonString()), provenancePins, execution, buildFiles));
        }
        string freeze = JsonSerializer.Serialize(new { schemaVersion = "0.1", kind = "p4.3-native-capture-suite-ctx1-freeze", status = "source-approved",
            sourceDigest = source, collectorBinaryDigest = stale, fixtureBinaryDigest = SuiteFreeze.FixtureDigest,
            reviewReports = new[] { "security", "accessibility", "package" }.Select(role => new {
                path = "docs/reviews/p4.3-native-suite-ctx1-" + role + "-agent-review.md", blob = commit }).ToArray(),
            decision = new { path = "docs/reviews/p4.3-native-suite-ctx1-execution-entry-2026-10-15.md", blob = commit },
            executionFiles = execution, buildProvenance = new { path = "docs/evidence/p4.3-native-suite-ctx1-build-provenance.json", blob = commit } });
        Pass(() => SuiteFreeze.RequireFreezeShape(SuiteFreeze.Parse(Utf8(freeze))));
        Action<JsonNode>[] freezeMutations = [
            v => { v.AsObject().Remove("executionFiles"); v.AsObject().Remove("buildProvenance"); },
            v => v["extra"] = 1, v => v["fixtureBinaryDigest"] = source,
            v => v["reviewReports"]![0]!["path"] = "docs/reviews/p4.3-native-suite-d2-security-agent-review.md",
            v => v["reviewReports"]![1] = v["reviewReports"]![0]!.DeepClone(),
            v => v["decision"]!["path"] = "docs/reviews/p4.3-native-suite-d2-execution-entry-2026-10-04.md",
            v => v["buildProvenance"]!["path"] = "other.json",
            v => v["executionFiles"]!.AsArray().RemoveAt(3),
            v => v["executionFiles"]![1] = v["executionFiles"]![0]!.DeepClone(),
            v => v["decision"]!["extra"] = 1, v => v["buildProvenance"]!["blob"] = commit + "\n",
        ];
        foreach (var mutate in freezeMutations)
        {
            var v = JsonNode.Parse(freeze)!; mutate(v);
            Deny(() => SuiteFreeze.RequireFreezeShape(SuiteFreeze.Parse(Utf8(v.ToJsonString()))));
        }
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
        int admissionPairs = 0;
        foreach (var check in Enum.GetValues<AdmissionCheck>()) foreach (var guard in Enum.GetValues<AdmissionGuard>())
        {
            if (!ConstructorAdmissionTrace.TryLabels(check, guard, out var checkLabel, out var guardLabel)) continue;
            admissionPairs++;
            foreach (string caseId in new[] { "bootstrap", "process-restart", "window-replacement" })
                Pass(() => FailureDiagnostics.EncodeD2(diagnosticPins,
                    new(caseId, caseId == "window-replacement" ? "setup" : "startup", "setup-admission", "guard-refused", "Unavailable", checkLabel, guardLabel), null, time));
        }
        Check(admissionPairs == 40);
        var d2Tuple = new FailureTuple("bootstrap", "startup", "setup-admission", "guard-refused", "Unavailable", "worker-desktop", "desktop-name-or-null");
        byte[] d2Bytes = FailureDiagnostics.EncodeD2(diagnosticPins, d2Tuple, null, time);
        string d2 = Encoding.UTF8.GetString(d2Bytes);
        Pass(() => FailureDiagnostics.EncodeD2(diagnosticPins, tuple, null, time)); // ordinary coarse D2 has both null
        Deny(() => FailureDiagnostics.Parse(d2Bytes, diagnosticPins));
        Deny(() => FailureDiagnostics.ParseD2(Utf8(failure), diagnosticPins));
        Deny(() => FailureDiagnostics.Encode(diagnosticPins, d2Tuple, null, time));
        foreach (var invalid in new[]
        {
            d2Tuple with { AdmissionCheck = null }, d2Tuple with { AdmissionGuard = null },
            d2Tuple with { AdmissionCheck = "unknown" }, d2Tuple with { AdmissionGuard = "name-value" },
            d2Tuple with { AdmissionCheck = "window-station", AdmissionGuard = "desktop-input" },
            d2Tuple with { Case = "initial", Stage = "setup" }, d2Tuple with { Case = "window-replacement" },
            d2Tuple with { Case = "process-restart", Stage = "setup" }, d2Tuple with { Stage = "cleanup", Site = "owned-stop" },
            d2Tuple with { Case = "initial", Stage = "capture", Site = "capture-call" },
            d2Tuple with { Site = "fixture-ready" }, d2Tuple with { Classification = "unexpected", Code = "Unexpected" },
            d2Tuple with { Code = "InvalidObservation" }, d2Tuple with { Classification = "timeout", Code = "Timeout" },
        }) Deny(() => FailureDiagnostics.EncodeD2(diagnosticPins, invalid, null, time));
        foreach (string malformed in new[]
        {
            d2 + "{}", d2[..^1], d2[..^1] + ",\"extra\":null}",
            d2[..^1] + ",\"admissionCheck\":null}", d2[..^1] + ",\"admissionCh\\u0065ck\":null}",
            d2.Replace("\"admissionCheck\":\"worker-desktop\"", "\"admissionCheck\":false"),
            d2.Replace("\"admissionCheck\":\"worker-desktop\"", "\"admissionCheck\":{}"),
            d2.Replace("\"admissionGuard\":\"desktop-name-or-null\"", "\"admissionGuard\":\"\\ud800\""),
            d2.Replace(time, "2026-02-30T08:00:00.000Z"), d2.Replace(source, stale),
        }) Deny(() => FailureDiagnostics.ParseD2(Utf8(malformed), diagnosticPins));
        Deny(() => FailureDiagnostics.ParseD2([0xc0, 0xaf], diagnosticPins));
        Deny(() => FailureDiagnostics.ParseD2(new byte[] { 0xef, 0xbb, 0xbf }.Concat(d2Bytes).ToArray(), diagnosticPins));
        Pass(() => FailureDiagnostics.ParseD2(Utf8(d2 + new string(' ', 4096 - d2Bytes.Length)), diagnosticPins));
        Deny(() => FailureDiagnostics.ParseD2(Utf8(d2 + new string(' ', 4097 - d2Bytes.Length)), diagnosticPins));
        foreach (string caseId in new[] { "bootstrap", "process-restart", "window-replacement" })
            Pass(() =>
            {
                var context = new FailureDiagnostics();
                if (caseId != "bootstrap") context.SetCase(caseId);
                if (caseId != "window-replacement") context.SetStage("startup");
                var trace = new ConstructorAdmissionTrace(context.ObserveAdmissionRefusal); int after = 0;
                try { context.At("setup-admission", () => { trace.SetCheck(AdmissionCheck.WorkerDesktop); trace.Refuse(AdmissionGuard.DesktopNameOrNull); after++; }); }
                catch (CaptureException error) when (error.Code == CaptureCode.Unavailable) { }
                finally { trace.Clear(); }
                var first = context.Primary;
                context.ObserveAdmissionRefusal(AdmissionCheck.SubjectToken, AdmissionGuard.TokenOpen);
                context.Cleanup(() => throw new TimeoutException("withheld"));
                Check(after == 0 && first == context.Primary && context.CleanupCode == "Timeout" &&
                    first is { AdmissionCheck: "worker-desktop", AdmissionGuard: "desktop-name-or-null" });
                _ = FailureDiagnostics.EncodeD2(diagnosticPins, first!, context.CleanupCode, time);
            });
        Pass(() =>
        {
            var context = new FailureDiagnostics(); context.SetCase("initial");
            var trace = new ConstructorAdmissionTrace(context.ObserveAdmissionRefusal); trace.SetCheck(AdmissionCheck.SubjectToken);
            try { context.At("setup-admission", () => trace.Refuse(AdmissionGuard.TokenOpen)); }
            catch (CaptureException error) when (error.Code == CaptureCode.Unavailable) { }
            Check(context.Primary is { Code: "Unavailable", AdmissionCheck: null, AdmissionGuard: null });
        });
        foreach (var invalid in new[] { ((AdmissionCheck)(-1), AdmissionGuard.TokenOpen),
            (AdmissionCheck.WorkerDesktop, AdmissionGuard.NameValue), (AdmissionCheck.SubjectToken, (AdmissionGuard)int.MaxValue) })
            Pass(() =>
            {
                var context = new FailureDiagnostics(); context.SetStage("startup"); bool refused = false;
                try { context.ObserveAdmissionRefusal(invalid.Item1, invalid.Item2); }
                catch (CaptureException error) when (error.Code == CaptureCode.InvalidObservation) { refused = true; }
                Check(refused && context.Primary == null);
            });
        // Additional assertions are grouped deliberately; the returned number is
        // executed test groups, never a fabricated count of each inner assertion.
        cases += RunContextCases();
        // No UIA/provider observation, native admission, process or fixture startup.
        // Only the fixed, bounded shared original-byte test corpus is read below.
        Check(cases <= 512);
        return cases;
        void Pass(Action action) { action(); cases++; }
        void Deny(Action action)
        {
            bool denied = false;
            try { action(); } catch (CaptureException error) when (error.Code == CaptureCode.InvalidObservation) { denied = true; }
            if (!denied) throw new InvalidOperationException("suite_unit_failed"); cases++;
        }
    }

    private static int RunContextCases()
    {
        int groups = 0;
        const string time = "2026-10-04T08:00:00.000Z";
        var pins = new SuitePins("sha256:" + new string('1', 64), "sha256:" + new string('2', 64), "sha256:" + new string('3', 64));
        (WindowHandleReadContext Context, string Label)[] routes =
        [
            (WindowHandleReadContext.RootGuard, "root-guard"),
            (WindowHandleReadContext.RootProof, "root-proof"),
            (WindowHandleReadContext.RootIdentity, "root-identity"),
            (WindowHandleReadContext.WalkNodeGuard, "walk-node-guard"),
            (WindowHandleReadContext.WalkNodeIdentity, "walk-node-identity"),
            (WindowHandleReadContext.WalkChildGuard, "walk-child-guard"),
            (WindowHandleReadContext.WalkChildIdentity, "walk-child-identity"),
            (WindowHandleReadContext.WalkCrossRootLeft, "walk-cross-root-left"),
            (WindowHandleReadContext.WalkCrossRootRight, "walk-cross-root-right"),
            (WindowHandleReadContext.WalkParentLeft, "walk-parent-left"),
            (WindowHandleReadContext.WalkParentRight, "walk-parent-right"),
            (WindowHandleReadContext.FenceRootGuard, "fence-root-guard"),
            (WindowHandleReadContext.FenceRootProof, "fence-root-proof"),
            (WindowHandleReadContext.FenceRootLeft, "fence-root-left"),
            (WindowHandleReadContext.FenceRootRight, "fence-root-right"),
            (WindowHandleReadContext.TargetGuard, "target-guard"),
            (WindowHandleReadContext.TargetIdentity, "target-identity"),
            (WindowHandleReadContext.ContainerGuard, "container-guard"),
            (WindowHandleReadContext.ContainerIdentity, "container-identity"),
            (WindowHandleReadContext.TargetChainLeft, "target-chain-left"),
            (WindowHandleReadContext.TargetChainRight, "target-chain-right"),
            (WindowHandleReadContext.TargetChainParent, "target-chain-parent"),
            (WindowHandleReadContext.ContainerChainLeft, "container-chain-left"),
            (WindowHandleReadContext.ContainerChainRight, "container-chain-right"),
            (WindowHandleReadContext.ContainerChainParent, "container-chain-parent"),
            (WindowHandleReadContext.SelectionContainerGuard, "selection-container-guard"),
            (WindowHandleReadContext.SelectionContainerLeft, "selection-container-left"),
            (WindowHandleReadContext.SelectionContainerRight, "selection-container-right"),
        ];
        Pass(() =>
        {
            Check(routes.Length == 28 && Enum.GetValues<WindowHandleReadContext>().Length == 28);
            Check(routes.Select(v => v.Context).Distinct().Count() == 28 && routes.Select(v => v.Label).Distinct().Count() == 28);
            foreach (var route in routes)
            {
                Check((int)route.Context > 0 && FailureDiagnostics.ContextLabel(route.Context) == route.Label);
                Check(FailureDiagnostics.ContextFromLabel(route.Label) == route.Context);
            }
            foreach (int invalid in new[] { 0, -1, int.MaxValue })
                Invalid(() => FailureDiagnostics.ContextLabel((WindowHandleReadContext)invalid));
            Invalid(() => FailureDiagnostics.ContextFromLabel("root-guard "));
            Invalid(() => FailureDiagnostics.ContextFromLabel("unknown"));
        });
        Pass(() =>
        {
            foreach (var role in new[] { SetupEntryRole.Target, SetupEntryRole.Container })
            {
                var qualify = TrustedSetup.QualifyContexts(role); var chain = TrustedSetup.ChainContexts(role);
                Check(qualify == (role == SetupEntryRole.Target
                    ? (WindowHandleReadContext.TargetGuard, WindowHandleReadContext.TargetIdentity)
                    : (WindowHandleReadContext.ContainerGuard, WindowHandleReadContext.ContainerIdentity)));
                Check(chain == (role == SetupEntryRole.Target
                    ? (WindowHandleReadContext.TargetChainLeft, WindowHandleReadContext.TargetChainRight, WindowHandleReadContext.TargetChainParent)
                    : (WindowHandleReadContext.ContainerChainLeft, WindowHandleReadContext.ContainerChainRight, WindowHandleReadContext.ContainerChainParent)));
                // Exercise the actual production selector outputs through the same
                // required-read seam, not a second test-only mapping.
                foreach (var context in new[] { qualify.Guard, qualify.Identity, chain.Left, chain.Right, chain.Parent })
                {
                    var diagnostic = New(); int reads = 0;
                    Check(diagnostic.ReadRequired<int>("window-handle", () => { reads++; return 123; }, () => { }, new object(), context) == 123);
                    Check(reads == 1 && diagnostic.Primary == null);
                }
            }
            foreach (int invalid in new[] { 0, -1, int.MaxValue })
            {
                Invalid(() => TrustedSetup.QualifyContexts((SetupEntryRole)invalid));
                Invalid(() => TrustedSetup.ChainContexts((SetupEntryRole)invalid));
            }
        });
        Pass(() =>
        {
            (WindowHandleReadContext Left, WindowHandleReadContext Right)[] pairs =
            [
                (WindowHandleReadContext.WalkCrossRootLeft, WindowHandleReadContext.WalkCrossRootRight),
                (WindowHandleReadContext.WalkParentLeft, WindowHandleReadContext.WalkParentRight),
                (WindowHandleReadContext.FenceRootLeft, WindowHandleReadContext.FenceRootRight),
                (WindowHandleReadContext.TargetChainLeft, WindowHandleReadContext.TargetChainRight),
                (WindowHandleReadContext.ContainerChainLeft, WindowHandleReadContext.ContainerChainRight),
                (WindowHandleReadContext.SelectionContainerLeft, WindowHandleReadContext.SelectionContainerRight),
            ];
            foreach (var pair in pairs)
            {
                var left = new object(); var right = new object();
                var order = new List<(object Peer, WindowHandleReadContext Context)>();
                string Identity(object peer, WindowHandleReadContext context) { order.Add((peer, context)); return "same"; }
                Check(TrustedSetup.SameIdentity(left, right, pair.Left, pair.Right, Identity));
                Check(order.Count == 2 && ReferenceEquals(order[0].Peer, left) && order[0].Context == pair.Left &&
                    ReferenceEquals(order[1].Peer, right) && order[1].Context == pair.Right);
                order.Clear();
                Check(!TrustedSetup.SameIdentity<object>(null, right, pair.Left, pair.Right, Identity) && order.Count == 0);
                int reads = 0; var error = new SecretException();
                Check(ReferenceEquals(Caught(() => TrustedSetup.SameIdentity(left, right, pair.Left, pair.Right,
                    (_, _) => { reads++; throw error; })), error) && reads == 1);
                reads = 0;
                Check(ReferenceEquals(Caught(() => TrustedSetup.SameIdentity(left, right, pair.Left, pair.Right,
                    (peer, _) => { reads++; if (ReferenceEquals(peer, right)) throw error; return "left"; })), error) && reads == 2);
                Check(!TrustedSetup.SameIdentity(left, right, pair.Left, pair.Right,
                    (peer, _) => ReferenceEquals(peer, left) ? "left" : "right"));
                foreach (int invalid in new[] { 0, -1, int.MaxValue })
                {
                    int calls = 0;
                    Invalid(() => TrustedSetup.SameIdentity(left, right, (WindowHandleReadContext)invalid, pair.Right, (_, _) => { calls++; return ""; }));
                    Invalid(() => TrustedSetup.SameIdentity(left, right, pair.Left, (WindowHandleReadContext)invalid, (_, _) => { calls++; return ""; }));
                    Check(calls == 0);
                }
            }
        });
        Pass(() =>
        {
            foreach (var route in routes)
                foreach (int value in new[] { 0, 123, -1, int.MinValue, int.MaxValue })
                {
                    var diagnostic = New(); int reads = 0, checks = 0; object observed = value;
                    int result = diagnostic.ReadRequired<int>("window-handle", () => { reads++; return observed; }, () => checks++, new object(), route.Context);
                    Check(result == value && reads == 1 && checks == 2 && diagnostic.Primary == null);
                }
        });
        Pass(() =>
        {
            foreach (var route in routes)
            {
                var diagnostic = New(); var sentinel = new object(); int reads = 0, checks = 0;
                var error = Caught(() => diagnostic.ReadRequired<int>("window-handle", () => { reads++; return sentinel; }, () => checks++, sentinel, route.Context));
                Check(error is CaptureException capture && capture.Code == CaptureCode.InvalidObservation && reads == 1 && checks == 2 &&
                    diagnostic.Primary is { Classification: "not-supported", Code: "InvalidObservation", Site: "window-handle" } &&
                    diagnostic.Primary.ReadContext == route.Context);
                _ = FailureDiagnostics.ParseCtx1(FailureDiagnostics.EncodeCtx1(pins, diagnostic.Primary!, null, time), pins);
            }
        });
        Pass(() =>
        {
            foreach (var route in routes)
                foreach (object? value in new object?[] { null, 123L, 123.0, true, "123", new SecretObject(), new HostileEqualityObject() })
                {
                    var diagnostic = New(); int reads = 0, checks = 0;
                    var error = Caught(() => diagnostic.ReadRequired<int>("window-handle", () => { reads++; return value; }, () => checks++, new object(), route.Context));
                    Check(error is CaptureException capture && capture.Code == CaptureCode.InvalidObservation && reads == 1 && checks == 2 &&
                        diagnostic.Primary is { Classification: "malformed-property", Code: "InvalidObservation" } &&
                        diagnostic.Primary.ReadContext == route.Context);
                }
        });
        Pass(() =>
        {
            foreach (var route in routes)
                foreach (int failureAt in new[] { 1, 2 })
                    foreach (object? value in new object?[] { 123, new object(), null })
                    {
                        var diagnostic = New(); var deadline = new CaptureException(CaptureCode.ResourceExceeded);
                        int reads = 0, checks = 0;
                        var error = Caught(() => diagnostic.ReadRequired<int>("window-handle",
                            () => { reads++; return value; }, () => { if (++checks == failureAt) throw deadline; }, value ?? new object(), route.Context));
                        Check(ReferenceEquals(error, deadline) && reads == failureAt - 1 && checks == failureAt &&
                            diagnostic.Primary is { Classification: "guard-refused", Code: "ResourceExceeded", Site: "window-handle" } &&
                            diagnostic.Primary.ReadContext == route.Context);
                    }
        });
        Pass(() =>
        {
            foreach (var route in routes)
                foreach (Exception failure in new Exception[]
                {
                    new System.Windows.Automation.ElementNotAvailableException(),
                    new System.Windows.Automation.ElementNotEnabledException(),
                    new TimeoutException("not retained"), new SecretException(),
                })
                {
                    var diagnostic = New(); int reads = 0, checks = 0;
                    var error = Caught(() => diagnostic.ReadRequired<int>("window-handle",
                        () => { reads++; throw failure; }, () => checks++, new object(), route.Context));
                    string expected = failure is TimeoutException ? "timeout" : failure is SecretException ? "unexpected" : "sdk-fault";
                    Check(ReferenceEquals(error, failure) && reads == 1 && checks == 1 &&
                        diagnostic.Primary?.Classification == expected && diagnostic.Primary.ReadContext == route.Context);
                    string bytes = Encoding.UTF8.GetString(FailureDiagnostics.EncodeCtx1(pins, diagnostic.Primary!, null, time));
                    Check(!bytes.Contains("not retained", StringComparison.Ordinal) && !bytes.Contains("Secret", StringComparison.Ordinal));
                }
        });
        Pass(() =>
        {
            foreach (var route in routes)
            {
                var diagnostic = New(); var sentinel = new object(); int after = 0;
                _ = Caught(() => diagnostic.At("setup-admission", () =>
                {
                    diagnostic.ReadRequired<int>("window-handle", () => sentinel, () => { }, sentinel, route.Context);
                    after++;
                }));
                var primary = diagnostic.Primary;
                _ = Caught(() => diagnostic.At("sdk-mutation", () => after++));
                _ = Caught(() => diagnostic.SetCase("initial"));
                _ = Caught(() => diagnostic.SetStage("capture"));
                diagnostic.Latch(new SecretException());
                diagnostic.ObserveAdmissionRefusal(AdmissionCheck.WorkerDesktop, AdmissionGuard.DesktopNameOrNull);
                diagnostic.Cleanup(() => throw new TimeoutException("not retained"));
                Check(after == 0 && ReferenceEquals(primary, diagnostic.Primary) && primary?.ReadContext == route.Context &&
                    diagnostic.CleanupCode == "Timeout" && !diagnostic.TryPublish());
                string bytes = Encoding.UTF8.GetString(FailureDiagnostics.EncodeCtx1(pins, primary!, diagnostic.CleanupCode, time));
                Check(!bytes.Contains("not retained", StringComparison.Ordinal));
            }
        });
        Pass(() =>
        {
            foreach (var route in routes)
                foreach (string nextSite in new[] { "process-id", "runtime-id", "selection-container", "pattern-required", "setup-admission" })
                {
                    var diagnostic = New();
                    Check(diagnostic.ReadRequired<int>("window-handle", () => 123, () => { }, new object(), route.Context) == 123);
                    _ = Caught(() => diagnostic.At(nextSite, () => throw new SecretException()));
                    Check(diagnostic.Primary?.Site == nextSite && diagnostic.Primary.ReadContext == null);
                }
            foreach (var route in routes)
            {
                var diagnostic = New();
                Check(diagnostic.ReadRequired<int>("window-handle", () => 123, () => { }, new object(), route.Context) == 123);
                Check(!diagnostic.Cleanup(() => throw new SecretException()) && diagnostic.Primary is { Site: "owned-stop", ReadContext: null });
            }
        });
        Pass(() =>
        {
            foreach (WindowHandleReadContext? context in new WindowHandleReadContext?[] { null, 0, (WindowHandleReadContext)(-1), (WindowHandleReadContext)int.MaxValue })
            {
                var diagnostic = New(); int reads = 0, checks = 0;
                Invalid(() => diagnostic.ReadRequired<int>("window-handle", () => { reads++; return 123; }, () => checks++, new object(), context));
                Check(reads == 0 && checks == 0 && diagnostic.Primary == null);
            }
            foreach (var route in routes)
            {
                var diagnostic = New(); int reads = 0, checks = 0;
                Invalid(() => diagnostic.ReadRequired<int>("process-id", () => { reads++; return 123; }, () => checks++, new object(), route.Context));
                Check(reads == 0 && checks == 0 && diagnostic.Primary == null);
            }
        });
        Pass(() =>
        {
            foreach (var route in routes)
                foreach (string caseId in FixedCaptureSuite.CaseIds)
                {
                    bool container = route.Label.StartsWith("container-", StringComparison.Ordinal) || route.Label.StartsWith("selection-container-", StringComparison.Ordinal);
                    bool crossRoot = route.Label.StartsWith("walk-cross-root-", StringComparison.Ordinal);
                    bool allowed = (!container || new[] { "selection", "tab", "combo" }.Contains(caseId)) &&
                        (!crossRoot || new[] { "combo", "modal-cancel", "modal-confirm" }.Contains(caseId));
                    var tuple = new FailureTuple(caseId, "setup", "window-handle", "not-supported", "InvalidObservation", ReadContext: route.Context);
                    if (allowed)
                    {
                        var encoded = FailureDiagnostics.EncodeCtx1(pins, tuple, null, time);
                        Check(FailureDiagnostics.ParseCtx1(encoded, pins).GetProperty("readContext").GetString() == route.Label);
                    }
                    else Invalid(() => FailureDiagnostics.EncodeCtx1(pins, tuple, null, time));
                }
        });
        Pass(() =>
        {
            foreach (var route in routes)
            {
                var tuple = new FailureTuple("combo", "setup", "window-handle", "not-supported", "InvalidObservation", ReadContext: route.Context);
                foreach (string stage in FailureDiagnostics.Stages.Where(value => value != "setup"))
                    Invalid(() => FailureDiagnostics.EncodeCtx1(pins, tuple with { Stage = stage }, null, time));
                foreach (string site in FailureDiagnostics.PropertySites.Where(value => value != "window-handle"))
                    Invalid(() => FailureDiagnostics.EncodeCtx1(pins, tuple with { Site = site }, null, time));
                Invalid(() => FailureDiagnostics.EncodeCtx1(pins, tuple with { Site = null }, null, time));
                Invalid(() => FailureDiagnostics.EncodeCtx1(pins, tuple with { Case = "bootstrap" }, null, time));
                Invalid(() => FailureDiagnostics.EncodeCtx1(pins, tuple with { ReadContext = null }, null, time));
                Invalid(() => FailureDiagnostics.EncodeCtx1(pins, tuple with { AdmissionCheck = "worker-desktop", AdmissionGuard = "desktop-name-or-null" }, null, time));
                Invalid(() => FailureDiagnostics.Encode(pins, tuple, null, time));
                Invalid(() => FailureDiagnostics.EncodeD2(pins, tuple, null, time));
                byte[] bytes = FailureDiagnostics.EncodeCtx1(pins, tuple, null, time);
                Invalid(() => FailureDiagnostics.Parse(bytes, pins));
                Invalid(() => FailureDiagnostics.ParseD2(bytes, pins));
            }
        });
        Pass(() =>
        {
            foreach (var route in routes)
            {
                var diagnostic = New();
                _ = Caught(() => diagnostic.At("setup-admission", () =>
                {
                    int observed = diagnostic.ReadRequired<int>("window-handle", () => 0, () => { }, new object(), route.Context);
                    TrustedSetup.RequireRootProof(123, observed, "ControlType.Window", true);
                }));
                Check(diagnostic.Primary is { Site: "setup-admission", Classification: "guard-refused", Code: "InvalidObservation", ReadContext: null });
            }
        });
        Pass(() =>
        {
            int knownPairs = 0;
            foreach (var check in Enum.GetValues<AdmissionCheck>())
                foreach (var guard in Enum.GetValues<AdmissionGuard>())
                {
                    if (!ConstructorAdmissionTrace.TryLabels(check, guard, out var checkLabel, out var guardLabel)) continue;
                    knownPairs++;
                    foreach (string caseId in new[] { "bootstrap", "process-restart", "window-replacement" })
                    {
                        var tuple = new FailureTuple(caseId, caseId == "window-replacement" ? "setup" : "startup",
                            "setup-admission", "guard-refused", "Unavailable", checkLabel, guardLabel);
                        byte[] encoded = FailureDiagnostics.EncodeCtx1(pins, tuple, null, time);
                        Check(FailureDiagnostics.ParseCtx1(encoded, pins).GetProperty("readContext").ValueKind == JsonValueKind.Null);
                    }
                }
            Check(knownPairs == 40);
        });
        Pass(() =>
        {
            var tuple = new FailureTuple("initial", "setup", "is-password", "not-supported", "InvalidObservation");
            byte[] old = FailureDiagnostics.Encode(pins, tuple, null, time);
            byte[] old2 = FailureDiagnostics.EncodeD2(pins, tuple, null, time);
            Invalid(() => FailureDiagnostics.ParseCtx1(old, pins));
            Invalid(() => FailureDiagnostics.ParseCtx1(old2, pins));
            _ = FailureDiagnostics.ParseCtx1(FailureDiagnostics.EncodeCtx1(pins, tuple, null, time), pins);
        });
        Pass(() =>
        {
            // Both languages consume the exact same decoded original bytes; this
            // reads literal data only and never executes/imports the TypeScript.
            byte[] file = OwnedFiles.Read(System.IO.Path.Combine(SuiteFreeze.Repository(),
                "test/p4.3-native-suite-ctx1-failure-diagnostics.test.ts"), 131072);
            string text = new UTF8Encoding(false, true).GetString(file).Replace("\r\n", "\n");
            const string begin = "// CTX1_CORPUS_BEGIN\n", end = "// CTX1_CORPUS_END";
            int first = text.IndexOf(begin, StringComparison.Ordinal), last = text.IndexOf(end, StringComparison.Ordinal);
            Check(first >= 0 && last > first && text.IndexOf(begin, first + begin.Length, StringComparison.Ordinal) < 0 &&
                text.IndexOf(end, last + end.Length, StringComparison.Ordinal) < 0);
            string raw = text[(first + begin.Length)..last].Trim();
            using var data = JsonDocument.Parse(raw, new JsonDocumentOptions { MaxDepth = 3 });
            Check(data.RootElement.ValueKind == JsonValueKind.Array && data.RootElement.GetArrayLength() == 72);
            var names = new HashSet<string>(StringComparer.Ordinal); int accepted = 0, refused = 0;
            foreach (var row in data.RootElement.EnumerateArray())
            {
                Check(row.ValueKind == JsonValueKind.Object && row.EnumerateObject().Count() == 3 &&
                    row.TryGetProperty("name", out _) && row.TryGetProperty("accept", out _) && row.TryGetProperty("base64", out _));
                string name = row.GetProperty("name").GetString()!, encoded = row.GetProperty("base64").GetString()!;
                Check(name.Length is > 0 and <= 128 && names.Add(name) && encoded.Length <= 5464);
                Check(row.GetProperty("accept").ValueKind is JsonValueKind.True or JsonValueKind.False);
                bool expected = row.GetProperty("accept").GetBoolean();
                byte[] bytes = Convert.FromBase64String(encoded);
                Check(bytes.Length <= 4097 && Convert.ToBase64String(bytes) == encoded);
                if (expected) { _ = FailureDiagnostics.ParseCtx1(bytes, pins); accepted++; }
                else { Invalid(() => FailureDiagnostics.ParseCtx1(bytes, pins)); refused++; }
            }
            Check(accepted == 32 && refused == 40);
        });
        return groups;
        void Pass(Action operation) { operation(); groups++; }
        FailureDiagnostics New() { var value = new FailureDiagnostics(); value.SetCase("combo"); return value; }
    }
    private static Exception? Caught(Action operation)
    {
        try { operation(); return null; } catch (Exception error) { return error; }
    }
    private static void Invalid(Action operation)
    {
        Check(Caught(operation) is CaptureException error && error.Code == CaptureCode.InvalidObservation);
    }
    private sealed class HostileEqualityObject
    {
        public override bool Equals(object? value) => throw new InvalidOperationException("must_not_compare_provider_value");
        public override int GetHashCode() => throw new InvalidOperationException("must_not_hash_provider_value");
        public override string ToString() => throw new InvalidOperationException("must_not_stringify_provider_value");
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
