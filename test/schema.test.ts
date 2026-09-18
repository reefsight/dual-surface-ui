import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  AGENT_ACTION_REQUEST_SCHEMA,
  AGENT_ACTION_RESULT_SCHEMA,
  AGENT_SNAPSHOT_SCHEMA,
} from "../src/schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadFixtures(contract: string, kind: "valid" | "invalid") {
  const directory = resolve(projectRoot, "fixtures", contract, kind);
  const names = (await readdir(directory)).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      value: JSON.parse(await readFile(resolve(directory, name), "utf8")),
    })),
  );
}

function createValidator(schema: object) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function verifyContract(
  title: string,
  fixtureDirectory: string,
  generatedFile: string,
  schema: object,
) {
  describe(title, () => {
    it("accepts every valid conformance fixture", async () => {
      const validate = createValidator(schema);

      for (const fixture of await loadFixtures(fixtureDirectory, "valid")) {
        expect(validate(fixture.value), fixture.name).toBe(true);
      }
    });

    it("rejects every invalid conformance fixture", async () => {
      const validate = createValidator(schema);

      for (const fixture of await loadFixtures(fixtureDirectory, "invalid")) {
        expect(validate(fixture.value), fixture.name).toBe(false);
      }
    });

    it("keeps the generated schema synchronized with the TypeScript source", async () => {
      const generated = JSON.parse(
        await readFile(resolve(projectRoot, "schemas", generatedFile), "utf8"),
      );

      expect(generated).toEqual(schema);
    });
  });
}

verifyContract(
  "agent snapshot schema 0.1",
  "contracts",
  "agent-snapshot-0.1.schema.json",
  AGENT_SNAPSHOT_SCHEMA,
);
verifyContract(
  "agent action request schema 0.1",
  "action-requests",
  "agent-action-request-0.1.schema.json",
  AGENT_ACTION_REQUEST_SCHEMA,
);
verifyContract(
  "agent action result schema 0.1",
  "action-results",
  "agent-action-result-0.1.schema.json",
  AGENT_ACTION_RESULT_SCHEMA,
);
