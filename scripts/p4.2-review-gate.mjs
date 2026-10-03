import { execFileSync } from "node:child_process";
import { lstat, realpath, open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonical, loadFixtureValidators, readBoundedJson, sha256 } from "./p4.2-fixture-contracts.mjs";
import { verifyGolden, verifyGoldenSource } from "./p4.2-golden-contracts.mjs";

export const P42_REVIEW = Object.freeze({
  canonicalPath: "docs/reviews/p4.2-independent-review.json",
  schemaPath: "fixtures/phase4-exit/contracts/p4.2-independent-review-0.1.schema.json",
  goldenPath: "fixtures/native/windows-app/golden-0.1.json",
  reviewedCommit: "0d1ed98d3aaa84bfaa83aed44c12761d8b592bfd",
  evidenceCommit: "6d402f40280216dff34ad6f5d723edbcac9f69f8",
  goldenDigest: "sha256:dab9b781886ad1750765453224b006f78eca6bd7e55674d6fa25d3369b916837",
  recordBudget: 32768,
});

export async function loadP42ReviewValidator(root) {
  const schema = await readBoundedJson(resolve(root, P42_REVIEW.schemaPath), 32768);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

// Only the canonical file or a bounded draft is admissible. Never read arbitrary
// user paths (especially .env), follow reparse points, or echo record contents.
export async function readP42Review(root, requested = P42_REVIEW.canonicalPath) {
  const project = await realpath(root);
  const candidate = resolve(project, requested);
  const name = relative(project, candidate).split(sep).join("/");
  const canonicalPath = name === P42_REVIEW.canonicalPath;
  if (!canonicalPath && !/^\.phase4-preflight\/drafts\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.json$/.test(name))
    throw new Error("invalid_path");
  let parent = project;
  for (const part of name.split("/")) {
    parent = resolve(parent, part);
    const info = await lstat(parent);
    if (info.isSymbolicLink()) throw new Error("invalid_path");
  }
  const resolved = await realpath(candidate);
  const boundary = relative(project, resolved);
  if (isAbsolute(boundary) || boundary === ".." || boundary.startsWith(`..${sep}`) || resolved !== candidate)
    throw new Error("invalid_path");
  const handle = await open(candidate, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > P42_REVIEW.recordBudget) throw new Error("invalid_record");
    // Fixed-size read bounds allocation even if a record grows after fstat.
    const bytes = Buffer.alloc(P42_REVIEW.recordBudget + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > P42_REVIEW.recordBudget) throw new Error("invalid_record");
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
    return { value, canonicalPath };
  } finally { await handle.close(); }
}

export function verifyP42EvidenceBinding(value, golden) {
  if (value.reviewedCommit !== P42_REVIEW.reviewedCommit || value.evidenceCommit !== P42_REVIEW.evidenceCommit ||
      value.goldenDigest !== P42_REVIEW.goldenDigest || sha256(golden) !== P42_REVIEW.goldenDigest ||
      value.reviewedCommit !== golden.sourceCommit || value.manifestDigest !== golden.manifestDigest ||
      value.semanticsDigest !== golden.semanticsDigest || value.sourceBindingDigest !== golden.sourceBinding.digest ||
      value.captureBinaryDigest !== golden.captureBinaryDigest || canonical(value.captureDigests) !== canonical(golden.captureDigests))
    throw new Error("evidence_invalid");
}

export async function verifyP42ReviewEvidence(root, value) {
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  git(["merge-base", "--is-ancestor", P42_REVIEW.reviewedCommit, P42_REVIEW.evidenceCommit]);
  git(["merge-base", "--is-ancestor", P42_REVIEW.evidenceCommit, "HEAD"]);
  const golden = await readBoundedJson(resolve(root, P42_REVIEW.goldenPath), 3145728);
  const frozen = JSON.parse(git(["show", `${P42_REVIEW.evidenceCommit}:${P42_REVIEW.goldenPath}`]));
  verifyP42EvidenceBinding(value, golden);
  if (sha256(frozen) !== P42_REVIEW.goldenDigest) throw new Error("evidence_invalid");
  const manifest = await readBoundedJson(resolve(root, "fixtures/native/windows-app/manifest-0.1.json"), 32768);
  verifyGolden(golden, manifest, await loadFixtureValidators(root));
  await verifyGoldenSource(root, golden);
  const frozenAt = Date.parse(git(["show", "-s", "--format=%cI", P42_REVIEW.evidenceCommit]).trim());
  if (!Number.isFinite(frozenAt)) throw new Error("evidence_invalid");
  return { verified: true, frozenAt };
}

export function evaluateP42Review(value, validate, context) {
  const contractValid = validate(value) === true;
  if (!contractValid) return Object.freeze({ contractValid, evidenceValid: false, gateReady: false });
  const evidenceValid = context.evidence.verified === true;
  const validDate = date => typeof date === "string" && Number.isFinite(Date.parse(date)) &&
    Date.parse(date) >= context.evidence.frozenAt && Date.parse(date) <= context.now;
  const scopeValues = Object.values(value.scopes);
  const scopesApproved = scopeValues.every(scope => scope.status === "approved" &&
    scope.reviewer?.independent === true && validDate(scope.reviewedAt));
  const severe = value.findings.filter(f => ["critical", "high"].includes(f.severity) && f.status !== "resolved");
  const findingsConsistent = new Set(value.findings.map(f => f.id)).size === value.findings.length &&
    value.unresolvedCriticalHigh === severe.length && value.findings.every(f => f.status !== "resolved" || f.resolution !== null);
  const maintainerApproved = value.maintainer.decision === "approved" && value.maintainer.id !== null &&
    validDate(value.maintainer.decidedAt) && scopeValues.every(scope => scope.reviewedAt !== null &&
      Date.parse(value.maintainer.decidedAt) >= Date.parse(scope.reviewedAt));
  const gateReady = context.canonicalPath === true && evidenceValid && value.status === "approved" &&
    scopesApproved && findingsConsistent && severe.length === 0 && value.disposition === "no_unresolved_critical_high" && maintainerApproved;
  // Reviewer identity/independence is a governance assertion, not a signature or
  // proof that a human performed a review. Test approvals must never be promoted.
  return Object.freeze({ contractValid, evidenceValid, gateReady });
}
