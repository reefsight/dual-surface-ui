import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { createNativeProtocolSessionFixtureCorpus } from "../scripts/native-protocol-session-corpus.mjs";
import {
  NATIVE_PROTOCOL_SESSION_FIXTURE_CORPUS_SCHEMA,
  NativeProtocolSessionError,
  NativeProtocolSessionVerifier,
} from "../src/native-protocol/index.js";

describe("native protocol portable session fixture corpus", () => {
  it("is deterministic, schema-valid, and executable", async () => {
    const source = await readFile(resolve("fixtures", "native-protocol", "session-corpus-0.1.json"), "utf8");
    expect(source).toBe(`${JSON.stringify(createNativeProtocolSessionFixtureCorpus(), null, 2)}\n`);
    const corpus = JSON.parse(source) as ReturnType<typeof createNativeProtocolSessionFixtureCorpus>;
    const validate = new Ajv2020({ strict: true }).compile(
      NATIVE_PROTOCOL_SESSION_FIXTURE_CORPUS_SCHEMA,
    );
    expect(validate(corpus), JSON.stringify(validate.errors)).toBe(true);

    let accepted = 0;
    let rejected = 0;
    for (const fixture of corpus.cases) {
      const verifier = new NativeProtocolSessionVerifier();
      let failure: { index: number; error: unknown } | undefined;
      for (const [index, message] of fixture.messages.entries()) {
        try {
          verifier.accept(message);
        } catch (error) {
          failure = { index, error };
          break;
        }
      }
      if (fixture.expected.status === "accepted") {
        expect(failure, fixture.id).toBeUndefined();
        expect(verifier.state, fixture.id).toEqual(fixture.expected.state);
        accepted += 1;
      } else {
        expect(failure?.index, fixture.id).toBe(fixture.expected.failedAt);
        expect(failure?.error, fixture.id).toBeInstanceOf(NativeProtocolSessionError);
        expect((failure?.error as NativeProtocolSessionError).code, fixture.id).toBe(fixture.expected.code);
        expect(verifier.state, fixture.id).toEqual(fixture.expected.state);
        rejected += 1;
      }
    }

    expect({ accepted, rejected, total: corpus.cases.length }).toEqual({ accepted: 7, rejected: 12, total: 19 });
    expect(`sha256:${createHash("sha256").update(source).digest("hex")}`).toBe(
      "sha256:97cae0d18be73d51f2a8404a02f0aa554771da334f8b67be5137b015e2a38753",
    );
  });
});
