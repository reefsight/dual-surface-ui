import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeCommand = process.execPath;
const npmCli = process.env.npm_execpath;
const temporaryRoot = await mkdtemp(join(tmpdir(), "dual-surface-playwright-package-"));

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function runNpm(args, cwd) {
  if (!npmCli) {
    throw new Error("npm_execpath is required; run this check through npm run");
  }
  return run(nodeCommand, [npmCli, ...args], cwd);
}

async function initializeConsumer(path) {
  await writeFile(
    join(path, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
}

try {
  const packed = JSON.parse(
    runNpm(["pack", "--pack-destination", temporaryRoot, "--json"], projectRoot),
  );
  const tarball = join(temporaryRoot, packed[0].filename);
  const rootConsumer = join(temporaryRoot, "root-consumer");
  const playwrightConsumer = join(temporaryRoot, "playwright-consumer");
  await Promise.all([mkdir(rootConsumer), mkdir(playwrightConsumer)]);

  await initializeConsumer(rootConsumer);
  runNpm(["install", "--ignore-scripts", "--omit=optional", tarball], rootConsumer);
  let peerPresent = true;
  try { await access(join(rootConsumer, "node_modules/playwright-core")); }
  catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") peerPresent = false;
    else throw error;
  }
  if (peerPresent) {
    throw new Error("Root consumer unexpectedly installed the optional Playwright peer");
  }
  run(
    nodeCommand,
    ["--input-type=module", "-e", "import('dual-surface-ui').then(m=>{if(!m.createAgentSurface)process.exit(2)})"],
    rootConsumer,
  );

  const installedPlaywright = JSON.parse(
    await readFile(resolve(projectRoot, "node_modules/playwright-core/package.json"), "utf8"),
  ).version;
  await initializeConsumer(playwrightConsumer);
  runNpm(
    ["install", "--ignore-scripts", tarball, `playwright-core@${installedPlaywright}`],
    playwrightConsumer,
  );
  run(
    nodeCommand,
    [
      "--input-type=module",
      "-e",
      "Promise.all([import('dual-surface-ui'),import('dual-surface-ui/playwright')]).then(([root,pw])=>{if(!root.createAgentSurface||!pw.createPlaywrightSurface)process.exit(2)})",
    ],
    playwrightConsumer,
  );

  console.log(
    `Packed consumers passed: root without optional peer; Playwright subpath with playwright-core ${installedPlaywright}.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
