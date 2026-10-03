import { fileURLToPath } from "node:url";
import { evaluateP42Review, loadP42ReviewValidator, readP42Review, verifyP42ReviewEvidence } from "./p4.2-review-gate.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const contractOnly = args.includes("--contract-only");
const paths = args.filter(arg => arg !== "--contract-only");
const output = (status, result, code) => {
  console.log(JSON.stringify({ status, ...result }));
  process.exitCode = code;
};
const failed = { contractValid: false, evidenceValid: false, gateReady: false };
if (paths.length > 1 || paths.some(path => path.startsWith("--")) || args.filter(arg => arg === "--contract-only").length > 1) {
  output("invalid_arguments", failed, 64);
} else {
  let record;
  try { record = await readP42Review(root, paths[0]); }
  catch (error) { output(error.message === "invalid_path" ? "invalid_path" : "invalid_record", failed, 65); }
  if (record) {
    let validate;
    try { validate = await loadP42ReviewValidator(root); }
    catch { output("contract_unavailable", failed, 66); }
    if (validate && !validate(record.value)) output("contract_invalid", failed, 2);
    else if (validate) {
      let evidence;
      try { evidence = await verifyP42ReviewEvidence(root, record.value); }
      catch { output("evidence_invalid", { ...failed, contractValid: true }, 4); }
      if (evidence) {
        const result = evaluateP42Review(record.value, validate, { evidence, canonicalPath: record.canonicalPath, now: Date.now() });
        // Contract-only is a preflight, never an approval, even for a ready record.
        if (contractOnly) output("review_contract_verified", { ...result, gateReady: false }, 0);
        else output(result.gateReady ? "gate_ready" : "gate_not_ready", result, result.gateReady ? 0 : 3);
      }
    }
  }
}
