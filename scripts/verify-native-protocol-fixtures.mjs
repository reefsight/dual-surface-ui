import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import { NATIVE_PROTOCOL_FIXTURE_CORPUS_SCHEMA } from "../dist/native-protocol/fixture-schema.js";
import { parseNativeProtocolFrame } from "../dist/native-protocol/frame.js";
import {
  createNativeProtocolFixtureCorpus,
  decodeNativeProtocolFixtureCase,
} from "./native-protocol-fixture-corpus.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = resolve(projectRoot, "fixtures", "native-protocol", "corpus-0.1.json");
const source = await readFile(corpusPath, "utf8");
const corpus = JSON.parse(source);
const expectedSource = `${JSON.stringify(createNativeProtocolFixtureCorpus(), null, 2)}\n`;
if (source !== expectedSource) throw new Error("Native protocol fixture corpus drifted");

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
  NATIVE_PROTOCOL_FIXTURE_CORPUS_SCHEMA,
);
if (!validate(corpus)) throw new Error("Native protocol fixture corpus schema failed");
const ids = corpus.cases.map((fixture) => fixture.id);
if (new Set(ids).size !== ids.length) throw new Error("Duplicate native fixture ID");
if (ids.some((id, index) => index > 0 && ids[index - 1] >= id)) {
  throw new Error("Native fixture IDs are not strictly sorted");
}
if (/(?:password|bearer\s|private[-_ ]?key|api[-_ ]?key|token=)/iu.test(source)) {
  throw new Error("Secret-like material found in native fixture corpus");
}

const kinds = new Set();
const handshakeCodes = new Set();
const requestCodes = new Set();
const actionCodes = new Set();
let accepted = 0;
let rejected = 0;
for (const fixture of corpus.cases) {
  const bytes = decodeNativeProtocolFixtureCase(fixture);
  if (fixture.expected.status === "rejected") {
    try {
      parseNativeProtocolFrame(bytes);
      throw new Error(`${fixture.id} unexpectedly passed`);
    } catch (error) {
      if (!(error instanceof TypeError) || error.message !== fixture.expected.error) throw error;
    }
    rejected += 1;
    continue;
  }
  const message = parseNativeProtocolFrame(bytes);
  if (message.kind !== fixture.expected.kind) {
    throw new Error(`${fixture.id} returned unexpected kind`);
  }
  kinds.add(message.kind);
  if (fixture.expected.code) {
    const code = message.kind === "protocol-error" || message.kind === "request-error"
      ? message.code
      : message.kind === "action-response" && message.outcome.status === "failed"
        ? message.outcome.error.code
        : undefined;
    if (code !== fixture.expected.code) throw new Error(`${fixture.id} returned unexpected code`);
    if (message.kind === "protocol-error") handshakeCodes.add(code);
    if (message.kind === "request-error") requestCodes.add(code);
    if (message.kind === "action-response") actionCodes.add(code);
  }
  accepted += 1;
}

const exactSet = (actual, expected, label) => {
  if (actual.size !== expected.length || expected.some((value) => !actual.has(value))) {
    throw new Error(`Native fixture ${label} coverage is incomplete`);
  }
};
exactSet(kinds, [
  "action-request", "action-response", "cancel-request", "cancel-response",
  "client-hello", "delta-request", "delta-response", "event",
  "protocol-error", "request-error", "server-hello", "snapshot-request",
  "snapshot-response", "surface-list-request", "surface-list-response",
], "message-kind");
exactSet(handshakeCodes, ["invalid_message", "missing_required_capability", "no_compatible_version"], "handshake-error");
exactSet(requestCodes, Object.keys({
  capability_not_negotiated: 0, internal_error: 0, invalid_message: 0,
  invalid_session: 0, permission_denied: 0, request_cancelled: 0,
  request_conflict: 0, resource_limit: 0, resync_required: 0,
  stale_revision: 0, surface_unavailable: 0,
}), "request-error");
exactSet(actionCodes, Object.keys({
  action_not_found: 0, authorization_required: 0, confirmation_required: 0,
  duplicate_element_id: 0, element_not_found: 0, idempotency_conflict: 0,
  idempotency_key_required: 0, idempotency_unavailable: 0, internal_error: 0,
  invalid_idempotency_key: 0, invalid_input: 0, invalid_output: 0,
  invalid_policy_decision: 0, precondition_failed: 0, stale_revision: 0,
  surface_mismatch: 0, verification_failed: 0,
}), "action-failure");

const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
console.log(JSON.stringify({ status: "passed", accepted, rejected, total: corpus.cases.length, digest }));
