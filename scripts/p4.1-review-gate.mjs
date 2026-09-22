import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

export const P41_REVIEW = Object.freeze({
  canonicalPath: "docs/reviews/p4.1-independent-review.json",
  schemaPath: "fixtures/phase4-exit/contracts/p4.1-independent-review-0.1.schema.json",
});

export async function loadP41ReviewValidator(root) {
  const schema = JSON.parse(await readFile(resolve(root, P41_REVIEW.schemaPath), "utf8"));
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

export function evaluateP41Review(value, validate) {
  const contractValid = validate(value) === true;
  if (!contractValid) return Object.freeze({ contractValid, gateReady: false });
  const scopesApproved = Object.values(value.scopes).every((status) => status === "approved");
  const unresolvedSevere = value.findings.some(
    (finding) =>
      (finding.severity === "critical" || finding.severity === "high") &&
      finding.status !== "resolved",
  );
  const gateReady =
    value.status === "approved" &&
    value.reviewer.independent === true &&
    scopesApproved &&
    value.unresolvedCriticalHigh === 0 &&
    !unresolvedSevere &&
    value.disposition === "no_unresolved_critical_high";
  return Object.freeze({ contractValid, gateReady });
}
