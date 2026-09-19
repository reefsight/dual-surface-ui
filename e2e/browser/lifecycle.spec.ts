import { expect, test } from "@playwright/test";

import { openScenario } from "./helpers";

test("unsupported imperative API is a DOM-preserving no-op", async ({ page }) => {
  await openScenario(page, "fallback");
  const result = await page.evaluate(() => globalThis.browserEvidence.result());
  expect(result).toEqual({
    after: result.before,
    before: result.before,
    supported: false,
    toolNames: [],
  });
});

test("a partial registration failure rolls back the active catalog", async ({ page }) => {
  await openScenario(page, "rollback");
  const result = await page.evaluate(() => globalThis.browserEvidence.result());
  expect(result.error).toBe("injected registration failure");
  expect(result.catalog).toEqual([]);
});

test("stale invocation cannot mutate state and refresh binds the current revision", async ({ page }) => {
  await openScenario(page, "checkout");
  const result = await page.evaluate(() => globalThis.browserEvidence.staleThenRefresh());
  expect(result.stale.status).toBe("failed");
  expect(result.stale.error.code).toBe("stale_revision");
  expect(result.executionsAfterStale).toBe(0);
  expect(result.current.status).toBe("succeeded");
  expect(result.finalExecutions).toBe(1);
  expect(result.state.order.orderId).toBe("ORDER-1001");
});

test("dispose, remount, and final dispose leave no duplicate tools", async ({ page }) => {
  await openScenario(page, "checkout");
  const before = await page.evaluate(() => globalThis.browserEvidence.catalog());
  const lifecycle = await page.evaluate(() => globalThis.browserEvidence.disposeAndRemount());
  expect(before.map((tool) => tool.name)).toEqual(["checkout.place_order"]);
  expect(lifecycle.afterDispose).toEqual([]);
  expect(lifecycle.afterRemount.map((tool) => tool.name)).toEqual(["checkout.place_order"]);
  expect(lifecycle.final).toEqual([]);
});

test("SPA route disposal and pagehide remove the old registration", async ({ page }) => {
  await openScenario(page, "checkout");
  const route = await page.evaluate(() => globalThis.browserEvidence.spaRouteRemount());
  expect(route.afterDispose).toEqual([]);
  expect(route.current.map((tool) => tool.name)).toEqual(["checkout.place_order"]);
  expect(route.final).toEqual([]);
  expect(route.url).toContain("/orders/next");

  await openScenario(page, "checkout");
  expect(await page.evaluate(() => globalThis.browserEvidence.dispatchPageHide())).toEqual([]);
});

test("hard navigation replaces the document and its shim catalog", async ({ page }) => {
  await openScenario(page, "checkout");
  await expect.poll(() => page.evaluate(() => globalThis.browserEvidence.catalog().length)).toBe(1);
  await page.goto("/examples/browser-evidence/navigation-target.html");
  expect(await page.evaluate(() => globalThis.browserEvidence.catalog())).toEqual([]);
});
