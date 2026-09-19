import { chromium, expect, test } from "@playwright/test";

const port = Number(process.env.BROWSER_FIXTURE_PORT ?? "43991");
const origin = `http://127.0.0.1:${port}`;

test("native Chrome discovers, invokes, and unregisters the package tool", async () => {
  const userDataDir = process.env.WEBMCP_NATIVE_PROFILE;
  if (!userDataDir) {
    throw new Error(
      "WEBMCP_NATIVE_PROFILE must point to a dedicated Chrome profile with local WebMCP testing enabled",
    );
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: false,
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${origin}/examples/browser-evidence/native.html`);
    await expect(page.locator("html")).toHaveAttribute("data-native-web-mcp", "ready");
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);

    const initial = await page.evaluate(() => globalThis.nativeWebMcpEvidence.catalog());
    expect(initial.map((tool) => tool.name)).toContain("checkout.place_order");

    const invoked = await page.evaluate(() => globalThis.nativeWebMcpEvidence.invoke());
    expect(invoked.result).toMatchObject({ status: "succeeded" });
    expect(invoked.state.order).toMatchObject({ orderId: "ORDER-1001", status: "placed" });

    const disposed = await page.evaluate(() => globalThis.nativeWebMcpEvidence.dispose());
    expect(disposed.catalog.map((tool) => tool.name)).not.toContain("checkout.place_order");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-native-web-mcp", "ready");
    const activeBeforeNavigation = await page.evaluate(() =>
      globalThis.nativeWebMcpEvidence.catalog(),
    );
    expect(activeBeforeNavigation.map((tool) => tool.name)).toContain(
      "checkout.place_order",
    );
    await page.goto(`${origin}/examples/browser-evidence/navigation-target.html`);
    const afterNavigation = await page.evaluate(async () => {
      const context = document.modelContext;
      if (!context || typeof context.getTools !== "function") {
        throw new Error("native WebMCP API disappeared after navigation");
      }
      return (await context.getTools()).map((tool) => tool.name);
    });
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    expect(afterNavigation).not.toContain("checkout.place_order");
  } finally {
    await context.close();
  }
});

declare global {
  var nativeWebMcpEvidence: {
    catalog(): Promise<Array<{ name: string }>>;
    dispose(): Promise<{ catalog: Array<{ name: string }> }>;
    invoke(): Promise<{
      result: { status: string };
      state: { order?: { orderId: string; status: string } };
    }>;
  };
}
