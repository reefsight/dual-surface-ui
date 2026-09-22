import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  evaluateP41Review,
  loadP41ReviewValidator,
  P41_REVIEW,
} from "./p4.1-review-gate.mjs";

const root = process.cwd();
const [candidateArgument = P41_REVIEW.canonicalPath] = process.argv.slice(2);
const candidate = isAbsolute(candidateArgument) ? candidateArgument : resolve(root, candidateArgument);
const resolved = await realpath(candidate).catch(() => undefined);
const rel = resolved ? relative(root, resolved).replaceAll("\\", "/") : "";
if (!resolved || rel.startsWith("../") || rel === "" || (await lstat(candidate)).isSymbolicLink()) {
  console.error(JSON.stringify({ status: "invalid_path", canonicalPath: P41_REVIEW.canonicalPath }));
  process.exit(65);
}
let value;
try {
  value = JSON.parse(await readFile(resolved, "utf8"));
} catch {
  console.error(JSON.stringify({ status: "invalid_json", canonicalPath: P41_REVIEW.canonicalPath }));
  process.exit(66);
}
const validate = await loadP41ReviewValidator(root);
const result = evaluateP41Review(value, validate);
const status = result.gateReady
  ? "gate_ready"
  : result.contractValid
    ? "gate_not_ready"
    : "contract_invalid";
console.log(JSON.stringify({ status, ...result, canonicalPath: P41_REVIEW.canonicalPath }));
if (!result.contractValid) process.exitCode = 2;
else if (!result.gateReady) process.exitCode = 3;
