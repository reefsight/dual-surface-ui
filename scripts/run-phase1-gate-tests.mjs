import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = resolve(projectRoot, "test");
const vitestEntry = resolve(projectRoot, "node_modules", "vitest", "vitest.mjs");
const testFiles = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

let passedTests = 0;
for (const [index, name] of testFiles.entries()) {
  const relativePath = `test/${name}`;
  console.log(`[${index + 1}/${testFiles.length}] ${relativePath}`);
  const run = spawnSync(
    process.execPath,
    [vitestEntry, "run", relativePath, "--pool=forks", "--no-file-parallelism"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);

  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const testCount = output.match(/Tests\s+(\d+) passed/);
  const validSummary = /Test Files\s+1 passed \(1\)/.test(output);
  if (
    run.status !== 0 ||
    run.signal !== null ||
    /Unhandled Errors?/i.test(output) ||
    !validSummary ||
    !testCount
  ) {
    console.error(`Phase 1 gate failed for ${relativePath}.`);
    process.exit(1);
  }
  passedTests += Number(testCount[1]);
}

console.log(
  `Phase 1 gate passed: ${testFiles.length} files, ${passedTests} tests.`,
);
