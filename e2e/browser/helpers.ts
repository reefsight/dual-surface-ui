import { expect, type Frame, type Page } from "@playwright/test";

export async function openScenario(page: Page, scenario: string): Promise<void> {
  await page.goto(`/examples/browser-evidence/index.html?scenario=${scenario}`);
  await expect(page.locator("html")).toHaveAttribute("data-browser-evidence", "ready");
}

export async function waitForFrame(frame: Frame): Promise<void> {
  await frame.waitForFunction(() =>
    document.documentElement.dataset.browserEvidence === "ready",
  );
}

export async function childFrame(page: Page, urlPrefix: string): Promise<Frame> {
  await expect.poll(
    () => page.frames().some((frame) => frame.url().startsWith(urlPrefix)),
    { timeout: 15_000 },
  ).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().startsWith(urlPrefix));
  if (!frame) throw new Error(`child frame did not navigate to ${urlPrefix}`);
  return frame;
}

export async function browserError(page: Page): Promise<unknown> {
  return page.evaluate(() => globalThis.browserEvidenceError);
}

declare global {
  var browserEvidence: Record<string, (...args: unknown[]) => unknown>;
  var browserEvidenceError: unknown;
}
