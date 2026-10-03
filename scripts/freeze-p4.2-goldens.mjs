import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtureValidators, readBoundedJson, canonical, sha256 } from "./p4.2-fixture-contracts.mjs";
import { requireCommittedFixture, verifyRepeatedCaptures, verifyGolden } from "./p4.2-golden-contracts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [runArgument, ...extra] = process.argv.slice(2);
if (!runArgument || extra.length) throw new Error("fixture_evidence_directory_required");
const source = requireCommittedFixture(root);
const manifest = await readBoundedJson(join(root, "fixtures/native/windows-app/manifest-0.1.json"), 32768);
const validators = await loadFixtureValidators(root);
const captures = await Promise.all(["first", "repeat"].map(name => readBoundedJson(join(resolve(runArgument), name, "capture.json"), 1048576)));
const results = verifyRepeatedCaptures(captures, manifest, validators);
const fixtureBinary = await readFile(join(root, "fixtures/native/windows-app/Fixture/bin/Release/net10.0-windows/DualSurface.Fixture.dll"));
const hashBytes = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
if (hashBytes(fixtureBinary) !== captures[0].fixtureBinaryDigest) throw new Error("fixture_binary_binding_mismatch");
const golden = { schemaVersion: "0.1", kind: "p4.2-proposed-golden", status: "proposed", evidenceDate: "2026-10-03",
  ...source, captureBinaryDigest: hashBytes(await readFile(join(root, "fixtures/native/windows-app/Capture/bin/Release/net10.0-windows/DualSurface.FixtureCapture.dll"))),
  manifestDigest: results[0].manifestDigest, semanticsDigest: results[0].semanticsDigest,
  captureDigests: captures.map(sha256), captures, normalizedCases: results[0].cases };
const result = verifyGolden(golden, manifest, validators);
const serialized = JSON.stringify(golden, null, 2) + "\n";
if (Buffer.byteLength(serialized) > 3145728) throw new Error("fixture_golden_budget");
await writeFile(join(root, "fixtures/native/windows-app/golden-0.1.json"), serialized, { flag: "wx" });
console.log(canonical(result));
