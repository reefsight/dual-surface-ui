import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateP42Review, loadP42ReviewValidator, P42_REVIEW, readP42Review, verifyP42EvidenceBinding, verifyP42ReviewEvidence } from "../scripts/p4.2-review-gate.mjs";

const root = process.cwd();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let actual: any, pending: any, golden: any, validate: any, taskRoot: string, draftPath: string, cliApproved: any;
const context = { canonicalPath: true, evidence: { verified: true, frozenAt: 0 }, now: 0 };
const dateAt = (offset: number) => new Date(context.evidence.frozenAt + offset).toISOString();
// Synthetic approval records exercise admission only; never persist these to
// the canonical review file or claim a reviewer/maintainer actually approved.
const approved = () => {
  const value = clone(pending);
  value.status = "approved";
  value.disposition = "no_unresolved_critical_high";
  for (const scope of Object.values(value.scopes) as any[]) {
    scope.status = "approved";
    scope.reviewer = { id: "test-independent-reviewer", independent: true, independenceBasis: "Synthetic admission test, not a real review" };
    scope.reviewedAt = dateAt(3600000);
  }
  value.maintainer = { id: "test-maintainer", decision: "approved", decidedAt: dateAt(7200000) };
  return value;
};
const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/validate-p4.2-review.mjs", ...args], {
  cwd: root, encoding: "utf8", timeout: 120000,
});
const evaluate = (value: any, changes = {}) => evaluateP42Review(value, validate, { ...context, ...changes });

beforeAll(async () => {
  const frozen = spawnSync("git", ["show", "-s", "--format=%cI", P42_REVIEW.evidenceCommit], { cwd: root, encoding: "utf8", timeout: 10000 });
  if (frozen.status !== 0) throw new Error("frozen_commit_unavailable");
  context.evidence.frozenAt = Date.parse(frozen.stdout.trim());
  if (!Number.isFinite(context.evidence.frozenAt)) throw new Error("invalid_frozen_date");
  context.now = context.evidence.frozenAt + 10800000;
  actual = JSON.parse(await readFile(resolve(root, P42_REVIEW.canonicalPath), "utf8"));
  pending = clone(actual);
  pending.status = "pending"; pending.disposition = "not_reviewed";
  pending.findings = []; pending.unresolvedCriticalHigh = 0;
  for (const name of Object.keys(pending.scopes)) pending.scopes[name] = { status: "pending", reviewer: null, reviewedAt: null };
  pending.maintainer = { id: null, decision: "pending", decidedAt: null };
  golden = JSON.parse(await readFile(resolve(root, P42_REVIEW.goldenPath), "utf8"));
  validate = await loadP42ReviewValidator(root);
  taskRoot = await mkdtemp(resolve(tmpdir(), "dual-surface-p42-review-"));
  await mkdir(resolve(taskRoot, "docs/reviews"), { recursive: true });
  const drafts = resolve(root, ".phase4-preflight/drafts");
  await mkdir(drafts, { recursive: true });
  draftPath = resolve(drafts, `p42-test-approved-${process.pid}.json`);
  cliApproved = approved();
  // Real CLI isolation must not also fail future-date checks on a fresh freeze.
  for (const scope of Object.values(cliApproved.scopes) as any[]) scope.reviewedAt = dateAt(0);
  cliApproved.maintainer.decidedAt = dateAt(0);
  await writeFile(draftPath, JSON.stringify(cliApproved));
});
afterAll(async () => {
  if (draftPath) await rm(draftPath, { force: true });
  if (taskRoot) await rm(taskRoot, { recursive: true, force: true });
});

describe("P4.2 frozen independent review admission", () => {
  it("keeps a pending record outside the gate with no invented identities", () => {
    expect(pending.status).toBe("pending");
    expect(Object.values(pending.scopes).every((scope: any) => scope.reviewer === null && scope.reviewedAt === null)).toBe(true);
    expect(pending.maintainer).toEqual({ id: null, decision: "pending", decidedAt: null });
    expect(evaluate(pending)).toEqual({ contractValid: true, evidenceValid: true, gateReady: false });
    expect(JSON.stringify(actual)).not.toContain("test-independent-reviewer");
    expect(JSON.stringify(actual)).not.toContain("test-maintainer");
  });

  it("admits a complete synthetic canonical approval only with verified evidence", () => {
    expect(evaluate(approved())).toEqual({ contractValid: true, evidenceValid: true, gateReady: true });
    expect(evaluate(approved(), { evidence: { ...context.evidence, verified: false } }).gateReady).toBe(false);
  });

  it("never treats an approved draft as canonical approval", () => {
    expect(evaluate(approved(), { canonicalPath: false }).gateReady).toBe(false);
  });

  it.each(["accessibility", "security", "interoperability", "package"])("requires an independent %s decision", scope => {
    const value = approved();
    value.scopes[scope].reviewer.independent = false;
    expect(evaluate(value).gateReady).toBe(false);
    value.scopes[scope].reviewer = null;
    expect(evaluate(value).gateReady).toBe(false);
    value.scopes[scope].status = "changes_required";
    expect(evaluate(value).gateReady).toBe(false);
  });

  it("requires every scope and rejects extra fields/blank identities", () => {
    const missing = approved(); delete missing.scopes.package;
    const extra = approved(); extra.rawHandle = "forbidden-test-marker";
    const blank = approved(); blank.scopes.security.reviewer.id = " ";
    for (const value of [missing, extra, blank]) expect(evaluate(value).contractValid).toBe(false);
  });

  it.each(["critical", "high"])("blocks both open and accepted %s findings", severity => {
    for (const status of ["open", "accepted"]) {
      const value = approved();
      value.findings = [{ id: "f-1", scope: "security", severity, status, summary: "Synthetic finding", resolution: null }];
      value.unresolvedCriticalHigh = 1;
      expect(evaluate(value).gateReady).toBe(false);
      value.unresolvedCriticalHigh = 0; // A lying counter cannot bypass review.
      expect(evaluate(value).gateReady).toBe(false);
    }
  });

  it("requires resolved findings to include a resolution and unique IDs", () => {
    const value = approved();
    value.findings = [{ id: "f-1", scope: "security", severity: "high", status: "resolved", summary: "Synthetic finding", resolution: null }];
    expect(evaluate(value).gateReady).toBe(false);
    value.findings[0].resolution = "Synthetic correction verified";
    expect(evaluate(value).gateReady).toBe(true);
    value.findings.push(clone(value.findings[0]));
    expect(evaluate(value).gateReady).toBe(false);
  });

  it("rejects review dates before evidence freeze, in the future, null, or malformed", () => {
    for (const date of [dateAt(-1000), dateAt(10800001), null, "not-a-date"]) {
      const value = approved(); value.scopes.security.reviewedAt = date;
      expect(evaluate(value).gateReady).toBe(false);
    }
  });

  it("requires maintainer acceptance after all reviews", () => {
    for (const change of [{ decision: "pending" }, { id: null }, { decidedAt: null }, { decidedAt: dateAt(1800000) }, { decidedAt: dateAt(10800001) }]) {
      const value = approved(); Object.assign(value.maintainer, change);
      expect(evaluate(value).gateReady).toBe(false);
    }
  });

  it.each(["reviewedCommit", "evidenceCommit", "goldenDigest", "manifestDigest", "semanticsDigest", "sourceBindingDigest", "captureBinaryDigest", "captureDigests"])("rejects changed frozen binding: %s", key => {
    const value = approved(); value[key] = key === "captureDigests" ? [] : "changed";
    expect(evaluate(value).contractValid).toBe(false);
    expect(() => verifyP42EvidenceBinding(value, golden)).toThrow("evidence_invalid");
  });

  it("detects current golden changes even when envelope fields are unchanged", () => {
    expect(() => verifyP42EvidenceBinding(pending, golden)).not.toThrow();
    const changed = clone(golden); changed.captures[0].events[0].sequence += 1;
    expect(() => verifyP42EvidenceBinding(pending, changed)).toThrow("evidence_invalid");
  });

  it("verifies the actual frozen Git ancestry, source blobs, manifest and both captures", async () => {
    expect(await verifyP42ReviewEvidence(root, pending)).toEqual(context.evidence);
  }, 120000);
});

describe("P4.2 bounded read-only review entrypoint", () => {
  it("reports a valid pending contract without reporting gate approval", () => {
    const result = run("--contract-only");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "review_contract_verified", contractValid: true, evidenceValid: true, gateReady: false });
  }, 120000);

  it("reports the actual canonical decision, not a synthetic test approval", () => {
    const result = run();
    const expected = evaluateP42Review(actual, validate, { ...context, now: Date.now() });
    expect(result.status).toBe(expected.gateReady ? 0 : 3);
    expect(JSON.parse(result.stdout)).toEqual({ status: expected.gateReady ? "gate_ready" : "gate_not_ready", ...expected });
    expect(result.stderr).toBe("");
  }, 120000);

  it("rejects a fully approved synthetic draft at the real CLI gate", () => {
    expect(evaluateP42Review(cliApproved, validate, { ...context, now: Date.now() }).gateReady).toBe(true);
    const result = run(draftPath);
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual({ status: "gate_not_ready", contractValid: true, evidenceValid: true, gateReady: false });
    expect(result.stdout).not.toContain("test-independent-reviewer");
    expect(result.stderr).toBe("");
  }, 120000);

  it.each([".env", "../outside.json", "docs/reviews/p4.1-independent-review.json", "--unknown"])("rejects out-of-scope paths/flags without reading or echoing: %s", name => {
    const result = run(name);
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout).gateReady).toBe(false);
    expect(result.stdout).not.toContain(name);
    expect(result.stderr).toBe("");
  });

  it("accepts a draft as noncanonical input only", async () => {
    const drafts = resolve(taskRoot, ".phase4-preflight/drafts");
    await mkdir(drafts, { recursive: true });
    await writeFile(resolve(drafts, "candidate.json"), JSON.stringify(approved()));
    expect((await readP42Review(taskRoot, ".phase4-preflight/drafts/candidate.json")).canonicalPath).toBe(false);
  });

  it("rejects oversized, invalid UTF-8 and malformed JSON with no content echo", async () => {
    const path = resolve(taskRoot, P42_REVIEW.canonicalPath);
    for (const bytes of [Buffer.alloc(P42_REVIEW.recordBudget + 1, 65), Buffer.from([0xff]), Buffer.from("{not-json secret-test-marker}")]) {
      await writeFile(path, bytes);
      await expect(readP42Review(taskRoot)).rejects.toThrow();
    }
  });

  it("rejects a junction/symlink parent rather than following it", async () => {
    const linkedRoot = resolve(taskRoot, "linked-root");
    const target = resolve(taskRoot, "link-target");
    await mkdir(resolve(linkedRoot, ".phase4-preflight"), { recursive: true });
    await mkdir(target);
    await writeFile(resolve(target, "candidate.json"), "{}");
    await symlink(target, resolve(linkedRoot, ".phase4-preflight/drafts"), process.platform === "win32" ? "junction" : "dir");
    await expect(readP42Review(linkedRoot, ".phase4-preflight/drafts/candidate.json")).rejects.toThrow("invalid_path");
  });
});
