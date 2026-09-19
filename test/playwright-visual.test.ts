import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import { createVisualCandidateSelection } from "../src/playwright/visual.js";

describe("Playwright masked visual capture", () => {
  it("passes only a bounded PNG and frozen candidates, then zeroes the image", async () => {
    let retained: Uint8Array | undefined;
    const screenshot = vi.fn();
    const page = { viewportSize: () => ({ width: 800, height: 600 }), screenshot } as unknown as Page;
    const selected = await createVisualCandidateSelection({
      page,
      candidateBoxes: [{ x: 0, y: 0, width: 10, height: 10 }],
      candidates: [{ id: "save", role: "button", name: "Save", marker: "#33dd55" }],
      selectCandidate: (request) => {
        retained = request.image;
        expect(request.mimeType).toBe("image/png");
        expect(Object.isFrozen(request.candidates)).toBe(true);
        expect(Object.isFrozen(request.candidates[0])).toBe(true);
        return "save";
      },
      validateBeforeCallback: async () => true,
    });
    expect(selected).toBe("save");
    expect(screenshot).not.toHaveBeenCalled();
    expect(retained && [...retained].every((byte) => byte === 0)).toBe(true);
  });

  it("rejects unknown IDs and never calls back for an oversized viewport", async () => {
    const callback = vi.fn(() => "selector=.save");
    const screenshot = vi.fn();
    const page = { viewportSize: () => ({ width: 800, height: 600 }), screenshot } as unknown as Page;
    await expect(createVisualCandidateSelection({
      page, candidateBoxes: [{ x: 0, y: 0, width: 10, height: 10 }], candidates: [{ id: "save", role: "button", name: "Save", marker: "#33dd55" }],
      selectCandidate: callback, validateBeforeCallback: async () => true,
    })).resolves.toBeUndefined();

    const huge = { viewportSize: () => ({ width: 4000, height: 3000 }), screenshot } as unknown as Page;
    callback.mockClear();
    screenshot.mockClear();
    await expect(createVisualCandidateSelection({
      page: huge, candidateBoxes: [{ x: 0, y: 0, width: 10, height: 10 }], candidates: [{ id: "save", role: "button", name: "Save", marker: "#33dd55" }],
      selectCandidate: callback, validateBeforeCallback: async () => true,
    })).resolves.toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
  });

  it("discards captured pixels when the generation changed before callback", async () => {
    const callback = vi.fn(() => "save");
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }),
    } as unknown as Page;
    await expect(createVisualCandidateSelection({
      page, candidateBoxes: [{ x: 0, y: 0, width: 10, height: 10 }], candidates: [{ id: "save", role: "button", name: "Save", marker: "#33dd55" }],
      selectCandidate: callback, validateBeforeCallback: async () => false,
    })).resolves.toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
  });
});
