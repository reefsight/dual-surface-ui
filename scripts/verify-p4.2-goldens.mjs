import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtureValidators, readBoundedJson, canonical } from "./p4.2-fixture-contracts.mjs";
import { verifyGolden, verifyGoldenSource } from "./p4.2-golden-contracts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.length !== 2) throw new Error("fixture_golden_verifier_has_no_arguments");
const validators = await loadFixtureValidators(root);
const manifest = await readBoundedJson(join(root, "fixtures/native/windows-app/manifest-0.1.json"), 32768);
const golden = await readBoundedJson(join(root, "fixtures/native/windows-app/golden-0.1.json"), 3145728);
const result = verifyGolden(golden, manifest, validators);
await verifyGoldenSource(root, golden);
console.log(canonical(result));
