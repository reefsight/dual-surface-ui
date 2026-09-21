import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
const corpus = JSON.parse(await readFile(resolve(root, "fixtures/conformance/sentinels-0.1.json"), "utf8"));
const sentinels = corpus.sentinels.map(({ value }) => Buffer.from(value));
let stdoutBytes = 0;
let stderrBytes = 0;
const stdoutMarker = Buffer.from("conformance aggregate capture started\n");
const stderrMarker = Buffer.from("conformance aggregate stderr capture started\n");
if (sentinels.some((value) => stdoutMarker.includes(value) || stderrMarker.includes(value))) throw new Error("secret_scan_failed");
process.stdout.write(stdoutMarker);
process.stderr.write(stderrMarker);
stdoutBytes += stdoutMarker.byteLength;
stderrBytes += stderrMarker.byteLength;

const run = (script, direction, targetFilter) => {
  const result = spawnSync(process.execPath, [npmCli, "run", script], { cwd: root, encoding: null, env: {
    ...process.env,
    ...(direction ? { CONFORMANCE_DIRECTION: direction } : {}),
    ...(targetFilter ? { CONFORMANCE_TARGET_FILTER: targetFilter, CONFORMANCE_EVIDENCE_ONLY: "1" } : {}),
  }, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  if (sentinels.some((value) => stdout.includes(value) || stderr.includes(value))) throw new Error("secret_scan_failed");
  stdoutBytes += stdout.byteLength;
  stderrBytes += stderr.byteLength;
  if (result.status !== 0) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    throw new Error(`${script} failed with status ${result.status}`);
  }
};

await rm(resolve(root, ".conformance-evidence"), { recursive: true, force: true });
run("package:check:conformance");
for (const [script, target] of [
  ["test:conformance", "dom-jsdom"], ["test:conformance", "webmcp-compat"],
  ["test:conformance:native", undefined], ["test:conformance", "mcp-sdk"],
  ["test:conformance:browser", undefined],
]) run(script, "forward", target);
for (const [script, target] of [
  ["test:conformance:browser", undefined], ["test:conformance", "mcp-sdk"],
  ["test:conformance:native", undefined], ["test:conformance", "webmcp-compat"],
  ["test:conformance", "dom-jsdom"],
]) run(script, "reverse", target);
const aggregate = spawnSync(process.execPath, [npmCli, "exec", "--", "vitest", "run", "test/conformance/aggregate.test.ts", "--pool=vmThreads", "--maxWorkers=1", "--no-file-parallelism"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, CONFORMANCE_STDOUT_BYTES: String(stdoutBytes), CONFORMANCE_STDERR_BYTES: String(stderrBytes) },
  stdio: ["ignore", "pipe", "pipe"],
});
if (aggregate.stdout) process.stdout.write(aggregate.stdout);
if (aggregate.stderr) process.stderr.write(aggregate.stderr);
if (aggregate.error) throw aggregate.error;
if (aggregate.status !== 0) throw new Error(`aggregate validation failed with status ${aggregate.status}`);
