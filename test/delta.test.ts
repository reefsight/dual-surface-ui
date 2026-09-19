import { describe, expect, it } from "vitest";

import {
  applyAgentSnapshotDelta,
  createAgentSnapshotDelta,
} from "../src/delta/index.js";
import type { AgentSnapshot } from "../src/types.js";

const node = (
  id: string,
  name = id,
  value?: string,
): AgentSnapshot["nodes"][number] => ({
  id,
  role: "button",
  name,
  state: value === undefined ? {} : { value },
  actions: [
    {
      name: "activate",
      risk: "write",
      preconditions: ["visible", "enabled"],
      effects: ["submitted", "changed"],
    },
  ],
});

const snapshot = (
  revision: string,
  overrides: Partial<AgentSnapshot> = {},
): AgentSnapshot => ({
  schemaVersion: "0.1",
  surfaceId: "surface-a",
  revision,
  title: "Example",
  url: "https://example.test/form",
  generatedAt: `2026-09-20T00:00:0${revision}.000Z`,
  capabilities: ["observe", "act"],
  nodes: [node("save", "Save")],
  ...overrides,
});

describe("incremental snapshot deltas", () => {
  it("round-trips metadata and complete node add, replace, and removal", async () => {
    const base = snapshot("1", {
      focusedElementId: "old",
      nodes: [node("old", "Old"), node("save", "Save")],
    });
    const target = snapshot("2", {
      title: "Updated",
      focusedElementId: "new",
      capabilities: ["act", "observe", "review"],
      nodes: [node("new", "New"), node("save", "Save now")],
    });

    const created = await createAgentSnapshotDelta(base, target);
    expect(created.status).toBe("delta");
    if (created.status !== "delta") return;
    expect(created.delta.removedNodeIds).toEqual(["old"]);
    expect(created.delta.nodeUpserts.map((item) => item.id)).toEqual([
      "new",
      "save",
    ]);
    expect(Object.isFrozen(created.delta)).toBe(true);
    expect(Object.isFrozen(created.delta.nodeUpserts)).toBe(true);

    const applied = await applyAgentSnapshotDelta(base, created.delta);
    expect(applied).toEqual({
      status: "applied",
      snapshot: {
        ...target,
        capabilities: ["act", "observe", "review"],
        nodes: target.nodes.map((item) => ({
          ...item,
          actions: item.actions.map((action) => ({
            ...action,
            preconditions: ["enabled", "visible"],
            effects: ["changed", "submitted"],
          })),
        })),
      },
    });
    if (applied.status === "applied") {
      expect(Object.isFrozen(applied.snapshot)).toBe(true);
      expect(Object.isFrozen(applied.snapshot.nodes)).toBe(true);
    }
  });

  it("normalizes input ordering deterministically without mutating callers", async () => {
    const base = snapshot("1");
    const target = snapshot("2", {
      capabilities: ["observe", "act"],
      nodes: [node("z"), node("a")],
    });
    const untouched = structuredClone(target);

    const first = await createAgentSnapshotDelta(base, target);
    const second = await createAgentSnapshotDelta(base, {
      ...target,
      capabilities: ["act", "observe"],
      nodes: [node("a"), node("z")],
    });

    expect(target).toEqual(untouched);
    expect(first).toEqual(second);
  });

  it("treats generatedAt-only observations at one revision as no change", async () => {
    const base = snapshot("1");
    const later = { ...snapshot("1"), generatedAt: "2026-09-20T00:01:00.000Z" };

    await expect(createAgentSnapshotDelta(base, later)).resolves.toEqual({
      status: "no_change",
    });
  });

  it("fails closed on a same-revision semantic collision", async () => {
    const base = snapshot("1");
    const collision = { ...snapshot("1"), title: "Different" };

    await expect(createAgentSnapshotDelta(base, collision)).resolves.toEqual({
      status: "resync_required",
      reason: "revision_collision",
    });
  });

  it("requires the exact surface, revision, and canonical base digest", async () => {
    const base = snapshot("1");
    const created = await createAgentSnapshotDelta(
      base,
      snapshot("2", { nodes: [node("save", "Save changed")] }),
    );
    expect(created.status).toBe("delta");
    if (created.status !== "delta") return;

    await expect(
      applyAgentSnapshotDelta({ ...base, surfaceId: "other" }, created.delta),
    ).resolves.toMatchObject({ status: "resync_required" });
    await expect(
      applyAgentSnapshotDelta({ ...base, revision: "stale" }, created.delta),
    ).resolves.toEqual({
      status: "resync_required",
      reason: "base_revision_mismatch",
    });
    await expect(
      applyAgentSnapshotDelta({ ...base, title: "altered" }, created.delta),
    ).resolves.toEqual({
      status: "resync_required",
      reason: "base_digest_mismatch",
    });
  });

  it("detects target tampering and never returns a partial snapshot", async () => {
    const base = snapshot("1");
    const created = await createAgentSnapshotDelta(base, snapshot("2"));
    expect(created.status).toBe("delta");
    if (created.status !== "delta") return;
    const tampered = structuredClone(created.delta);
    tampered.target.title = "tampered";

    await expect(applyAgentSnapshotDelta(base, tampered)).resolves.toEqual({
      status: "resync_required",
      reason: "target_digest_mismatch",
    });
  });

  it("does not resurrect or serialize secrets from removed nodes", async () => {
    const secret = "SECRET-PASSWORD-7319";
    const base = snapshot("1", { nodes: [node("password", "Password", secret)] });
    const target = snapshot("2", { nodes: [] });

    const created = await createAgentSnapshotDelta(base, target);
    expect(created.status).toBe("delta");
    if (created.status !== "delta") return;
    expect(JSON.stringify(created.delta)).not.toContain(secret);
    const applied = await applyAgentSnapshotDelta(base, created.delta);
    expect(JSON.stringify(applied)).not.toContain(secret);
    expect(applied).toMatchObject({ status: "applied", snapshot: { nodes: [] } });
  });

  it("replaces sensitive nodes completely without retaining old values", async () => {
    const secret = "OTP-SECRET-90210";
    const base = snapshot("1", { nodes: [node("otp", "OTP", secret)] });
    const target = snapshot("2", {
      nodes: [{ ...node("otp", "OTP"), state: { sensitive: true } }],
    });

    const created = await createAgentSnapshotDelta(base, target);
    expect(created.status).toBe("delta");
    if (created.status !== "delta") return;
    expect(JSON.stringify(created.delta)).not.toContain(secret);
    const applied = await applyAgentSnapshotDelta(base, created.delta);
    expect(JSON.stringify(applied)).not.toContain(secret);
    expect(applied).toMatchObject({
      status: "applied",
      snapshot: { nodes: [{ id: "otp", state: { sensitive: true } }] },
    });
  });

  it("rejects accessors without invoking them", async () => {
    let reads = 0;
    const hostile = { ...snapshot("1") } as AgentSnapshot;
    Object.defineProperty(hostile, "title", {
      enumerable: true,
      get() {
        reads += 1;
        return "stolen";
      },
    });

    await expect(createAgentSnapshotDelta(hostile, snapshot("2"))).resolves.toEqual({
      status: "resync_required",
      reason: "invalid_base",
    });
    expect(reads).toBe(0);
  });

  it("rejects duplicate, overlapping, unknown, and oversized delta input", async () => {
    const base = snapshot("1");
    const created = await createAgentSnapshotDelta(
      base,
      snapshot("2", { nodes: [node("save", "Save changed")] }),
    );
    expect(created.status).toBe("delta");
    if (created.status !== "delta") return;

    const overlap = structuredClone(created.delta);
    overlap.removedNodeIds = [overlap.nodeUpserts[0]!.id];
    await expect(applyAgentSnapshotDelta(base, overlap)).resolves.toEqual({
      status: "resync_required",
      reason: "invalid_delta",
    });

    const unknown = { ...structuredClone(created.delta), surprise: true };
    await expect(applyAgentSnapshotDelta(base, unknown)).resolves.toEqual({
      status: "resync_required",
      reason: "invalid_delta",
    });

    const duplicateUpsert = structuredClone(created.delta);
    duplicateUpsert.nodeUpserts = [
      duplicateUpsert.nodeUpserts[0]!,
      duplicateUpsert.nodeUpserts[0]!,
    ];
    await expect(applyAgentSnapshotDelta(base, duplicateUpsert)).resolves.toEqual({
      status: "resync_required",
      reason: "invalid_delta",
    });

    const removalCreated = await createAgentSnapshotDelta(
      base,
      snapshot("2", { nodes: [] }),
    );
    expect(removalCreated.status).toBe("delta");
    if (removalCreated.status === "delta") {
      const duplicateRemoval = structuredClone(removalCreated.delta);
      duplicateRemoval.removedNodeIds = ["save", "save"];
      await expect(applyAgentSnapshotDelta(base, duplicateRemoval)).resolves.toEqual({
        status: "resync_required",
        reason: "invalid_delta",
      });
    }

    const oversized = structuredClone(created.delta);
    oversized.removedNodeIds = Array.from({ length: 513 }, (_, index) => `n-${index}`);
    await expect(applyAgentSnapshotDelta(base, oversized)).resolves.toEqual({
      status: "resync_required",
      reason: "budget_exceeded",
    });
  });

  it("rejects cycles, sparse arrays, symbols, setters, and non-finite values", async () => {
    const cyclic = { ...snapshot("1") } as AgentSnapshot & { self?: unknown };
    cyclic.self = cyclic;
    await expect(createAgentSnapshotDelta(cyclic, snapshot("2"))).resolves
      .toMatchObject({ status: "resync_required", reason: "invalid_base" });

    const sparse = snapshot("1");
    sparse.nodes = new Array(1) as AgentSnapshot["nodes"];
    await expect(createAgentSnapshotDelta(sparse, snapshot("2"))).resolves
      .toMatchObject({ status: "resync_required", reason: "invalid_base" });

    const symbolled = { ...snapshot("1"), [Symbol("hidden")]: true };
    await expect(createAgentSnapshotDelta(symbolled, snapshot("2"))).resolves
      .toMatchObject({ status: "resync_required", reason: "invalid_base" });

    const setter = { ...snapshot("1") };
    Object.defineProperty(setter, "title", {
      enumerable: true,
      set(_value: string) {},
    });
    await expect(createAgentSnapshotDelta(setter, snapshot("2"))).resolves
      .toMatchObject({ status: "resync_required", reason: "invalid_base" });

    const nonFinite = snapshot("1", {
      nodes: [{ ...node("save"), bounds: { x: Number.NaN, y: 0, width: 1, height: 1 } }],
    });
    await expect(createAgentSnapshotDelta(nonFinite, snapshot("2"))).resolves
      .toMatchObject({ status: "resync_required", reason: "invalid_base" });
  });

  it("uses stable budget outcomes at declared operation and snapshot limits", async () => {
    const atLimit = snapshot("1", {
      nodes: Array.from({ length: 512 }, (_, index) => node(`n-${index}`)),
    });
    const atLimitCreated = await createAgentSnapshotDelta(
      atLimit,
      snapshot("2", { nodes: [] }),
    );
    expect(atLimitCreated.status).toBe("delta");

    const overOperations = snapshot("1", {
      nodes: Array.from({ length: 513 }, (_, index) => node(`n-${index}`)),
    });
    await expect(
      createAgentSnapshotDelta(overOperations, snapshot("2", { nodes: [] })),
    ).resolves.toEqual({ status: "resync_required", reason: "budget_exceeded" });

    const overNodes = snapshot("1", {
      nodes: Array.from({ length: 4_097 }, (_, index) => ({
        id: `n-${index}`,
        role: "text",
        name: "",
        state: {},
        actions: [],
      })),
    });
    await expect(createAgentSnapshotDelta(overNodes, snapshot("2"))).resolves
      .toEqual({ status: "resync_required", reason: "budget_exceeded" });

    await expect(
      createAgentSnapshotDelta(
        snapshot("1", { title: "ก".repeat(8_193) }),
        snapshot("2"),
      ),
    ).resolves.toEqual({ status: "resync_required", reason: "budget_exceeded" });
  });

  it("handles prototype-like IDs through Maps without polluting prototypes", async () => {
    const base = snapshot("1", { nodes: [] });
    const target = snapshot("2", { nodes: [node("__proto__")] });
    const created = await createAgentSnapshotDelta(base, target);
    expect(created.status).toBe("delta");
    if (created.status !== "delta") return;

    const applied = await applyAgentSnapshotDelta(base, created.delta);
    expect(applied).toMatchObject({
      status: "applied",
      snapshot: { nodes: [{ id: "__proto__" }] },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("fails closed on missed deltas in a multi-revision chain", async () => {
    const a = snapshot("1");
    const b = snapshot("2", { title: "B" });
    const c = snapshot("3", { title: "C" });
    const ab = await createAgentSnapshotDelta(a, b);
    const bc = await createAgentSnapshotDelta(b, c);
    expect(ab.status).toBe("delta");
    expect(bc.status).toBe("delta");
    if (ab.status !== "delta" || bc.status !== "delta") return;

    await expect(applyAgentSnapshotDelta(a, bc.delta)).resolves.toEqual({
      status: "resync_required",
      reason: "base_revision_mismatch",
    });
    const appliedB = await applyAgentSnapshotDelta(a, ab.delta);
    expect(appliedB.status).toBe("applied");
    if (appliedB.status !== "applied") return;
    await expect(applyAgentSnapshotDelta(appliedB.snapshot, bc.delta)).resolves
      .toMatchObject({ status: "applied", snapshot: { revision: "3" } });
  });

  it("rejects non-portable action schemas without compiling them", async () => {
    const unsafe = snapshot("2", {
      nodes: [
        {
          ...node("save"),
          actions: [
            {
              name: "activate",
              risk: "write",
              inputSchema: { $ref: "https://attacker.invalid/schema" },
            },
          ],
        },
      ],
    });

    await expect(createAgentSnapshotDelta(snapshot("1"), unsafe)).resolves.toEqual({
      status: "resync_required",
      reason: "invalid_target",
    });
  });

  it("round-trips a fixed-seed corpus of valid snapshot pairs", async () => {
    let state = 0x5eed1234;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };

    for (let caseIndex = 0; caseIndex < 32; caseIndex += 1) {
      const baseNodes = Array.from(
        { length: Math.floor(random() * 6) },
        (_, index) => node(`base-${caseIndex}-${index}`),
      );
      const targetNodes = baseNodes
        .filter(() => random() > 0.35)
        .map((item) =>
          random() > 0.5 ? node(item.id, `${item.name}-changed`) : item,
        );
      if (random() > 0.3) targetNodes.push(node(`new-${caseIndex}`));
      targetNodes.reverse();
      const base = snapshot(`b-${caseIndex}`, {
        generatedAt: `2026-09-20T00:${String(caseIndex).padStart(2, "0")}:00.000Z`,
        nodes: baseNodes,
      });
      const target = snapshot(`t-${caseIndex}`, {
        generatedAt: `2026-09-20T01:${String(caseIndex).padStart(2, "0")}:00.000Z`,
        title: `Case ${caseIndex}`,
        nodes: targetNodes,
      });

      const created = await createAgentSnapshotDelta(base, target);
      expect(created.status, `create case ${caseIndex}`).toBe("delta");
      if (created.status !== "delta") continue;
      const applied = await applyAgentSnapshotDelta(base, created.delta);
      expect(applied.status, `apply case ${caseIndex}`).toBe("applied");
      if (applied.status !== "applied") continue;
      await expect(
        createAgentSnapshotDelta(applied.snapshot, target),
        `canonical equality case ${caseIndex}`,
      ).resolves.toEqual({ status: "no_change" });
    }
  });
});
