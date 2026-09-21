import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const npmCli = process.env.npm_execpath;

const plan = Object.freeze([
  ["npm", ["run", "phase3:gate"]],
  ["npm", ["ci"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "test:gate"]],
  ["npm", ["run", "test:conformance:aggregate"]],
  ["npm", ["run", "test:browser"]],
  ["npm", ["run", "test:adversarial"]],
  ["npm", ["run", "test:golden"]],
  ["npm", ["run", "test:evaluation-scorer"]],
  ["npm", ["run", "benchmark:p3.9:structural"]],
  ["npm", ["run", "contract:check"]],
  ["npm", ["run", "package:check:delta"]],
  ["npm", ["run", "package:check:trace-replay"]],
  ["npm", ["run", "package:check:playwright"]],
  ["npm", ["run", "package:check:cli"]],
  ["npm", ["run", "package:check:conformance"]],
  ["npm", ["run", "package:check:adversarial"]],
  ["npm", ["run", "package:check:golden"]],
  ["npm", ["audit", "--audit-level=high"]],
  ["npm", ["pack", "--dry-run", "--json"]],
  ["git", ["diff", "--check"]],
]);

if (dryRun) {
  console.log(
    JSON.stringify({
      status: "plan_ready",
      failClosedPrerequisite: "npm run phase3:gate",
      commands: plan.map(([program, args]) => `${program} ${args.join(" ")}`),
    }),
  );
  process.exit(0);
}

if (!npmCli) {
  throw new Error("npm_execpath is required; run through npm run");
}

const initialStatus = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
if (initialStatus.status !== 0 || initialStatus.stdout.trim() !== "") {
  throw new Error("phase3 exit audit requires a clean checkout");
}

for (const [index, [program, args]] of plan.entries()) {
  console.log(`[${index + 1}/${plan.length}] ${program} ${args.join(" ")}`);
  const executable = program === "npm" ? process.execPath : program;
  const executableArgs = program === "npm" ? [npmCli, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(`phase3 exit audit failed at command ${index + 1}`);
  }
}

const finalStatus = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
if (finalStatus.status !== 0 || finalStatus.stdout.trim() !== "") {
  throw new Error("phase3 exit audit produced tracked or untracked drift");
}

console.log(JSON.stringify({ status: "passed", commands: plan.length }));
