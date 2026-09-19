import { expect, test } from "@playwright/test";

import { createPlaywrightSurface, type PlaywrightElementBinding } from "../../dist/playwright/index.js";

const bindings: readonly PlaywrightElementBinding[] = [
  {
    id: "approve",
    target: { role: "button", name: "Approve" },
    actions: { approve: { operation: { type: "click" }, effects: ["approval-visible"] } },
  },
  {
    id: "name",
    target: { role: "textbox", name: "Name" },
    actions: { fill: { operation: { type: "fill" } } },
  },
  {
    id: "password",
    target: { role: "textbox", name: "Password" },
    actions: { fill: { operation: { type: "fill" } } },
  },
];

test("visual selection receives only masked pixels and cannot execute", async ({ page, context }) => {
  await page.goto("/examples/playwright-semantic/index.html");
  const decoder = await context.newPage();
  const password = await page.getByRole("textbox", { name: "Password" }).boundingBox();
  const frame = await page.locator("iframe").boundingBox();
  const note = await page.getByRole("note").boundingBox();
  const button = await page.getByRole("button", { name: "Approve" }).boundingBox();
  expect(password && frame && note && button).toBeTruthy();
  const origin = new URL(page.url()).origin;
  let retained: Uint8Array | undefined;
  let copied: Uint8Array | undefined;
  let candidateIds: string[] = [];
  let candidateMarkers: string[] = [];
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-visual-e2e",
    allowedOrigins: [origin],
    bindings,
    visual: {
      sensitiveMasks: [{ role: "note", name: "Private account note" }],
      selectCandidate: (request) => {
        retained = request.image;
        copied = Uint8Array.from(request.image);
        candidateIds = request.candidates.map((candidate) => candidate.id);
        candidateMarkers = request.candidates.map((candidate) => candidate.marker);
        return "approve";
      },
    },
  });

  const selection = await surface.selectVisualCandidate?.();
  expect(candidateIds).toEqual(["approve", "name"]);
  expect(selection).toBe("approve");
  const points = [password!, frame!, note!].map((box) => ({
    x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2),
  })).concat({ x: Math.floor(button!.x + 5), y: Math.floor(button!.y + 5) });
  const rendered = await decoder.evaluate(async ({ source, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const draw = canvas.getContext("2d")!;
    draw.drawImage(image, 0, 0);
    const data = draw.getImageData(0, 0, image.width, image.height).data;
    const colors = new Set<string>();
    for (let offset = 0; offset < data.length; offset += 4) {
      colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`);
    }
    return {
      colors: [...colors],
      sampled: points.map(({ x, y }) => [...draw.getImageData(x, y, 1, 1).data]),
    };
  }, { source: Buffer.from(copied!).toString("base64"), points });
  const allowedColors = new Set(["0,0,0,255", ...candidateMarkers.map((marker) => {
    const value = Number.parseInt(marker.slice(1), 16);
    return `${value >> 16},${(value >> 8) & 255},${value & 255},255`;
  })]);
  expect(rendered.colors.every((color) => allowedColors.has(color))).toBe(true);
  expect(rendered.sampled[3]?.slice(0, 3)).not.toEqual([0, 0, 0]);
  expect(retained && [...retained].every((byte) => byte === 0)).toBe(true);
  await expect(page.getByRole("status")).toHaveText("pending");
  surface.dispose();
  await decoder.close();
});

test("visual callback mutation invalidates the selected ID", async ({ page }) => {
  await page.goto("/examples/playwright-semantic/index.html");
  const origin = new URL(page.url()).origin;
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-visual-stale",
    allowedOrigins: [origin],
    bindings,
    visual: {
      sensitiveMasks: [],
      selectCandidate: async () => {
        await page.getByRole("button", { name: "Approve" }).evaluate((button) => {
          button.setAttribute("data-mutated", "true");
        });
        return "approve";
      },
    },
  });
  await expect(surface.selectVisualCandidate?.()).resolves.toBeUndefined();
  surface.dispose();
});

test("visual discovery is disabled while page geometry is animated", async ({ page }) => {
  await page.goto("/examples/playwright-semantic/index.html");
  await page.getByRole("note").evaluate((note) => {
    note.animate([{ transform: "translateX(0)" }, { transform: "translateX(200px)" }], {
      duration: 10_000,
      iterations: Infinity,
    });
  });
  const callback = async () => "approve";
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-visual-animation",
    allowedOrigins: [new URL(page.url()).origin],
    bindings,
    visual: { sensitiveMasks: [{ role: "note", name: "Private account note" }], selectCandidate: callback },
  });
  await expect(surface.selectVisualCandidate?.()).resolves.toBeUndefined();
  surface.dispose();
});
