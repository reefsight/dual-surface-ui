import { describe, expect, it } from "vitest";

import type { AgentSnapshot } from "../src/types.js";
import {
  AgentCliArtifactError,
  captureAndValidateCliArtifact,
  digestCliArtifact,
  inspectCliArtifact,
} from "../src/cli/artifacts.js";

const snapshot = (): AgentSnapshot => ({
  schemaVersion: "0.1",
  surfaceId: "checkout",
  revision: "revision-1",
  title: "Checkout",
  url: "https://example.test/checkout",
  generatedAt: "2026-09-20T00:00:00.000Z",
  capabilities: ["semantic-actions"],
  nodes: [{
    id: "submit",
    role: "button",
    name: "Submit",
    state: {},
    actions: [{ name: "activate", risk: "write" }],
  }],
});

describe("CLI artifact registry", () => {
  it("recognizes, validates, and summarizes a snapshot without content fields", async () => {
    await expect(inspectCliArtifact(snapshot())).resolves.toEqual({
      artifactType: "snapshot",
      schemaVersion: "0.1",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      counts: { nodes: 1, actions: 1, capabilities: 1 },
    });
    expect(JSON.stringify(await inspectCliArtifact(snapshot()))).not.toContain("Checkout");
  });

  it("uses a deterministic domain-separated full-artifact digest", async () => {
    const first = await captureAndValidateCliArtifact(snapshot());
    const second = await captureAndValidateCliArtifact(structuredClone(snapshot()));
    await expect(digestCliArtifact(first.artifact)).resolves.toBe(
      await digestCliArtifact(second.artifact),
    );
  });

  it("rejects explicit type confusion", async () => {
    await expect(captureAndValidateCliArtifact(snapshot(), "trace")).rejects
      .toMatchObject<Partial<AgentCliArtifactError>>({
        reason: "invalid_artifact",
        artifactType: "snapshot",
      });
  });

  it("rejects secret-bearing artifacts before metadata output", async () => {
    const unsafe = snapshot();
    unsafe.title = "password=hunter-7319";
    await expect(inspectCliArtifact(unsafe)).rejects.toMatchObject({
      reason: "secret_detected",
    });

    const disguisedPan = snapshot();
    disguisedPan.title = `sha256:4111111111111111${"a".repeat(48)}`;
    await expect(inspectCliArtifact(disguisedPan)).rejects.toMatchObject({
      reason: "secret_detected",
    });
  });

  it("rejects unknown kind without best-effort fallback", async () => {
    await expect(captureAndValidateCliArtifact({
      schemaVersion: "0.1",
      kind: "unknown-artifact",
    })).rejects.toMatchObject({ reason: "invalid_artifact" });
  });
});
