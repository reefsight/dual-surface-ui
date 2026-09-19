import { expect, test } from "@playwright/test";

import { childFrame, waitForFrame } from "./helpers";

test("same-origin child owns a separate surface and catalog", async ({ page }) => {
  await page.goto("/examples/browser-evidence/frames.html?mode=imperative");
  const child = await childFrame(
    page,
    `${page.url().split("/examples/")[0]}/examples/browser-evidence/frame.html`,
  );
  await waitForFrame(child);

  const parentSnapshot = await page.evaluate(() => globalThis.browserEvidence.parentSnapshot());
  const childSnapshot = await child.evaluate(() => globalThis.browserEvidence.snapshot());
  const childCatalog = await child.evaluate(() => globalThis.browserEvidence.catalog());
  expect(JSON.stringify(parentSnapshot)).not.toContain("child-only-control");
  expect(JSON.stringify(childSnapshot)).toContain("child-only-control");
  expect(childCatalog.map((tool) => tool.name)).toEqual(["frame.inspect_child"]);
});

test("cross-origin child registration remains isolated and never requests exposedTo", async ({ page }) => {
  const crossOriginPort = Number(process.env.BROWSER_FIXTURE_PORT ?? "43991") + 1;
  await page.goto(
    `/examples/browser-evidence/frames.html?mode=imperative&childOrigin=${encodeURIComponent(`http://127.0.0.1:${crossOriginPort}`)}`,
  );
  const child = await childFrame(page, `http://127.0.0.1:${crossOriginPort}`);
  await waitForFrame(child);
  const catalog = await child.evaluate(() => globalThis.browserEvidence.catalog());
  expect(catalog).toHaveLength(1);
  expect(catalog[0].optionsKeys).toEqual(["signal"]);
  expect(catalog[0]).not.toHaveProperty("exposedTo");
});

test("declarative form in a frame fails before mutation and human submit still works", async ({ page }) => {
  await page.goto("/examples/browser-evidence/frames.html?mode=declarative");
  const child = await childFrame(
    page,
    `${page.url().split("/examples/")[0]}/examples/browser-evidence/frame.html`,
  );
  await waitForFrame(child);
  const result = await child.evaluate(() => globalThis.browserEvidence.result());
  expect(result.error).toContain("forms in frames are unsupported");
  expect(result.after).toBe(result.before);
  expect(result.after).not.toContain("toolname=");
  const human = await child.evaluate(() => globalThis.browserEvidence.clickHumanSubmit());
  expect(human).toEqual({ status: "Child form submitted", submitCount: 1 });
});
