// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentSurface } from "../src/index.js";
import type { AgentSnapshot } from "../src/types.js";
import {
  checkSemanticDrift,
  createSemanticDriftManifest,
  createSemanticDriftIntegrityKey,
  digestSemanticValue,
  importSemanticDriftIntegrityKey,
  type DriftObservedTool,
  type SemanticDriftInput,
} from "../src/drift/index.js";
import { exportAgentSurfaceToWebMcp } from "../src/webmcp/index.js";

const epoch = 1;
const binding = {
  name: "documents.approve",
  description: "Approve the reviewed document",
  elementId: "approval",
  action: "approve",
} as const;

async function fixture(): Promise<{
  button: HTMLButtonElement;
  input: SemanticDriftInput;
  handler: ReturnType<typeof vi.fn>;
  tool: DriftObservedTool;
  snapshot: AgentSnapshot;
  surface: ReturnType<typeof createAgentSurface>;
}> {
  document.body.innerHTML = `<button aria-label="Approve document">Approve</button>`;
  const button = document.querySelector("button")!;
  const handler = vi.fn();
  const surface = createAgentSurface({ surfaceId: "drift-test" });
  surface.register(button, {
    id: "approval",
    actions: {
      approve: {
        description: binding.description,
        risk: "consequential",
        requiresConfirmation: true,
        effects: ["document_approved"],
        handler,
      },
    },
  });
  const snapshot = surface.snapshot();
  const integrityKey = await createSemanticDriftIntegrityKey();
  const manifest = await createSemanticDriftManifest({ snapshot, declaredTools: [binding], integrityKey });
  const tool: DriftObservedTool = {
    descriptor: {
      name: binding.name,
      description: binding.description,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      annotations: {
        readOnlyHint: false,
        consequentialHint: true,
        untrustedContentHint: true,
      },
    },
    elementId: binding.elementId,
    action: binding.action,
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    generation: 1,
  };
  return {
    button,
    handler,
    tool,
    snapshot,
    surface,
    input: {
      root: document.body,
      readSnapshot: () => surface.snapshot(),
      manifest,
      expectedFingerprint: manifest.fingerprint,
      integrityKey,
      controls: [{ element: button, elementId: "approval" }],
      declaredTools: [binding],
      readActiveTools: () => ({
        status: "observed",
        tools: [tool],
      }),
      readPermission: vi.fn(() => "require-confirmation"),
      readApplicationState: vi.fn(() => ({ disabled: false })),
      permissionContext: { principalId: "principal-1", originId: "origin-1", inputCaseId: "default" },
      observationEpoch: epoch,
      readEpoch: vi.fn(() => epoch),
    },
  };
}

describe("semantic drift checker", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("returns a deterministic frozen report without executing an action", async () => {
    const { input, handler } = await fixture();
    const before = document.body.outerHTML;
    const first = await checkSemanticDrift(input);
    const second = await checkSemanticDrift(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ reportVersion: "0.1", status: "consistent", issues: [] });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.coverage)).toBe(true);
    expect(Object.isFrozen(first.issues)).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(input.readEpoch).toHaveBeenCalledTimes(4);
    expect(input.readPermission).toHaveBeenCalledWith({
      elementId: "approval",
      action: "approve",
      principalId: "principal-1",
      originId: "origin-1",
      inputCaseId: "default",
    });
    expect(document.body.outerHTML).toBe(before);
  });

  it("detects every action-semantic field through the manifest", async () => {
    for (const mutate of [
      (action: Record<string, unknown>) => { action.risk = "read"; },
      (action: Record<string, unknown>) => { action.requiresConfirmation = false; },
      (action: Record<string, unknown>) => { action.inputSchema = { type: "string" }; },
      (action: Record<string, unknown>) => { action.outputSchema = { type: "boolean" }; },
      (action: Record<string, unknown>) => { action.effects = ["different_effect"]; },
      (action: Record<string, unknown>) => { action.preconditions = ["different_precondition"]; },
      (action: Record<string, unknown>) => { action.idempotency = "keyed"; },
      (action: Record<string, unknown>) => { action.description = "Changed"; },
    ]) {
      const { input, snapshot } = await fixture();
      input.readSnapshot = () => snapshot;
      mutate(snapshot.nodes[0]!.actions[0]! as unknown as Record<string, unknown>);
      const report = await checkSemanticDrift(input);
      expect(report.status).toBe("drifted");
      expect(report.issues.some((item) => item.code === "snapshot_action_semantics_mismatch")).toBe(true);
    }
  });

  it("reads the current surface snapshot instead of accepting a stale supplied copy", async () => {
    const { input, surface, button } = await fixture();
    surface.register(button, {
      id: "approval",
      actions: {
        approve: {
          description: binding.description,
          risk: "read",
          handler: () => ({ changed: true }),
        },
      },
    });
    const report = await checkSemanticDrift(input);
    expect(report.status).toBe("drifted");
    expect(report.issues.some((item) => item.code === "snapshot_action_semantics_mismatch")).toBe(true);
  });

  it("normalizes set-like JSON Schema ordering without hiding real schema drift", async () => {
    document.body.innerHTML = `<button aria-label="Inspect">Inspect</button>`;
    const button = document.querySelector("button")!;
    const surface = createAgentSurface({ surfaceId: "schema-order" });
    surface.register(button, {
      id: "inspect",
      actions: {
        inspect: {
          description: "Inspect",
          risk: "read",
          inputSchema: {
            type: "object",
            properties: { alpha: { type: "string" }, beta: { type: "number" } },
            required: ["alpha", "beta"],
          },
          outputSchema: { type: "string", enum: ["alpha", "beta"] },
          handler: () => "alpha",
        },
      },
    });
    const baseline = surface.snapshot();
    const integrityKey = await createSemanticDriftIntegrityKey();
    const manifest = await createSemanticDriftManifest({ snapshot: baseline, declaredTools: [], integrityKey });
    const snapshot = structuredClone(baseline);
    snapshot.nodes[0]!.actions[0]!.inputSchema = {
      required: ["beta", "alpha"],
      properties: { beta: { type: "number" }, alpha: { type: "string" } },
      type: "object",
    };
    snapshot.nodes[0]!.actions[0]!.outputSchema = { enum: ["beta", "alpha"], type: "string" };
    const report = await checkSemanticDrift({
      root: document.body,
      readSnapshot: () => snapshot,
      manifest,
      expectedFingerprint: manifest.fingerprint,
      integrityKey,
      controls: [{ element: button, elementId: "inspect" }],
      declaredTools: [],
      readActiveTools: () => ({ status: "observed", tools: [] }),
      readPermission: () => "allow",
      readApplicationState: () => ({ disabled: false }),
      permissionContext: { principalId: "p", originId: "o", inputCaseId: "default" },
      observationEpoch: epoch,
      readEpoch: () => epoch,
    });
    expect(report.status).toBe("consistent");
  });

  it("detects same-name active tool substitution", async () => {
    const { input, tool } = await fixture();
    input.readActiveTools = () => ({
      status: "observed",
      tools: [{
        ...tool,
        descriptor: { ...tool.descriptor, description: "Substituted behavior" },
      }],
    });
    const report = await checkSemanticDrift(input);
    expect(report.issues).toContainEqual({
      code: "active_tool_semantics_mismatch",
      severity: "critical",
      target: { kind: "tool", index: 0 },
    });
  });

  it("detects an identical-looking active tool rebound to another target", async () => {
    const { input, tool } = await fixture();
    input.readActiveTools = () => ({
      status: "observed",
      tools: [{ ...tool, elementId: "alternate-approval" }],
    });

    const report = await checkSemanticDrift(input);

    expect(report.issues).toContainEqual({
      code: "active_tool_binding_mismatch",
      severity: "critical",
      target: { kind: "tool", index: 0 },
    });
  });

  it.each([
    ["surface", { surfaceId: "alternate-surface" }, "active_tool_surface_mismatch"],
    ["revision", { revision: "alternate-revision" }, "active_tool_revision_mismatch"],
  ] as const)("detects active tool %s evidence drift", async (_case, mutation, code) => {
    const { input, tool } = await fixture();
    input.readActiveTools = () => ({
      status: "observed",
      tools: [{ ...tool, ...mutation }],
    });

    const report = await checkSemanticDrift(input);

    expect(report.issues.some((item) => item.code === code)).toBe(true);
  });

  it("rejects a mixed exporter registration generation", async () => {
    const { input, tool } = await fixture();
    input.readActiveTools = () => ({
      status: "observed",
      tools: [
        tool,
        {
          ...tool,
          descriptor: { ...tool.descriptor, name: "documents.inspect" },
          elementId: "inspection",
          action: "inspect",
          generation: tool.generation + 1,
        },
      ],
    });

    const report = await checkSemanticDrift(input);

    expect(report.issues.some((item) =>
      item.code === "active_tool_generation_mismatch",
    )).toBe(true);
  });

  it("reports a newly declared binding whose current target is unavailable", async () => {
    const { input } = await fixture();
    input.declaredTools = [
      ...input.declaredTools,
      {
        name: "documents.archive",
        description: "Archive the reviewed document",
        elementId: "missing-target",
        action: "archive",
      },
    ];

    const report = await checkSemanticDrift(input);

    expect(report.status).toBe("drifted");
    expect(report.coverage.declaredTools).toBe(2);
    expect(report.issues).toContainEqual({
      code: "declared_tool_target_missing",
      severity: "error",
      target: { kind: "binding", index: 1 },
    });
  });

  it("reports a reviewed binding whose target action disappeared", async () => {
    const { input, snapshot } = await fixture();
    const current = structuredClone(snapshot);
    current.nodes[0]!.actions = [];
    input.readSnapshot = () => current;

    const report = await checkSemanticDrift(input);

    expect(report.status).toBe("drifted");
    expect(report.issues).toContainEqual({
      code: "declared_tool_target_missing",
      severity: "error",
      target: { kind: "binding", index: 0 },
    });
  });

  it("detects role, accessible-name, state, visibility, and navigation drift without echoing values", async () => {
    const secret = "SECRET_DRIFT_SENTINEL";
    const { input, button, snapshot } = await fixture();
    input.readSnapshot = () => snapshot;
    button.setAttribute("role", "link");
    button.setAttribute("aria-label", secret);
    button.disabled = true;
    snapshot.url = `https://different.example/?token=${secret}`;
    const report = await checkSemanticDrift(input);
    const codes = report.issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      "accessibility_role_mismatch",
      "accessible_name_mismatch",
      "dom_state_mismatch",
      "navigation_mismatch",
    ]));
    expect(JSON.stringify(report)).not.toContain(secret);

    const hidden = await fixture();
    hidden.button.hidden = true;
    expect((await checkSemanticDrift(hidden.input)).issues.some((item) => item.code === "hidden_control_exposed")).toBe(true);
  });

  it("hashes non-sensitive values and detects value drift without leaking raw values", async () => {
    const secret = "VALUE_SECRET_SENTINEL";
    document.body.innerHTML = `<input aria-label="Reference" value="${secret}">`;
    const control = document.querySelector("input")!;
    const surface = createAgentSurface({ surfaceId: "value-test" });
    surface.register(control, { id: "reference" });
    const snapshot = surface.snapshot();
    const integrityKey = await createSemanticDriftIntegrityKey();
    const manifest = await createSemanticDriftManifest({ snapshot, declaredTools: [], integrityKey });
    const valueDigest = await digestSemanticValue(integrityKey, "reference", secret);
    expect(JSON.stringify(manifest)).not.toContain(secret);
    const input: SemanticDriftInput = {
      root: document.body,
      readSnapshot: () => snapshot,
      manifest,
      expectedFingerprint: manifest.fingerprint,
      integrityKey,
      controls: [{ element: control, elementId: "reference" }],
      declaredTools: [],
      readActiveTools: () => ({ status: "observed", tools: [] }),
      readPermission: () => "allow",
      readApplicationState: () => ({ disabled: false, valueDigest }),
      permissionContext: { principalId: "p", originId: "o", inputCaseId: "default" },
      observationEpoch: epoch,
      readEpoch: () => epoch,
    };
    expect((await checkSemanticDrift(input)).status).toBe("consistent");
    control.value = "changed";
    const report = await checkSemanticDrift(input);
    expect(report.issues.some((item) => item.code === "dom_state_mismatch")).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("requires complete, current permission and application-state evidence", async () => {
    const missing = await fixture();
    missing.input.readPermission = () => undefined;
    missing.input.readApplicationState = () => undefined;
    const report = await checkSemanticDrift(missing.input);
    expect(report.status).toBe("incomplete");
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "permission_observation_missing", "application_state_observation_missing",
    ]));

    const empty = await fixture();
    empty.input.readApplicationState = () => ({});
    await expect(checkSemanticDrift(empty.input)).rejects.toThrow("Invalid semantic drift input");
  });

  it("fails closed for unknown, denied, and mismatched confirmation policy", async () => {
    const unknown = await fixture();
    unknown.input.readPermission = () => "unknown";
    expect((await checkSemanticDrift(unknown.input)).status).toBe("incomplete");

    const denied = await fixture();
    denied.input.readPermission = () => "deny";
    expect((await checkSemanticDrift(denied.input)).issues.some((item) => item.code === "denied_action_exposed")).toBe(true);

    const mismatch = await fixture();
    mismatch.snapshot.nodes[0]!.actions[0]!.requiresConfirmation = false;
    mismatch.input.readSnapshot = () => mismatch.snapshot;
    expect((await checkSemanticDrift(mismatch.input)).status).toBe("drifted");
  });

  it("detects an epoch change across observation", async () => {
    const { input, tool } = await fixture();
    let call = 0;
    input.readEpoch = () => ++call === 1 ? epoch : 2;
    const report = await checkSemanticDrift(input);
    expect(report.status).toBe("incomplete");
    expect(report.issues.some((item) => item.code === "observation_epoch_changed")).toBe(true);
  });

  it("bounds DOM traversal and reports incomplete coverage", async () => {
    const { input } = await fixture();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 2_100; index += 1) fragment.append(document.createElement("div"));
    document.body.append(fragment);
    const report = await checkSemanticDrift(input);
    expect(report.status).toBe("incomplete");
    expect(report.truncated).toBe(true);
    expect(report.coverage.domNodesVisited).toBe(2_048);
    expect(report.issues.some((item) => item.code === "resource_budget_exceeded")).toBe(true);
  });

  it("finds disabled native and ARIA controls even when they have no inferred action", async () => {
    const disabled = await fixture();
    document.body.insertAdjacentHTML("beforeend", `<button disabled>Disabled extra</button><div role="switch" aria-checked="false">Extra switch</div>`);
    const report = await checkSemanticDrift(disabled.input);
    expect(report.issues.filter((item) => item.code === "visible_control_unmapped").length).toBeGreaterThanOrEqual(2);
  });

  it("tracks native disabled ancestry and fails incomplete for unrepresentable ARIA state", async () => {
    document.body.innerHTML = `<fieldset disabled><button aria-label="Save">Save</button></fieldset><div role="switch" aria-label="Mode" aria-checked="false"></div>`;
    const button = document.querySelector("button")!;
    const toggle = document.querySelector('[role="switch"]')!;
    const surface = createAgentSurface({ surfaceId: "aria-state" });
    surface.register(button, { id: "save" });
    surface.register(toggle, { id: "mode" });
    const snapshot = surface.snapshot();
    const integrityKey = await createSemanticDriftIntegrityKey();
    const manifest = await createSemanticDriftManifest({ snapshot, declaredTools: [], integrityKey });
    const input: SemanticDriftInput = {
      root: document.body,
      readSnapshot: () => snapshot,
      manifest,
      expectedFingerprint: manifest.fingerprint,
      integrityKey,
      controls: [{ element: button, elementId: "save" }, { element: toggle, elementId: "mode" }],
      declaredTools: [],
      readActiveTools: () => ({ status: "observed", tools: [] }),
      readPermission: () => undefined,
      readApplicationState: (id) => id === "save"
        ? { disabled: true }
        : {},
      permissionContext: { principalId: "p", originId: "o", inputCaseId: "default" },
      observationEpoch: epoch,
      readEpoch: () => epoch,
    };
    const baseline = await checkSemanticDrift(input);
    expect(baseline.status).toBe("incomplete");
    expect(baseline.issues.some((item) => item.code === "dom_state_mismatch")).toBe(false);
    expect(baseline.issues.some((item) => item.code === "accessibility_state_unsupported")).toBe(true);
    toggle.setAttribute("aria-checked", "true");
    expect((await checkSemanticDrift(input)).issues.some((item) => item.code === "accessibility_state_unsupported")).toBe(true);
  });

  it("fails incomplete when a native checkbox becomes indeterminate", async () => {
    document.body.innerHTML = `<input type="checkbox" aria-label="Accept">`;
    const checkbox = document.querySelector("input")!;
    const surface = createAgentSurface({ surfaceId: "indeterminate" });
    surface.register(checkbox, { id: "accept" });
    const snapshot = surface.snapshot();
    const integrityKey = await createSemanticDriftIntegrityKey();
    const manifest = await createSemanticDriftManifest({ snapshot, declaredTools: [], integrityKey });
    const valueDigest = await digestSemanticValue(integrityKey, "accept", checkbox.value);
    const input: SemanticDriftInput = {
      root: document.body,
      readSnapshot: () => surface.snapshot(),
      manifest,
      expectedFingerprint: manifest.fingerprint,
      integrityKey,
      controls: [{ element: checkbox, elementId: "accept" }],
      declaredTools: [],
      readActiveTools: () => ({ status: "observed", tools: [] }),
      readPermission: () => "allow",
      readApplicationState: () => ({ disabled: false, checked: false, valueDigest }),
      permissionContext: { principalId: "p", originId: "o", inputCaseId: "default" },
      observationEpoch: epoch,
      readEpoch: () => epoch,
    };
    expect((await checkSemanticDrift(input)).status).toBe("consistent");
    checkbox.indeterminate = true;
    const report = await checkSemanticDrift(input);
    expect(report.status).toBe("incomplete");
    expect(report.issues.some((item) => item.code === "accessibility_state_unsupported")).toBe(true);
  });

  it("treats deep ancestry and nested browsing or shadow surfaces as incomplete", async () => {
    const deep = await fixture();
    let parent: Element = document.body;
    for (let index = 0; index < 129; index += 1) {
      const wrapper = document.createElement("div");
      parent.append(wrapper);
      parent = wrapper;
    }
    parent.append(deep.button);
    const deepReport = await checkSemanticDrift(deep.input);
    expect(deepReport.status).toBe("incomplete");
    expect(deepReport.issues.some((item) => item.code === "resource_budget_exceeded")).toBe(true);
    expect(deepReport.issues.some((item) => item.code === "hidden_control_exposed")).toBe(false);

    const nested = await fixture();
    document.body.append(document.createElement("iframe"));
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = `<button>Nested</button>`;
    document.body.append(host);
    const nestedReport = await checkSemanticDrift(nested.input);
    expect(nestedReport.status).toBe("incomplete");
    expect(nestedReport.issues.filter((item) => item.code === "nested_surface_unobserved")).toHaveLength(2);
  });

  it("supports same-origin iframe roots without ambient-realm instanceof checks", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const foreignDocument = iframe.contentDocument!;
    foreignDocument.body.innerHTML = `<button aria-label="Foreign approve">Approve</button>`;
    const button = foreignDocument.querySelector("button")!;
    const snapshot = {
      schemaVersion: "0.1" as const,
      surfaceId: "iframe-surface",
      revision: "1",
      title: "",
      url: foreignDocument.location.href,
      generatedAt: new Date(0).toISOString(),
      capabilities: [],
      nodes: [{ id: "foreign", role: "button", name: "Foreign approve", state: { disabled: false }, actions: [] }],
    };
    const integrityKey = await createSemanticDriftIntegrityKey();
    const manifest = await createSemanticDriftManifest({ snapshot, declaredTools: [], integrityKey });
    const report = await checkSemanticDrift({
      root: foreignDocument.body,
      readSnapshot: () => snapshot,
      manifest,
      expectedFingerprint: manifest.fingerprint,
      integrityKey,
      controls: [{ element: button, elementId: "foreign" }],
      declaredTools: [],
      readActiveTools: () => ({ status: "observed", tools: [] }),
      readPermission: () => undefined,
      readApplicationState: () => ({ disabled: false }),
      permissionContext: { principalId: "p", originId: "o", inputCaseId: "default" },
      observationEpoch: epoch,
      readEpoch: () => epoch,
    });
    expect(report.status).toBe("consistent");
  });

  it("does not invoke hostile getters and uses a captured array length", async () => {
    const getter = vi.fn(() => "secret");
    const hostile = Object.defineProperty({}, "snapshot", { enumerable: true, get: getter });
    await expect(checkSemanticDrift(hostile as never)).rejects.toThrow("Invalid semantic drift input");
    expect(getter).not.toHaveBeenCalled();

    const { input } = await fixture();
    const get = vi.fn((target: unknown[], property: PropertyKey, receiver: unknown) => Reflect.get(target, property, receiver));
    input.controls = new Proxy(input.controls as unknown[], { get }) as never;
    expect((await checkSemanticDrift(input)).status).toBe("consistent");
    expect(get).not.toHaveBeenCalledWith(expect.anything(), "length", expect.anything());
  });

  it("rejects a manifest whose content no longer matches its fingerprint", async () => {
    const { input } = await fixture();
    const manifest = structuredClone(input.manifest) as typeof input.manifest;
    (manifest.nodes[0] as { role: string }).role = "link";
    input.manifest = manifest;
    await expect(checkSemanticDrift(input)).rejects.toThrow("Invalid semantic drift input");
  });

  it("rejects a newly signed compromised manifest when the reviewed fingerprint stays pinned", async () => {
    const { input, snapshot } = await fixture();
    snapshot.nodes[0]!.actions[0]!.risk = "read";
    input.manifest = await createSemanticDriftManifest({
      snapshot,
      declaredTools: input.declaredTools,
      integrityKey: input.integrityKey,
    });
    await expect(checkSemanticDrift(input)).rejects.toThrow("Invalid semantic drift input");
  });

  it("recreates the same manifest fingerprint from a provisioned cross-process key", async () => {
    const { snapshot, input } = await fixture();
    const secret = new Uint8Array(32).fill(7);
    const firstKey = await importSemanticDriftIntegrityKey(secret);
    const secondKey = await importSemanticDriftIntegrityKey(secret);
    const first = await createSemanticDriftManifest({
      snapshot,
      declaredTools: input.declaredTools,
      integrityKey: firstKey,
    });
    const second = await createSemanticDriftManifest({
      snapshot,
      declaredTools: input.declaredTools,
      integrityKey: secondKey,
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(firstKey.extractable).toBe(false);
    expect(secondKey.extractable).toBe(false);
  });

  it("returns incomplete instead of rejecting a valid snapshot beyond its evidence budget", async () => {
    const { input, tool, snapshot } = await fixture();
    const extra = Array.from({ length: 512 }, (_, index) => ({
      id: `extra-${index}`,
      role: "heading",
      name: `Heading ${index}`,
      state: {},
      actions: [],
    }));
    const largeSnapshot = { ...snapshot, nodes: [snapshot.nodes[0]!, ...extra] };
    input.readSnapshot = () => largeSnapshot;
    input.manifest = await createSemanticDriftManifest({
      snapshot: largeSnapshot,
      declaredTools: input.declaredTools,
      integrityKey: input.integrityKey,
    });
    input.expectedFingerprint = input.manifest.fingerprint;
    input.readActiveTools = () => ({
      status: "observed",
      tools: [tool],
    });
    const report = await checkSemanticDrift(input);
    expect(report.status).toBe("incomplete");
    expect(report.truncated).toBe(true);
    expect(report.issues.some((item) => item.code === "resource_budget_exceeded")).toBe(true);
  });

  it("integrates with the actual WebMCP exporter observations", async () => {
    const { input } = await fixture();
    const surface = {
      snapshot: () => input.readSnapshot(),
      performSafe: vi.fn(),
    };
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      bindings: input.declaredTools,
      modelContext: {
        registerTool() {},
      },
    });
    input.readActiveTools = () => ({
      status: "observed",
      tools: handle.toolObservations,
    });
    expect(handle.toolNames).toEqual([binding.name]);
    expect(handle.toolDescriptors).toHaveLength(1);
    expect(handle.toolObservations).toHaveLength(1);
    expect((await checkSemanticDrift(input)).status).toBe("consistent");
    await handle.refresh();
    expect(handle.toolDescriptors).toHaveLength(1);
    expect(handle.toolObservations[0]?.generation).toBe(2);
    input.readActiveTools = () => ({
      status: "observed",
      tools: handle.toolObservations,
    });
    expect((await checkSemanticDrift(input)).status).toBe("consistent");
    handle.dispose();
    expect(handle.toolDescriptors).toEqual([]);
    expect(handle.toolObservations).toEqual([]);
    input.readActiveTools = () => ({
      status: "observed",
      tools: handle.toolObservations,
    });
    expect((await checkSemanticDrift(input)).issues.some(
      (item) => item.code === "active_tool_missing",
    )).toBe(true);
  });
});
