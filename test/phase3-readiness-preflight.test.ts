import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const run = (cwd: string, strict = false) =>
  spawnSync(
    process.execPath,
    ["scripts/check-phase3-readiness.mjs", ...(strict ? ["--require-ready"] : [])],
    { cwd, encoding: "utf8" },
  );
const readReport = (cwd: string) =>
  readFile(resolve(cwd, ".phase3-preflight", "report.json"), "utf8").then(JSON.parse);

describe("Phase 3 readiness preflight with canonical evidence", () => {
  it("opens P3.10 only when every current authority gate is ready", async () => {
    const result = run(repositoryRoot);
    expect(result.status).toBe(0);
    const report = await readReport(repositoryRoot);
    expect(report.status).toBe("ready");
    expect(report.readyForP310).toBe(true);
    expect(report.summary).toEqual({ ready: 7, missing: 0, failed: 0 });
    expect(report.reportDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("passes the strict gate when every canonical artifact is ready", () => {
    expect(run(repositoryRoot, true).status).toBe(0);
  });
});

describe("Phase 3 readiness preflight without authority evidence", () => {
  let fixtureRoot: string;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(
      join(repositoryRoot, ".phase3-preflight", "missing-workspace-"),
    );
    await Promise.all([
      mkdir(resolve(fixtureRoot, "scripts"), { recursive: true }),
      mkdir(resolve(fixtureRoot, "docs/evidence"), { recursive: true }),
      mkdir(resolve(fixtureRoot, "fixtures/phase3-exit"), { recursive: true }),
    ]);
    await Promise.all([
      cp(
        resolve(repositoryRoot, "scripts/check-phase3-readiness.mjs"),
        resolve(fixtureRoot, "scripts/check-phase3-readiness.mjs"),
      ),
      cp(
        resolve(repositoryRoot, "scripts/phase3-evidence-gates.mjs"),
        resolve(fixtureRoot, "scripts/phase3-evidence-gates.mjs"),
      ),
      cp(
        resolve(repositoryRoot, "fixtures/phase3-exit/contracts"),
        resolve(fixtureRoot, "fixtures/phase3-exit/contracts"),
        { recursive: true },
      ),
      ...[
        "p3.6-conformance-report-2026-09-21.json",
        "p3.7-adversarial-report-2026-09-21.json",
        "p3.8-golden-task-suite-2026-09-21.json",
        "p3.9-structural-benchmark-2026-09-21.json",
      ].map((name) =>
        cp(
          resolve(repositoryRoot, "docs/evidence", name),
          resolve(fixtureRoot, "docs/evidence", name),
        ),
      ),
    ]);
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("keeps P3.10 closed when authority-bound evidence is absent", async () => {
    expect(run(fixtureRoot).status).toBe(0);
    const report = await readReport(fixtureRoot);
    expect(report.status).toBe("not_ready");
    expect(report.readyForP310).toBe(false);
    expect(report.summary).toEqual({ ready: 4, missing: 3, failed: 0 });
    expect(
      report.checks
        .filter((item: { status: string }) => item.status === "missing")
        .map((item: { id: string }) => item.id),
    ).toEqual([
      "p3.7.independent_security",
      "p3.8.actual_models",
      "p3.9.model_benchmark",
    ]);
  });

  it("fails the strict gate rather than treating missing evidence as success", () => {
    expect(run(fixtureRoot, true).status).toBe(2);
  });
});
