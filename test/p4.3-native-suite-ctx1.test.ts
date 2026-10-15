import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  NATIVE_SUITE_CTX1_PATHS, CTX1_BUILD_PATHS, CTX1_EXECUTION_PATHS,
  BASELINE_R1_SOURCE_DIGEST, nativeSuiteCtx1Binding, admitNativeSuiteCtx1Freeze,
  admitSuiteReviewMetadata, admitSuiteDecisionMetadata, admitCtx1BuildProvenance,
  parseCtx1BuildProvenance, admitCtx1FreezeShape, requireNoCtx1DevConfigurations,
} from "../scripts/p4.3-native-suite-ctx1-source.mjs";
import { NATIVE_SUITE_PATHS, nativeSuiteBinding } from "../scripts/p4.3-native-suite-source.mjs";
import { identityExperimentLeaks } from "../scripts/check-p4.3-identity-package.mjs";
import { WINDOW_HANDLE_READ_CONTEXTS } from "../scripts/p4.3-native-suite-ctx1-failure-diagnostics.mjs";

// Synthetic authority/parser inputs never stand in for an actual role review,
// qualified DLL, original native evidence, Desktop attestation or operator go.
const trusted = { sourceDigest: "sha256:" + "1".repeat(64), collectorBinaryDigest: "sha256:" + "2".repeat(64),
  fixtureBinaryDigest: "sha256:" + "3".repeat(64) };
const encode = (value: any) => new TextEncoder().encode(JSON.stringify(value));

describe("CTX1 frozen artifact qualification grammar (synthetic; no native execution)", () => {
  const sha = "sha256:" + "a".repeat(64), binary = "sha256:" + "b".repeat(64), commit = "1".repeat(40);
  const paths = ["security", "accessibility", "package"].map(role => `docs/reviews/p4.3-native-suite-ctx1-${role}-agent-review.md`);
  const closure = CTX1_EXECUTION_PATHS.map(path => ({ path, digest: sha }));
  const files = CTX1_BUILD_PATHS.map(path => ({ path, digest: sha }));
  const pins = { sourceDigest: sha, collectorBinaryDigest: binary };
  const provenance = () => ({ schemaVersion: "0.1", kind: "p4.3-native-suite-ctx1-build-provenance",
    sourceCommit: commit, sourceDigest: sha,
    buildInputs: { sdkVersion: "10.0.401", sdkArchiveDigest: "24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430",
      project: "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/CaptureSuiteCtx1.csproj", configuration: "Release",
      arguments: ["build", "CaptureSuiteCtx1/CaptureSuiteCtx1.csproj", "-c", "Release", "-t:Rebuild", "--nologo"], files: structuredClone(files) },
    builds: ["first", "repeat"].map(lane => ({ lane, collectorBinaryDigest: binary,
      informationalRevision: commit, sourceLinkRevision: commit, executionFiles: structuredClone(closure) })) });
  const freeze = () => ({ schemaVersion: "0.1", kind: "p4.3-native-capture-suite-ctx1-freeze", status: "source-approved",
    ...pins, fixtureBinaryDigest: "sha256:05491f5a44d01e9a25f5098d86a4919abb9bb8d6f4d44a4050dcf2560107161d",
    reviewReports: paths.map(path => ({ path, blob: commit })),
    decision: { path: "docs/reviews/p4.3-native-suite-ctx1-execution-entry-2026-10-15.md", blob: commit },
    executionFiles: structuredClone(closure),
    buildProvenance: { path: "docs/evidence/p4.3-native-suite-ctx1-build-provenance.json", blob: commit } });
  it("retains exact Suite20/build15/closure4 lists", () => {
    expect(NATIVE_SUITE_CTX1_PATHS).toHaveLength(20); expect(CTX1_BUILD_PATHS).toHaveLength(15);
    expect(CTX1_EXECUTION_PATHS).toHaveLength(4);
    expect(new Set(CTX1_BUILD_PATHS).size).toBe(15);
    expect(NATIVE_SUITE_CTX1_PATHS).toContain("experiments/windows-uia/managed-reference/global.json");
    expect(() => admitCtx1FreezeShape(freeze())).not.toThrow();
    expect(() => admitCtx1BuildProvenance(encode(provenance()), pins, closure, files)).not.toThrow();
  });
  const mutations: [string, (v: any) => void][] = [
    ["unknown root", v => { v.extra = 1; }], ["missing root", v => { delete v.sourceCommit; }],
    ["different source", v => { v.sourceDigest = binary; }], ["newline commit", v => { v.sourceCommit += "\n"; }],
    ["wrong SDK", v => { v.buildInputs.sdkVersion = "10.0.402"; }],
    ["wrong archive", v => { v.buildInputs.sdkArchiveDigest = "a".repeat(128); }],
    ["unknown input key", v => { v.buildInputs.extra = 1; }],
    ["wrong project", v => { v.buildInputs.project = "../CaptureSuite.csproj"; }],
    ["wrong configuration", v => { v.buildInputs.configuration = "Debug"; }],
    ["incremental build", v => { v.buildInputs.arguments[4] = "-t:Build"; }],
    ["extra build argument", v => { v.buildInputs.arguments.push("-p:SourceRevisionId=x"); }],
    ["missing source input", v => { v.buildInputs.files.pop(); }],
    ["duplicate source input", v => { v.buildInputs.files[1] = v.buildInputs.files[0]; }],
    ["input order", v => { v.buildInputs.files.reverse(); }],
    ["input digest", v => { v.buildInputs.files[0].digest = binary; }],
    ["input alias", v => { v.buildInputs.files[0].path = "alias.cs"; }],
    ["input extra field", v => { v.buildInputs.files[0].extra = 1; }],
    ["missing repeat", v => { v.builds.pop(); }], ["extra build", v => { v.builds.push(v.builds[0]); }],
    ["build order", v => { v.builds.reverse(); }], ["duplicate lane", v => { v.builds[1].lane = "first"; }],
    ["missing lane key", v => { delete v.builds[0].sourceLinkRevision; }],
    ["unknown lane key", v => { v.builds[1].extra = 1; }],
    ["wrong binary", v => { v.builds[1].collectorBinaryDigest = sha; }],
    ["wrong informational revision", v => { v.builds[1].informationalRevision = "2".repeat(40); }],
    ["wrong SourceLink revision", v => { v.builds[0].sourceLinkRevision = "2".repeat(40); }],
    ["missing companion", v => { v.builds[1].executionFiles.pop(); }],
    ["extra companion", v => { v.builds[0].executionFiles.push(v.builds[0].executionFiles[0]); }],
    ["companion order", v => { v.builds[0].executionFiles.reverse(); }],
    ["companion digest", v => { v.builds[1].executionFiles[0].digest = binary; }],
    ["dev companion substitution", v => { v.builds[0].executionFiles[0].path = "runtimeconfig.dev.json"; }],
    ["coerced digest", v => { v.builds[0].executionFiles[0].digest = [sha]; }],
  ];
  it.each(mutations)("refuses provenance %s", (_name, mutate) => {
    const v = provenance(); mutate(v);
    expect(() => admitCtx1BuildProvenance(encode(v), pins, closure, files)).toThrow();
  });
  const freezeMutations: [string, (v: any) => void][] = [
    ["legacy eight keys", v => { delete v.executionFiles; delete v.buildProvenance; }],
    ["unknown key", v => { v.extra = 1; }], ["fixture change", v => { v.fixtureBinaryDigest = sha; }],
    ["report order", v => { v.reviewReports.reverse(); }],
    ["old report", v => { v.reviewReports[0].path = "docs/reviews/p4.3-native-suite-r1-security-agent-review.md"; }],
    ["old decision", v => { v.decision.path = "docs/reviews/p4.3-native-suite-d2-execution-entry-2026-10-04.md"; }],
    ["alternate provenance", v => { v.buildProvenance.path = "other.json"; }],
    ["missing companion", v => { v.executionFiles.pop(); }], ["duplicate companion", v => { v.executionFiles[1] = v.executionFiles[0]; }],
    ["unknown reference field", v => { v.decision.extra = 1; }],
    ["malformed blob", v => { v.buildProvenance.blob += "\n"; }],
  ];
  it.each(freezeMutations)("refuses frozen profile %s", (_name, mutate) => {
    const v = freeze(); mutate(v); expect(() => admitCtx1FreezeShape(v)).toThrow();
  });
  it.each(["/root/p42_security_review", "/root/p42_accessibility_interop_review", "/root/p42_package_gate_review"])("refuses historical role %s", agent => {
    expect(() => admitSuiteReviewMetadata("# Synthetic\n\n", agent, sha)).toThrow();
  });
  it("refuses original-byte parser boundaries before lossy decoding", () => {
    for (const bytes of [new Uint8Array(32769), new Uint8Array([0xc0, 0xaf]),
      encode("x").slice(0, 0), new TextEncoder().encode('\ufeff{}'),
      new TextEncoder().encode('{"x":1,"\\u0078":2}'), new TextEncoder().encode('{}{}'),
      new TextEncoder().encode('{"x":"\\ud800"}'),
      new TextEncoder().encode('[[[[[[[]]]]]]]'),
      new TextEncoder().encode('[' + Array(2047).fill(0).join(',') + ']'),
      encode({ x: "a".repeat(513) }), encode({ x: "ก".repeat(171) }), new TextEncoder().encode("1" + "0".repeat(512))])
      expect(() => parseCtx1BuildProvenance(bytes)).toThrow();
    expect(() => parseCtx1BuildProvenance(encode({ x: "ก".repeat(170) }))).not.toThrow();
    expect(() => parseCtx1BuildProvenance(new TextEncoder().encode('[[[[[[]]]]]]'))).not.toThrow();
    expect(() => parseCtx1BuildProvenance(new TextEncoder().encode("1" + "0".repeat(511)))).not.toThrow();
  });
  it("keeps Native admission before SDK and workers, with only pure Rebuild", async () => {
    const launcher = (await readFile(resolve("scripts/run-p4.3-capture-suite-ctx1.ps1"), "utf8")).replaceAll("\r\n", "\n");
    const initial = launcher.indexOf("if ($Native) { Confirm-FrozenArtifact }");
    expect(initial).toBeGreaterThan(0); expect(initial).toBeLessThan(launcher.indexOf("$taskSdk ="));
    expect(launcher).toContain("if (-not $Native) {\n        Confirm-BaselineArtifact\n        try {\n            & $taskSdkExe build CaptureSuiteCtx1/CaptureSuiteCtx1.csproj -c Release -t:Rebuild --nologo");
    expect(launcher.match(/& \$taskSdkExe build/g)).toHaveLength(1);
    expect(launcher).toContain("if ($Mode -eq 'legacy-unit') {");
    expect(launcher.indexOf("if ($Native) { Confirm-FrozenArtifact }", launcher.indexOf("function Invoke-CaptureWorker"))).toBeLessThan(launcher.indexOf("$taskWorker = [Diagnostics.Process]::Start"));
    expect(launcher).toContain("Confirm-NoDevConfiguration\n        $taskStart =");
    const project = await readFile(resolve("experiments/windows-uia/managed-reference/CaptureSuiteCtx1/CaptureSuiteCtx1.csproj"), "utf8");
    expect(project).toContain("<EnableDefaultCompileItems>false</EnableDefaultCompileItems>");
    for (const item of ["Items", "ApplicationDefinition", "PageItems", "EmbeddedResourceItems"])
      expect(project).toContain(`<EnableDefault${item}>false</EnableDefault${item}>`);
    expect(project.match(/<Compile Include=/g)).toHaveLength(13); expect(project).not.toContain("*");
    const program = (await readFile(resolve("experiments/windows-uia/managed-reference/CaptureSuite/Program.cs"), "utf8")).replaceAll("\r\n", "\n");
    expect(program).toContain('owned = diagnostics.At("fixture-start", () => SuiteFreeze.BeforeFixtureStart(pins, () => SuiteFreeze.Admit(repo),\n                () => SetupBudget.CheckTime(), () => Process.Start(start)');
    expect(program.match(/Process\.Start\(start\)/g)).toHaveLength(1);
  });
  it.each([0, 1])("refuses fixed dev config %s, including a directory (pure filesystem negative)", async i => {
    const temporary = await mkdtemp(join(tmpdir(), "dsui-r1-dev-config-"));
    const path = join(temporary, CTX1_EXECUTION_PATHS[i * 2 + 1].replace(/\.runtimeconfig\.json$/, ".runtimeconfig.dev.json"));
    try {
      await expect(requireNoCtx1DevConfigurations(temporary)).resolves.toBeUndefined();
      await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, "{}");
      await expect(requireNoCtx1DevConfigurations(temporary)).rejects.toThrow();
      await rm(path); await mkdir(path);
      await expect(requireNoCtx1DevConfigurations(temporary)).rejects.toThrow();
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});

describe("CTX1 production context edges and unchanged observation inventory (source only)", () => {
  const candidate = "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/";
  const original = "experiments/windows-uia/managed-reference/CaptureSuite/";
  const get = (path: string) => readFile(path, "utf8");
  // These fixed source methods contain no comment-like string literals or
  // brace-bearing strings. Strip comments before comparing executable edges.
  const code = (value: string) => value.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");
  const block = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    if (start < 0 || source.indexOf(signature, start + signature.length) >= 0) throw Error("unique_source_method_required");
    const open = source.indexOf("{", start); let depth = 0;
    for (let at = open; at < source.length; at++) {
      if (source[at] === "{") depth++;
      else if (source[at] === "}" && --depth === 0) return source.slice(open, at + 1);
    }
    throw Error("source_method_body_required");
  };
  const edges = [
    "Guard(peer, frame, budget, WindowHandleReadContext.RootGuard);",
    "RequireRootProof(window!.Handle.ToInt64(), ReadWindowHandle(peer, WindowHandleReadContext.RootProof), type, semanticWindow);",
    'roots.Add(new(peer, Identity(peer, frame, budget, WindowHandleReadContext.RootIdentity), window == frame.Main ? "main" : "auxiliary", window, type, semanticWindow));',
    "Guard(peer, frame, budget, WindowHandleReadContext.WalkNodeGuard);",
    "string identity = Identity(peer, frame, budget, WindowHandleReadContext.WalkNodeIdentity);",
    "Guard(child, frame, budget, WindowHandleReadContext.WalkChildGuard);",
    "string childIdentity = Identity(child, frame, budget, WindowHandleReadContext.WalkChildIdentity);",
    "Same(r.Peer, child, frame, budget, WindowHandleReadContext.WalkCrossRootLeft, WindowHandleReadContext.WalkCrossRootRight)",
    'Same(diagnostics.At("tree-parent", () => walker.GetParent(child)), peer, frame, budget, WindowHandleReadContext.WalkParentLeft, WindowHandleReadContext.WalkParentRight)',
    "Guard(live, frame, budget, WindowHandleReadContext.FenceRootGuard);",
    "RequireRootProof(root.Window.Handle.ToInt64(), ReadWindowHandle(live, WindowHandleReadContext.FenceRootProof),",
    "Same(live, root.Peer, frame, budget, WindowHandleReadContext.FenceRootLeft, WindowHandleReadContext.FenceRootRight)",
    "SetupEntryRole.Target => (WindowHandleReadContext.TargetGuard, WindowHandleReadContext.TargetIdentity)",
    "SetupEntryRole.Container => (WindowHandleReadContext.ContainerGuard, WindowHandleReadContext.ContainerIdentity)",
    "SetupEntryRole.Target => (WindowHandleReadContext.TargetChainLeft, WindowHandleReadContext.TargetChainRight, WindowHandleReadContext.TargetChainParent)",
    "SetupEntryRole.Container => (WindowHandleReadContext.ContainerChainLeft, WindowHandleReadContext.ContainerChainRight, WindowHandleReadContext.ContainerChainParent)",
    "Guard(selectedContainer, frame, budget, WindowHandleReadContext.SelectionContainerGuard);",
    "Same(selectedContainer, container.Peer, frame, budget, WindowHandleReadContext.SelectionContainerLeft, WindowHandleReadContext.SelectionContainerRight)",
  ];
  const assertEdges = (source: string) => {
    const executable = code(source);
    for (const edge of edges) expect(executable).toContain(code(edge));
    const members = WINDOW_HANDLE_READ_CONTEXTS.map((label: string) =>
      label.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(""));
    const actual = [...executable.matchAll(/WindowHandleReadContext\.([A-Za-z]+)/g)].map(match => match[1]);
    expect(actual.sort()).toEqual([...members].sort()); // each fixed label appears once
  };
  const nativeInventory = (source: string) => code(source).match(/(?:AutomationElement\.FromHandle|TreeWalker\.ControlViewWalker|walker\.(?:GetFirstChild|GetNextSibling|GetParent)|\.GetCurrentPropertyValue|\.GetRuntimeId|\.TryGetCurrentPattern|pattern\.(?:Invoke|Toggle|SetValue|Select|Expand|Collapse)|admission\.(?:Observe|RequirePeerBoundary)|OwnedWindowTopology\.RequireSame|budget\.(?:CheckTime|AccountInstance))\b/g) ?? [];
  const propertyInventory = (source: string) => code(source).match(/\bRead<[^>]+>\([^,()]+,(?:AutomationElement|[A-Za-z]+Pattern)\.[A-Za-z]+Property\)/g) ?? [];

  it("pins all 28 actual caller constants, operands and role-selector outputs", async () => {
    assertEdges(await get(candidate + "TrustedSetup.cs"));
  });
  it("detects swapped source labels and reversed production Same operands", async () => {
    const source = await get(candidate + "TrustedSetup.cs");
    for (const [from, to] of [
      ["WindowHandleReadContext.RootGuard", "WindowHandleReadContext.RootIdentity"],
      ["Same(live, root.Peer,", "Same(root.Peer, live,"],
      ["Same(selectedContainer, container.Peer,", "Same(container.Peer, selectedContainer,"],
    ]) {
      expect(source).toContain(from);
      expect(() => assertEdges(source.replace(from, to))).toThrow();
    }
  });
  it("pins target/container callers and the repeated ancestor identity forwarding", async () => {
    const source = await get(candidate + "TrustedSetup.cs"), executable = code(source);
    for (const edge of [
      "Qualify(target, definition, disabledProbe, SetupEntryRole.Target);",
      "Chain(target, expectedRoot, container == null ? definition.Container : null, container != null, SetupEntryRole.Target);",
      "Qualify(container, containerDefinition, false, SetupEntryRole.Container);",
      'Chain(container, "main", containerDefinition.Container, false, SetupEntryRole.Container);',
      "var context = QualifyContexts(role); Guard(entry.Peer, frame, budget, context.Guard);",
      "Identity(entry.Peer, frame, budget, context.Identity) != entry.Identity",
      "var context = ChainContexts(role);",
      'Same(diagnostics.At("tree-parent", () => walker.GetParent(current.Peer)), parent.Peer, frame, budget, context.Left, context.Right)',
      "Identity(parent.Peer, frame, budget, context.Parent) != parent.Identity",
      "Guard(peer, frame, budget, context); int[] parts = diagnostics.At(\"runtime-id\", peer.GetRuntimeId);",
      "=> SameIdentity(left, right, leftContext, rightContext, (peer, context) => Identity(peer, frame, budget, context));",
      "return left != null && identity(left, leftContext) == identity(right, rightContext);",
    ]) expect(executable).toContain(code(edge));
  });
  it("limits HWND reads to the same three slots and one typed context-only helper", async () => {
    const source = await get(candidate + "TrustedSetup.cs");
    const helper = block(source, "private int ReadWindowHandle(");
    expect(code(helper)).toBe(code(`{
      var budget = activeBudget ?? throw new CaptureException(CaptureCode.Unavailable);
      return diagnostics.ReadRequired<int>("window-handle",
        () => peer.GetCurrentPropertyValue(AutomationElement.NativeWindowHandleProperty, ignoreDefaultValue: true),
        budget.CheckTime, AutomationElement.NotSupported, context);
    }`));
    expect(source.match(/\bReadWindowHandle\((?:peer|live),/g)).toHaveLength(3);
    expect(source.match(/AutomationElement\.NativeWindowHandleProperty/g)).toHaveLength(1);
    expect(block(source, "private T Read<T>(")).not.toMatch(/NativeWindowHandleProperty|window-handle/);
    expect(code(block(source, "private void Guard("))).toBe(code(`{
      budget.CheckTime(); _ = FailureDiagnostics.ContextLabel(context);
      if (Read<int>(peer, AutomationElement.ProcessIdProperty) != admission.ProcessId) Refuse();
      admission.RequirePeerBoundary(ReadWindowHandle(peer, context), frame, budget);
      budget.CheckTime();
    }`));
    const diagnostics = code(await get(candidate + "FailureDiagnostics.cs"));
    expect(diagnostics).toContain(code("requireLive(); object? observed = read(); requireLive(); if (observed is T typed) return typed;"));
    expect(diagnostics.match(/\bread\(\)/g)).toHaveLength(1);
  });
  it("preserves ordered native/tree/pattern/mutation/check and typed property-read inventories", async () => {
    const baseline = await get(original + "TrustedSetup.cs"), source = await get(candidate + "TrustedSetup.cs");
    // The single new lexical getter is an extraction of the three existing
    // HWND read slots, not an additional observation in their runtime paths.
    const extracted = source.replace(block(source, "private int ReadWindowHandle("), "{}");
    expect(nativeInventory(extracted)).toEqual(nativeInventory(baseline));
    const restored = extracted.replace(/ReadWindowHandle\((peer|live),\s*(?:WindowHandleReadContext\.[A-Za-z]+|context)\)/g,
      "Read<int>($1, AutomationElement.NativeWindowHandleProperty)");
    expect(propertyInventory(restored)).toEqual(propertyInventory(baseline));
    const extraGetter = extracted.replace("budget.CheckTime();", "budget.CheckTime(); peer.GetCurrentPropertyValue(AutomationElement.ProcessIdProperty);");
    expect(nativeInventory(extraGetter)).not.toEqual(nativeInventory(baseline));
  });
});
describe("P4.3 source-governance metadata parser (synthetic, not an approval)", () => {
  const agents = ["/root/ctx1_source_security", "/root/ctx1_source_interop", "/root/ctx1_source_package"];
  const source = trusted.sourceDigest, stale = "sha256:" + "9".repeat(64);
  const review = (agent = agents[0]) => "# Synthetic parser review input\n\n" +
    "Reviewer agent: " + agent + "\nDisposition: source-approved\nReviewed source: " + source +
    "\nUnresolved Critical/High/Medium: 0\n\nParser testing only, not actual independent review.\n";
  const decision = () => "# Synthetic parser decision input\n\nNative execution: authorized for the frozen fixed suite only\n" +
    "Reviewed source: " + source + "\n\nParser testing only, not an actual execution authorization.\n";
  it.each(agents)("admits standalone metadata for the exact expected role %s", agent => {
    expect(() => admitSuiteReviewMetadata(review(agent), agent, source)).not.toThrow();
  });
  it("admits the distinct two-field execution entry without granting authority to this synthetic text", () => {
    expect(() => admitSuiteDecisionMetadata(decision(), source)).not.toThrow();
  });
  it("uses the same CRLF-to-LF normalization as source/blob admission", () => {
    expect(() => admitSuiteReviewMetadata(review().replaceAll("\n", "\r\n"), agents[0], source)).not.toThrow();
    expect(() => admitSuiteDecisionMetadata(decision().replaceAll("\n", "\r\n"), source)).not.toThrow();
  });
  const wrappers = ["<div hidden>", "<script>", "<pre>", "<template>", "<div>\n<pre>",
    "<!DOCTYPE hidden>", "<?hidden?>", "<!-- hidden", "<div>" ];
  it.each(wrappers)("rejects review metadata enclosed after heading by %s", opening => {
    const text = review().replace("\n\nReviewer agent:", "\n\n" + opening + "\nReviewer agent:") + "\n</div>\n";
    expect(() => admitSuiteReviewMetadata(text, agents[0], source)).toThrow("native_suite_ctx1_source_refused");
  });
  it.each(wrappers)("rejects decision metadata enclosed after heading by %s", opening => {
    const text = decision().replace("\n\nNative execution:", "\n\n" + opening + "\nNative execution:") + "\n</div>\n";
    expect(() => admitSuiteDecisionMetadata(text, source)).toThrow("native_suite_ctx1_source_refused");
  });
  const reviewNegatives: [string, (text: string) => string][] = [
    ["quoted all-fields block", text => text.split("\n").map(line => "> " + line).join("\n")],
    ["quoted single disposition", text => text.replace("Disposition: source-approved", '> Disposition: source-approved')],
    ["inline quoted disposition", text => text.replace("Disposition: source-approved", '"Disposition: source-approved"')],
    ["inline code disposition", text => text.replace("Disposition: source-approved", '`Disposition: source-approved`')],
    ["indented required field", text => text.replace("Disposition: source-approved", '    Disposition: source-approved')],
    ["backtick fenced required metadata", text => "```md\n" + text + "```\n"],
    ["tilde fenced required metadata", text => "~~~~markdown\n" + text + "~~~~\n"],
    ["longer backtick fence with shorter inner ticks", text => "````md\n```\n" + text + "````\n"],
    ["Unicode-containing fence info string", text => "```\u2028markdown\n" + text + "```\n"],
    ["unclosed fence after metadata", text => text + "```md\nunfinished history\n"],
    ["duplicate acceptable disposition", text => text + "\nDisposition: source-approved\n"],
    ["contradictory disposition", text => text + "\nDisposition: refused\n"],
    ["quoted historical acceptable disposition", text => text + '\n> History "Disposition: source-approved"\n'],
    ["fenced historical source marker", text => text + "\n~~~\nReviewed source: " + stale + "\n~~~\n"],
    ["inline historical-only disposition", text => text.replace("Disposition: source-approved", "Historical marker reference Disposition: source-approved")],
    ["stale reviewed source", text => text.replace(source, stale)],
    ["wrong expected reviewer role", text => text.replace(agents[0], agents[1])],
    ["unresolved Medium", text => text.replace("Unresolved Critical/High/Medium: 0", "Unresolved Critical/High/Medium: 1")],
    ["missing required field", text => text.replace("Unresolved Critical/High/Medium: 0\n", "")],
    ["unexpected reserved execution label", text => text + "\nNative execution: not authorized\n"],
    ["hidden HTML-comment metadata", text => "<!--\n" + text + "-->\n"],
    ["lazy blockquote continuation", text => text.replace("Reviewed source: " + source, "> Historical note\nReviewed source: " + source)],
    ["unclosed HTML comment", text => text + "\n<!-- unfinished\n"],
    ["BOM prefix", text => "\ufeff" + text],
    ["bare CR line breaks", text => text.replaceAll("\n", "\r")],
    ["malformed UTF16", text => text + "\ud800"],
    ["embedded NUL", text => text + "\0"],
    ["one-MiB byte overflow", text => text + "ก".repeat(350000)],
  ];
  it.each(reviewNegatives)("rejects %s without relying on a matching substring", (_name, mutate) => {
    expect(() => admitSuiteReviewMetadata(mutate(review()), agents[0], source)).toThrow("native_suite_ctx1_source_refused");
  });
  const decisionNegatives: [string, (text: string) => string][] = [
    ["quoted decision marker", text => text.replace("Native execution:", "> Native execution:")],
    ["fenced decision marker", text => "~~~\n" + text + "~~~\n"],
    ["duplicate decision marker", text => text + "\nNative execution: authorized for the frozen fixed suite only\n"],
    ["contradictory execution decision", text => text + "\nNative execution: not authorized\n"],
    ["historical-only execution marker", text => text.replace("Native execution:", "History quotation Native execution:")],
    ["stale execution source", text => text.replace(source, stale)],
    ["unexpected reviewer metadata", text => text + "\nReviewer agent: " + agents[0] + "\n"],
    ["unexpected disposition metadata", text => text + "\nDisposition: source-approved\n"],
    ["missing source field", text => text.replace("Reviewed source: " + source + "\n", "")],
    ["broader authorization text", text => text.replace("authorized for the frozen fixed suite only", "authorized for any application")],
  ];
  it.each(decisionNegatives)("rejects %s in the distinct execution entry", (_name, mutate) => {
    expect(() => admitSuiteDecisionMetadata(mutate(decision()), source)).toThrow("native_suite_ctx1_source_refused");
  });
  it("rejects nonallowlisted expected roles and malformed independently supplied source pins", () => {
    expect(() => admitSuiteReviewMetadata(review(), "/root", source)).toThrow();
    expect(() => admitSuiteReviewMetadata(review(), agents[0], source + "\n")).toThrow();
    expect(() => admitSuiteDecisionMetadata(decision(), source.toUpperCase())).toThrow();
  });
});


describe("CTX1 physical isolation, fixed closure and R1 preservation", () => {
  const directory = "experiments/windows-uia/managed-reference/CaptureSuiteCtx1";
  const get = async (path: string) => (await readFile(resolve(path), "utf8")).replaceAll("\r\n", "\n");
  const hash = (value: string) => "sha256:" + createHash("sha256").update(value).digest("hex");
  const strings = (source: string, name: string) => {
    const match = new RegExp("string\\[\\] " + name + " = \\[([\\s\\S]*?)\\];").exec(source);
    expect(match, name).not.toBeNull();
    return [...match![1].matchAll(/"([^"]+)"/g)].map(value => value[1]).sort();
  };
  it("uses byte-identical candidate Source20 literals in C# and Node", async () => {
    const source = await get(directory + "/SuiteFreeze.cs");
    expect(strings(source, "SourcePaths")).toEqual(NATIVE_SUITE_CTX1_PATHS);
    expect(strings(source, "BaselineSourcePaths")).toEqual(NATIVE_SUITE_PATHS);
    expect(source).toContain("new { files, baselineR1 }");
    expect(source).toContain('if (baseline != BaselineR1Digest) Refuse();');
    expect(NATIVE_SUITE_CTX1_PATHS).toHaveLength(20);
    expect(NATIVE_SUITE_CTX1_PATHS.filter((path: string) => path.startsWith("docs/reviews/"))).toEqual([]);
    expect(NATIVE_SUITE_CTX1_PATHS.some((path: string) => /freeze|provenance/.test(path))).toBe(false);
  });
  it("binds candidate source to the unchanged independently reconstructed original source", async () => {
    const original = await nativeSuiteBinding(process.cwd());
    expect(original.digest).toBe(BASELINE_R1_SOURCE_DIGEST);
    const candidate = await nativeSuiteCtx1Binding(process.cwd());
    expect(candidate.baselineR1).toBe(original.digest);
    expect(candidate.digest).toBe(hash(JSON.stringify({ files: candidate.files, baselineR1: original.digest })));
    expect(candidate.files.map((item: any) => item.path)).toEqual(NATIVE_SUITE_CTX1_PATHS);
  }, 30_000);
  it("builds only the explicit 13 linked/local C# inputs plus project and unchanged global.json", async () => {
    const project = await get(directory + "/CaptureSuiteCtx1.csproj");
    expect(project).toContain("<AssemblyName>DualSurface.UiaCaptureSuite.Ctx1</AssemblyName>");
    expect(project).not.toMatch(/ProjectReference|PackageReference|BeforeTargets|AfterTargets|<Import|<Exec|\*/);
    const compiled = [...project.matchAll(/<Compile Include="([^"]+)"/g)].map(match =>
      relative(process.cwd(), resolve(directory, match[1])).replaceAll("\\", "/")).sort();
    expect(compiled).toHaveLength(13);
    expect([...compiled, directory + "/CaptureSuiteCtx1.csproj",
      "experiments/windows-uia/managed-reference/global.json"].sort()).toEqual(CTX1_BUILD_PATHS);
    expect(compiled.filter(path => path.startsWith(directory + "/"))).toHaveLength(4);
    expect(compiled).toContain("experiments/windows-uia/managed-reference/CaptureSuite/Program.cs");
    expect(compiled).not.toContain("experiments/windows-uia/managed-reference/CaptureSuite/SuiteFreeze.cs");
    const sdk = JSON.parse(await get("experiments/windows-uia/managed-reference/global.json"));
    expect(sdk).toEqual({ sdk: { version: "10.0.401", rollForward: "disable", allowPrerelease: false } });
  });
  it("keeps exactly candidate/fixture execution companions, never the old output as candidate", () => {
    expect(CTX1_EXECUTION_PATHS).toHaveLength(4);
    expect(CTX1_EXECUTION_PATHS.slice(0, 2).every((path: string) =>
      path.startsWith(directory + "/bin/Release/net10.0-windows/DualSurface.UiaCaptureSuite.Ctx1."))).toBe(true);
    expect(CTX1_EXECUTION_PATHS.some((path: string) => path.includes("/CaptureSuite/bin/"))).toBe(false);
  });
  it("requires baseline preservation before candidate authority and separately checks the whole frozen record", async () => {
    const node = await get("scripts/p4.3-native-suite-ctx1-source.mjs");
    const worker = await get(directory + "/SuiteFreeze.cs");
    expect(node).toContain("await admitBaselineR1Packet(root);");
    const admission = node.indexOf("export async function admitNativeSuiteCtx1Freeze");
    expect(node.indexOf("await admitBaselineR1Packet(root)", admission))
      .toBeLessThan(node.indexOf('fixedRead(root, "docs/evidence/p4.3-native-suite-ctx1-freeze.json"', admission));
    expect(worker).toContain("RequireBaselinePacket(repo);");
    const freeze = await get("docs/evidence/p4.3-native-suite-r1-freeze.json");
    const blob = createHash("sha1").update("blob " + Buffer.byteLength(freeze) + "\0").update(freeze).digest("hex");
    expect(blob).toBe("c165cfcf4ff802eeb7f22d692c51066d0cf31b0f");
    expect(node).toContain(blob); expect(worker).toContain(blob);
  });
  it("missing actual packet fails closed through the production entry without a worker or fixture", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "dsui-ctx1-no-authority-"));
    try { await expect(admitNativeSuiteCtx1Freeze(temporary)).rejects.toThrow(); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  });
  it("preserves before/after baseline admission and fixed legacy pure-only isolation", async () => {
    const launcher = await get("scripts/run-p4.3-capture-suite-ctx1.ps1");
    expect(launcher).toContain("} finally { Confirm-BaselineArtifact }");
    expect(launcher).toContain("Invoke-CaptureWorker @('--unit') 30000 'legacy-unit'");
    expect(launcher).toContain("if(v.cases!==467)");
    expect(launcher).toContain("$Arguments[0] -ne '--unit'");
    expect(launcher).toContain("$Deadline -ne 30000");
    expect(launcher).toContain("try { Confirm-BaselineArtifact } finally { Pop-Location }");
    expect(launcher).not.toMatch(/dotnet run|SourceRevisionId|EnableSourceControlManagerQueries|SourceLinkCreate|--profile|CTX1_PROFILE/);
    expect(launcher.match(/& \$taskSdkExe build/g)).toHaveLength(1);
  });
  it("reuses the strict success/pair verifier only behind fixed candidate admission", async () => {
    const verifier = await get("scripts/verify-p4.3-native-suite-ctx1.mjs");
    expect(verifier).toContain('from "./p4.3-native-suite-contracts.mjs"');
    expect(verifier).toContain('"./p4.3-native-suite-ctx1-source.mjs"');
    expect(verifier.match(/admitNativeSuiteCtx1Freeze\(root\)/g)).toHaveLength(2);
    expect(verifier).not.toContain("admitNativeSuiteFreeze");
    expect(verifier).not.toMatch(/child_process|Process\.Start|\.catch\(/);
  });
  it("has no npm experiment exposure or public export change", async () => {
    const paths = [directory + "/CaptureSuiteCtx1.csproj", ...CTX1_BUILD_PATHS.filter((path: string) => path.startsWith(directory)),
      directory + "/bin/Release/net10.0-windows/DualSurface.UiaCaptureSuite.Ctx1.dll"];
    expect(identityExperimentLeaks(paths)).toEqual(paths);
    const pkg = JSON.parse(await get("package.json"));
    expect(pkg.files).toEqual(["dist", "schemas", "fixtures/native-protocol", "README.md", "LICENSE"]);
    expect(Object.keys(pkg.exports).some(path => /ctx1|uia|CaptureSuite/i.test(path))).toBe(false);
  });
});
