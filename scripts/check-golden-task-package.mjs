import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
const temp = await mkdtemp(join(tmpdir(), "dual-surface-golden-package-"));
try {
  const result = spawnSync(process.execPath, [npmCli, "pack", "--pack-destination", temp, "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(result.stderr);
  const manifest = JSON.parse(result.stdout);
  const files = manifest[0].files.map(({ path }) => path);
  const leaked = files.find((path) => path.startsWith("fixtures/evaluation/") || path.startsWith("test/golden-task-suite"));
  if (leaked) throw new Error(`private golden-task material leaked into package: ${leaked}`);
  console.log(JSON.stringify({ packageFileCount: files.length, goldenTaskFixtureLeaked: false }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
