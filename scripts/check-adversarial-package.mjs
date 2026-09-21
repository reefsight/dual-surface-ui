import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
const SECRET_SENTINEL = "P37_RUNTIME_SECRET_SENTINEL_7f3c9a";
const evidencePath = resolve(root, ".adversarial-evidence", "report.json");
const temp = await mkdtemp(join(tmpdir(), "dual-surface-adversarial-package-"));
const run = (args) => {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
};

try {
  const report = JSON.parse(await readFile(evidencePath, "utf8"));
  if (report.kind !== "agent-adversarial-report" || report.cases?.length !== 23) throw new Error("adversarial report is incomplete");
  if (report.summary?.failed !== 0 || report.summary?.unauthorizedMutations !== 0 || report.summary?.unresolvedCriticalHigh !== 0) {
    throw new Error("adversarial report contains unresolved findings");
  }
  if (report.scan?.sentinelMatches !== 0 || JSON.stringify(report).includes(SECRET_SENTINEL)) throw new Error("adversarial report leaked a secret sentinel");
  const packed = JSON.parse(run(["pack", "--pack-destination", temp, "--json"]));
  if (!Array.isArray(packed) || packed.length !== 1) throw new Error("invalid package manifest");
  const files = packed[0].files.map(({ path }) => path);
  const privateLeak = files.find((path) => path.startsWith("fixtures/adversarial/") || path.startsWith("test/adversarial/") || path.includes("adversarial-evidence"));
  if (privateLeak) throw new Error(`private adversarial material leaked into package: ${privateLeak}`);
  const tarball = join(temp, packed[0].filename);
  const bytes = await readFile(tarball);
  if (bytes.includes(SECRET_SENTINEL)) throw new Error("package contains adversarial secret sentinel");
  console.log(JSON.stringify({
    packageFileCount: files.length,
    tarballDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    adversarialCases: report.cases.length,
    unresolvedCriticalHigh: report.summary.unresolvedCriticalHigh,
    sentinelMatches: report.scan.sentinelMatches,
  }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
