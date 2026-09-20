import { describe, expect, it } from "vitest";

import { containsSecretSentinel } from "../src/internal/secret-detection.js";

describe("shared secret detection", () => {
  it("keeps the shared detector conservative even for digest-shaped text", () => {
    expect(
      containsSecretSentinel(
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaa4111111111111111bbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    ).toBe(true);
  });

  it("still detects standalone and human-formatted Luhn-valid PANs", () => {
    expect(containsSecretSentinel("4111111111111111")).toBe(true);
    expect(containsSecretSentinel("x4111111111111111")).toBe(true);
    expect(containsSecretSentinel("4111111111111111x")).toBe(true);
    expect(containsSecretSentinel("card (4111 1111 1111 1111).")).toBe(true);
    expect(containsSecretSentinel("card (4111-1111-1111-1111).")).toBe(true);
  });
});
