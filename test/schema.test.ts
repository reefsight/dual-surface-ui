import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { AGENT_SNAPSHOT_SCHEMA } from "../src/schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadFixtures(kind: "valid" | "invalid") {
  const directory = resolve(projectRoot, "fixtures", "contracts", kind);
  const names = (await readdir(directory)).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      value: JSON.parse(await readFile(resolve(directory, name), "utf8")),
    })),
  );
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(AGENT_SNAPSHOT_SCHEMA);
}

describe("agent snapshot schema 0.1", () => {
  it("accepts every valid conformance fixture", async () => {
    const validate = createValidator();

    for (const fixture of await loadFixtures("valid")) {
      expect(validate(fixture.value), fixture.name).toBe(true);
    }
  });

  it("rejects every invalid conformance fixture", async () => {
    const validate = createValidator();

    for (const fixture of await loadFixtures("invalid")) {
      expect(validate(fixture.value), fixture.name).toBe(false);
    }
  });

  it("keeps the generated schema synchronized with the TypeScript source", async () => {
    const generated = JSON.parse(
      await readFile(
        resolve(projectRoot, "schemas", "agent-snapshot-0.1.schema.json"),
        "utf8",
      ),
    );

    expect(generated).toEqual(AGENT_SNAPSHOT_SCHEMA);
  });
});
