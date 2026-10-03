import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFixtureLeaks } from "./check-native-fixture-package.mjs";

export function identityExperimentLeaks(paths) {
  const nativeLeaks = new Set(nativeFixtureLeaks(paths));
  return paths.filter(path => nativeLeaks.has(path) ||
    /(?:^|\/)experiments\/windows-uia(?:\/|$)/i.test(path.replaceAll("\\", "/")));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.npm_execpath) throw new Error("Run through npm run package:check:p4.3-identity");
  const packed = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, "pack", "--dry-run", "--json"],
    { encoding: "utf8", maxBuffer: 1048576, timeout: 120000 }));
  const paths = packed[0].files.map(file => file.path);
  if (identityExperimentLeaks(paths).length) throw new Error("p4.3_identity_package_leak");
  console.log(JSON.stringify({ kind: "p4.3-identity-package-check", entries: paths.length, leaks: 0 }));
}
