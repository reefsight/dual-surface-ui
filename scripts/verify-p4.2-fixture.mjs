import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtureValidators, readBoundedJson, canonical, sha256 } from "./p4.2-fixture-contracts.mjs";
import { verifyRepeatedCaptures } from "./p4.2-golden-contracts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [runArgument] = process.argv.slice(2);
if (!runArgument) throw new Error("fixture_evidence_directory_required");
const run = resolve(runArgument);
const validators = await loadFixtureValidators(root);
const manifest = await readBoundedJson(join(root, "fixtures/native/windows-app/manifest-0.1.json"), 32768);
const inputs = await Promise.all(["first", "repeat"].map(name => readBoundedJson(join(run, name, "capture.json"), 1048576)));
const results = verifyRepeatedCaptures(inputs, manifest, validators);
console.log(canonical({ status: "verified", cases: results[0].cases.length, manifestDigest: results[0].manifestDigest,
  semanticsDigest: results[0].semanticsDigest, captureDigests: inputs.map(sha256) }));
