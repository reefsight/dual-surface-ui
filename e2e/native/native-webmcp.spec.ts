import { chromium, expect, test } from "@playwright/test";

import { PAYMENT_SECRET_SENTINEL } from "../../examples/checkout/workflow.mjs";

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
    expect(JSON.stringify({ afterNavigation, disposed, initial, invoked })).not.toContain(
      PAYMENT_SECRET_SENTINEL,
    );
  } finally {
    await context.close();
  }
});

test("native Chrome activates and unregisters declarative form annotations", async () => {
  const context = await launchNativeContext();
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${origin}/examples/browser-evidence/native-declarative.html`);
    await expect(page.locator("html")).toHaveAttribute(
      "data-native-declarative-web-mcp",
      "ready",
    );
    const initial = await page.evaluate(() => globalThis.nativeDeclarativeEvidence.catalog());
    expect(initial.map((tool) => tool.name)).toContain("profile.prepare");

    await page.evaluate(() => globalThis.nativeDeclarativeEvidence.activate());
    await expect(page.locator("#display-name")).toHaveValue("Ada Lovelace");
    await expect(page.locator("#biography")).toHaveValue(
      "A browser-native declarative evidence record",
    );
    const state = await page.evaluate(() => globalThis.nativeDeclarativeEvidence.state());
    expect(state).toMatchObject({
      invocationError: undefined,
      toolAutoSubmit: false,
    });
    expect(state.activationCount).toBeGreaterThanOrEqual(1);
    expect(state.activationSources).toContain("window");
    await page.locator('button[type="submit"]').click();
    await expect.poll(async () =>
      page.evaluate(() => globalThis.nativeDeclarativeEvidence.state()),
    ).toMatchObject({
      invocationResult: { displayName: "Ada Lovelace", status: "reviewed" },
      submitCount: 1,
    });

    const disposed = await page.evaluate(() => globalThis.nativeDeclarativeEvidence.dispose());
    expect(disposed.annotationsPresent).toBe(false);
    expect(disposed.catalog.map((tool) => tool.name)).not.toContain("profile.prepare");
  } finally {
    await context.close();
  }
});

test("native Chrome does not expose a cross-origin child tool to its parent", async () => {
  const context = await launchNativeContext();
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${origin}/examples/browser-evidence/native-frames.html`);
    const blockedChild = page.frames().find((frame) =>
      frame.url().includes("permission=blocked"),
    );
    const delegatedChild = page.frames().find((frame) =>
      frame.url().includes("permission=delegated"),
    );
    expect(blockedChild).toBeDefined();
    expect(delegatedChild).toBeDefined();
    await expect(blockedChild!.locator("html")).toHaveAttribute(
      "data-native-frame-web-mcp",
      "blocked",
    );
    const registrationError = await blockedChild!.evaluate(
      () => globalThis.nativeFrameEvidence.registrationError,
    );
    expect(registrationError).toMatchObject({ name: "NotAllowedError" });
    expect(registrationError?.message).toContain("permissions policy");
    const childCatalog = await blockedChild!.evaluate(
      () => globalThis.nativeFrameEvidence.catalog(),
    );
    expect(childCatalog).toMatchObject({
      rejected: { name: "NotAllowedError" },
    });
    await expect(delegatedChild!.locator("html")).toHaveAttribute(
      "data-native-frame-web-mcp",
      "ready",
    );
    expect(
      await delegatedChild!.evaluate(() => globalThis.nativeFrameEvidence.catalog()),
    ).toMatchObject({ names: ["frame.inspect_child"] });

    const parentNames = await page.evaluate(async () =>
      (await document.modelContext.getTools()).map((tool) => tool.name),
    );
    expect(parentNames).not.toContain("frame.inspect_child");
    const delegated = await page.evaluate(async (childOrigin) => {
      try {
        const tools = await document.modelContext.getTools({ fromOrigins: [childOrigin] });
        return { names: tools.map((tool) => tool.name) };
      } catch (error) {
        return { rejected: error instanceof Error ? error.name : String(error) };
      }
    }, `http://127.0.0.1:${port + 1}`);
    if ("names" in delegated) {
      expect(delegated.names).not.toContain("frame.inspect_child");
    } else {
      expect(delegated.rejected).toBeTruthy();
    }
  } finally {
    await context.close();
  }
});

async function launchNativeContext() {
  const userDataDir = process.env.WEBMCP_NATIVE_PROFILE;
  if (!userDataDir) {
    throw new Error(
      "WEBMCP_NATIVE_PROFILE must point to a dedicated Chrome profile with local WebMCP testing enabled",
    );
  }
  return chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: false,
  });
}

declare global {
  var nativeWebMcpEvidence: {
    catalog(): Promise<Array<{ name: string }>>;
    dispose(): Promise<{ catalog: Array<{ name: string }> }>;
    invoke(): Promise<{
      result: { status: string };
      state: { order?: { orderId: string; status: string } };
    }>;
  };
  var nativeDeclarativeEvidence: {
    activate(): Promise<void>;
    catalog(): Promise<Array<{ name: string }>>;
    dispose(): Promise<{ annotationsPresent: boolean; catalog: Array<{ name: string }> }>;
    state(): {
      activationCount: number;
      activationSources: string[];
      biography: string;
      displayName: string;
      invocationError?: string;
      invocationResult?: { displayName: string; status: string };
      submitCount: number;
      toolAutoSubmit: boolean;
    };
  };
  var nativeFrameEvidence: {
    catalog(): Promise<
      | { names: string[] }
      | { rejected: { message: string; name: string } }
    >;
    registrationError?: { message: string; name: string };
  };
}
