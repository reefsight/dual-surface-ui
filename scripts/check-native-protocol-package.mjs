import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeCommand = process.execPath;
const npmCli = process.env.npm_execpath;
const temporaryRoot = await mkdtemp(join(tmpdir(), "dual-surface-native-protocol-package-"));

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function runNpm(args, cwd) {
  if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
  return run(nodeCommand, [npmCli, ...args], cwd);
}

try {
  const packed = JSON.parse(
    runNpm(["pack", "--pack-destination", temporaryRoot, "--json"], projectRoot),
  );
  const entry = packed[0];
  const paths = entry.files.map((file) => file.path.replaceAll("\\", "/"));
  const prohibited = paths.filter((path) =>
    /(^|\/)(target|experiments)(\/|$)|\.(?:dll|dylib|exe|node|pdb|so|wasm)$/i.test(path) ||
    /(^|\/)Cargo\.(?:lock|toml)$/i.test(path)
  );
  if (prohibited.length) {
    throw new Error(`native implementation artifact leaked into npm package: ${prohibited.join(",")}`);
  }

  const tarball = join(temporaryRoot, entry.filename);
  const consumer = join(temporaryRoot, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  runNpm(["install", "--ignore-scripts", "--omit=optional", tarball], consumer);

  const packageRoot = join(consumer, "node_modules", "dual-surface-ui");
  const schemaNames = [
    "native-protocol-client-hello-0.1.schema.json",
    "native-protocol-handshake-0.1.schema.json",
  ];
  for (const schemaName of schemaNames) {
    await access(join(packageRoot, "schemas", "native", schemaName));
  }

  const runtimeCheck = `
    import * as root from "dual-surface-ui";
    import { negotiateNativeProtocol } from "dual-surface-ui/native-protocol";
    if (Object.keys(root).length !== 32) throw new Error("frozen root export count changed");
    const result = negotiateNativeProtocol({schemaVersion:"0.1",kind:"client-hello",requestId:"r1",supportedVersions:["0.1"],capabilities:["snapshots","surface-catalog"],requiredCapabilities:["surface-catalog"]},{sessionRef:"s1",capabilities:["surface-catalog","snapshots"]});
    if (result.status !== "accepted" || result.message.sessionRef !== "s1") throw new Error("native protocol negotiation failed");
  `;
  run(nodeCommand, ["--input-type=module", "-e", runtimeCheck], consumer);

  await writeFile(
    join(consumer, "index.ts"),
    `import { negotiateNativeProtocol, type NativeProtocolClientHello } from "dual-surface-ui/native-protocol";\n` +
      `const hello: NativeProtocolClientHello = {schemaVersion:"0.1",kind:"client-hello",requestId:"r1",supportedVersions:["0.1"],capabilities:[],requiredCapabilities:[]};\n` +
      `void negotiateNativeProtocol; void hello;\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, files: ["index.ts"] }, null, 2)}\n`,
  );
  const tsc = resolve(projectRoot, "node_modules", "typescript", "bin", "tsc");
  run(nodeCommand, [tsc, "-p", "tsconfig.json"], consumer);

  const ajv = new Ajv2020({ strict: true });
  for (const schemaName of schemaNames) {
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, "schemas", "native", schemaName), "utf8"),
      readFile(join(packageRoot, "schemas", "native", schemaName), "utf8"),
    ]);
    if (installed !== source) throw new Error(`${schemaName} drifted in package`);
    ajv.compile(JSON.parse(installed));
  }

  console.log("Packed native-protocol consumer passed runtime, declarations, schemas, frozen-root, and no-native-artifact checks.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
