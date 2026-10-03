import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function nativeFixtureLeaks(paths) {
  return paths.filter(path => /(^|\/)(?:\.tools|\.native-evidence|bin|obj)(?:\/|$)|^fixtures\/native\/|\.(?:cs|csproj|dll|exe|pdb|zip)$/i.test(path.replaceAll("\\", "/")));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.npm_execpath) throw new Error("Run through npm run package:check:native-fixture");
  const packed = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, "pack", "--dry-run", "--json"], { encoding: "utf8" }));
  const leaks = nativeFixtureLeaks(packed[0].files.map(file => file.path));
  if (leaks.length) throw new Error("native_fixture_package_leak: " + leaks.join(","));
  console.log("Native fixture source, binaries, SDK, and run evidence excluded from npm package.");
}
