import { describe, expect, it } from "vitest";
import { identityExperimentLeaks } from "../scripts/check-p4.3-identity-package.mjs";

describe("P4.3 identity experiment package isolation", () => {
  it("refuses source, build, metadata and arbitrary future artifacts under the experiment", () => {
    const paths = [
      "experiments/windows-uia/managed-reference/README.md",
      "experiments/windows-uia/managed-reference/IdentityHarness/IdentityCatalog.cs",
      "experiments/windows-uia/managed-reference/IdentityHarness/bin/Release/a.dll",
      "experiments/windows-uia/managed-reference/IdentityHarness/obj/project.assets.json",
      "Experiments\\Windows-UIA\\future\\notes.json",
      "nested/experiments/windows-uia/unknown.txt",
    ];
    expect(identityExperimentLeaks(paths)).toEqual(paths);
  });
  it("retains the accepted native source, binary, SDK and evidence exclusion", () => {
    const paths = ["fixtures/native/windows-app/manifest.json", ".tools/sdk/host.json", ".native-evidence/report.json", "elsewhere/a.pdb"];
    expect(identityExperimentLeaks(paths)).toEqual(paths);
  });
  it("does not change public package or native protocol corpus admission", () => {
    expect(identityExperimentLeaks(["dist/index.js", "dist/native-protocol/index.js", "schemas/snapshot.schema.json", "fixtures/native-protocol/corpus-0.1.json", "README.md"])).toEqual([]);
  });
});
