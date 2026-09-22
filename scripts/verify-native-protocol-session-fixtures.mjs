import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import { NATIVE_PROTOCOL_SESSION_FIXTURE_CORPUS_SCHEMA } from "../dist/native-protocol/fixture-schema.js";
import { NativeProtocolSessionError, NativeProtocolSessionVerifier } from "../dist/native-protocol/session.js";
import { createNativeProtocolSessionFixtureCorpus } from "./native-protocol-session-corpus.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = resolve(projectRoot, "fixtures", "native-protocol", "session-corpus-0.1.json");
const source = await readFile(corpusPath, "utf8");
const expectedSource = `${JSON.stringify(createNativeProtocolSessionFixtureCorpus(), null, 2)}\n`;
if (source !== expectedSource) throw new Error("Native protocol session fixture corpus drifted");
const corpus = JSON.parse(source);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
  NATIVE_PROTOCOL_SESSION_FIXTURE_CORPUS_SCHEMA,
);
if (!validate(corpus)) throw new Error("Native protocol session fixture corpus schema failed");
const ids = corpus.cases.map((fixture) => fixture.id);
if (new Set(ids).size !== ids.length) throw new Error("Duplicate native session fixture ID");
if (ids.some((id, index) => index > 0 && ids[index - 1] >= id)) {
  throw new Error("Native session fixture IDs are not strictly sorted");
}
if (/(?:password|bearer\s|private[-_ ]?key|api[-_ ]?key|token=)/iu.test(source)) {
  throw new Error("Secret-like material found in native session fixture corpus");
}

let accepted = 0;
let rejected = 0;
const codes = new Set();
for (const fixture of corpus.cases) {
  const verifier = new NativeProtocolSessionVerifier();
  let failure;
  for (const [index, message] of fixture.messages.entries()) {
    try {
      verifier.accept(message);
    } catch (error) {
      failure = { index, error };
      break;
    }
  }
  if (fixture.expected.status === "accepted") {
    if (failure) throw new Error(`${fixture.id} unexpectedly failed`);
    if (JSON.stringify(verifier.state) !== JSON.stringify(fixture.expected.state)) {
      throw new Error(`${fixture.id} returned unexpected state`);
    }
    accepted += 1;
    continue;
  }
  if (
    !failure ||
    !(failure.error instanceof NativeProtocolSessionError) ||
    failure.index !== fixture.expected.failedAt ||
    failure.error.code !== fixture.expected.code
  ) throw new Error(`${fixture.id} returned unexpected failure`);
  if (JSON.stringify(verifier.state) !== JSON.stringify(fixture.expected.state)) {
    throw new Error(`${fixture.id} did not close deterministically`);
  }
  codes.add(failure.error.code);
  rejected += 1;
}

const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
console.log(JSON.stringify({ status: "passed", accepted, rejected, total: corpus.cases.length, codes: [...codes].sort(), digest }));
