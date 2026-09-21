import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { evaluatePhase3AuthorityEvidence, loadPhase3AuthorityValidators, PHASE3_AUTHORITY_GATES } from "./phase3-evidence-gates.mjs";

const root = process.cwd();
const [type, candidateArgument] = process.argv.slice(2);
if (!Object.hasOwn(PHASE3_AUTHORITY_GATES, type) || !candidateArgument) {
  console.error(JSON.stringify({ status: "usage_error", types: Object.keys(PHASE3_AUTHORITY_GATES) }));
  process.exit(64);
}
const candidate = isAbsolute(candidateArgument) ? candidateArgument : resolve(root, candidateArgument);
const resolved = await realpath(candidate).catch(() => undefined);
const rel = resolved ? relative(root, resolved).replaceAll("\\", "/") : "";
if (!resolved || rel.startsWith("../") || rel === "" || (await lstat(candidate)).isSymbolicLink()) {
  console.error(JSON.stringify({ type, status: "invalid_path" }));
  process.exit(65);
}
let value;
try { value = JSON.parse(await readFile(resolved, "utf8")); }
catch {
  console.error(JSON.stringify({ type, status: "invalid_json" }));
  process.exit(66);
}
const validators = await loadPhase3AuthorityValidators(root);
const result = evaluatePhase3AuthorityEvidence(type, value, validators);
const status = result.gateReady ? "gate_ready" : result.contractValid ? "gate_not_ready" : "contract_invalid";
console.log(JSON.stringify({ type, status, contractValid: result.contractValid, gateReady: result.gateReady, canonicalPath: PHASE3_AUTHORITY_GATES[type].canonicalPath }));
if (!result.contractValid) process.exitCode = 2;
else if (!result.gateReady) process.exitCode = 3;
