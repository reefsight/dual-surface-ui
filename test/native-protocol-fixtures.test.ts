import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  createNativeProtocolFixtureCorpus,
  decodeNativeProtocolFixtureCase,
} from "../scripts/native-protocol-fixture-corpus.mjs";
import {
  NATIVE_PROTOCOL_FIXTURE_CORPUS_SCHEMA,
  parseNativeProtocolFrame,
} from "../src/native-protocol/index.js";

describe("native protocol portable fixture corpus", () => {
  it("is deterministic, schema-valid, complete, and executable", async () => {
    const source = await readFile(
      resolve("fixtures", "native-protocol", "corpus-0.1.json"),
      "utf8",
    );
    expect(source).toBe(
      `${JSON.stringify(createNativeProtocolFixtureCorpus(), null, 2)}\n`,
    );
    const corpus = JSON.parse(source) as ReturnType<
      typeof createNativeProtocolFixtureCorpus
    >;
    const validate = new Ajv2020({ strict: true }).compile(
      NATIVE_PROTOCOL_FIXTURE_CORPUS_SCHEMA,
    );
    expect(validate(corpus), JSON.stringify(validate.errors)).toBe(true);

    let accepted = 0;
    let rejected = 0;
    for (const fixture of corpus.cases) {
      const bytes = decodeNativeProtocolFixtureCase(fixture);
      if (fixture.expected.status === "rejected") {
        expect(() => parseNativeProtocolFrame(bytes), fixture.id).toThrow(
          fixture.expected.error,
        );
        rejected += 1;
        continue;
      }
      const message = parseNativeProtocolFrame(bytes);
      expect(message.kind, fixture.id).toBe(fixture.expected.kind);
      if ("code" in fixture.expected) {
        const code = message.kind === "protocol-error" || message.kind === "request-error"
          ? message.code
          : message.kind === "action-response" && message.outcome.status === "failed"
            ? message.outcome.error.code
            : undefined;
        expect(code, fixture.id).toBe(fixture.expected.code);
      }
      accepted += 1;
    }

    expect({ accepted, rejected, total: corpus.cases.length }).toEqual({
      accepted: 47,
      rejected: 20,
      total: 67,
    });
    expect(`sha256:${createHash("sha256").update(source).digest("hex")}`).toBe(
      "sha256:1e783a3be9098efc776ce8771e1ce9d44bf5c89eff9913e472fc686c5fa7b241",
    );
  });
});
