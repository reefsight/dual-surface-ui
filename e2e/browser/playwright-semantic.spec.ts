import { expect, test } from "@playwright/test";

import {
  createPlaywrightSurface,
  type PlaywrightElementBinding,
} from "../../dist/playwright/index.js";

const bindings: readonly PlaywrightElementBinding[] = [
  {
    id: "approve",
    target: { role: "button", name: "Approve" },
    actions: {
      approve: {
        operation: { type: "click" },
        effects: ["approval-visible"],
      },
    },
  },
  {
    id: "country",
    target: { role: "combobox", name: "Country" },
    actions: { select: { operation: { type: "select-option" } } },
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
  {
    id: "terms",
    target: { role: "checkbox", name: "Terms" },
    actions: { accept: { operation: { type: "set-checked", checked: true } } },
  },
];

test.beforeEach(async ({ page }) => {
  await page.goto("/examples/playwright-semantic/index.html?secret=query#fragment");
});

test("runs all closed semantic operations through the shared lifecycle", async ({ page }) => {
  const origin = new URL(page.url()).origin;
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-e2e",
    allowedOrigins: [origin],
    bindings,
    policy: () => ({ outcome: "allow" }),
    verifyEffect: async ({ effect }) =>
      effect === "approval-visible" && await page.getByRole("status").textContent() === "approved",
  });

  let snapshot = await surface.snapshot();
  expect(snapshot.url).toBe(`${origin}/`);
  expect(JSON.stringify(snapshot)).not.toContain("never-export-this");
  expect(snapshot.nodes.find((node) => node.id === "password")).toMatchObject({
    state: { sensitive: true },
    actions: [],
  });

  const run = async (elementId: string, action: string, input?: unknown) => {
    snapshot = await surface.snapshot();
    return surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId,
      action,
      ...(input !== undefined ? { input } : {}),
    });
  };
  await run("name", "fill", "Ada");
  await run("terms", "accept");
  await run("country", "select", "jp");
  await run("approve", "approve");

  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Ada");
  await expect(page.getByRole("checkbox", { name: "Terms", exact: true })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("jp");
  await expect(page.getByRole("status")).toHaveText("approved");
  surface.dispose();
});

test("fails closed for ambiguous targets and excludes frames", async ({ page }) => {
  await page.getByRole("button", { name: "Approve" }).evaluate((button) => {
    button.insertAdjacentHTML("afterend", "<button>Approve</button>");
  });
  const origin = new URL(page.url()).origin;
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-ambiguous",
    allowedOrigins: [origin],
    bindings,
  });
  await expect(surface.snapshot()).rejects.toMatchObject({ code: "duplicate_element_id" });
  expect((await page.frames()[1]?.getByRole("button").count()) ?? 0).toBe(1);
  surface.dispose();
});

test("rejects a top-level origin outside the allowlist", async ({ page }) => {
  expect(() => createPlaywrightSurface({
    page,
    surfaceId: "playwright-origin",
    allowedOrigins: ["https://example.invalid"],
    bindings,
  })).toThrow(expect.objectContaining({ code: "authorization_required" }));
});

test("rejects semantic ABA replacement and cancellation before mutation", async ({ page }) => {
  const origin = new URL(page.url()).origin;
  let replace = true;
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-guards",
    allowedOrigins: [origin],
    bindings: [bindings[0]!],
    policy: async () => {
      if (replace) {
        await page.getByRole("button", { name: "Approve", exact: true }).evaluate((button) => {
          button.replaceWith(button.cloneNode(true));
        });
      }
      return { outcome: "allow" };
    },
    verifyEffect: () => true,
  });
  let snapshot = await surface.snapshot();
  let outcome = await surface.performSafe({
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "approve",
    action: "approve",
  });
  expect(outcome).toMatchObject({ status: "failed", error: { code: "stale_revision" } });
  await expect(page.getByRole("status")).toHaveText("pending");

  replace = false;
  const controller = new AbortController();
  const cancelling = createPlaywrightSurface({
    page,
    surfaceId: "playwright-cancel",
    allowedOrigins: [origin],
    bindings: [bindings[0]!],
    policy: async () => {
      controller.abort();
      return { outcome: "allow" };
    },
    verifyEffect: () => true,
  });
  snapshot = await cancelling.snapshot();
  outcome = await cancelling.performSafe({
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "approve",
    action: "approve",
  }, { signal: controller.signal });
  expect(outcome).toMatchObject({ status: "failed", error: { code: "internal_error" } });
  await expect(page.getByRole("status")).toHaveText("pending");
  surface.dispose();
  cancelling.dispose();
});

test("fails verification when an action triggers a prohibited popup", async ({ page }) => {
  await page.getByRole("button", { name: "Approve" }).evaluate((button) => {
    button.addEventListener("click", () => window.open("about:blank", "_blank"));
  });
  const origin = new URL(page.url()).origin;
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-popup",
    allowedOrigins: [origin],
    bindings: [bindings[0]!],
    policy: () => ({ outcome: "allow" }),
    verifyEffect: () => true,
  });
  const snapshot = await surface.snapshot();
  const popupPromise = page.waitForEvent("popup");
  const outcome = await surface.performSafe({
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "approve",
    action: "approve",
  });
  const popup = await popupPromise;
  await popup.close();
  expect(outcome).toMatchObject({ status: "failed", error: { code: "verification_failed" } });
  surface.dispose();
});

test("reports stale revision when disposal races post-mutation observation", async ({ page }) => {
  const origin = new URL(page.url()).origin;
  let surface!: ReturnType<typeof createPlaywrightSurface>;
  surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-disposal-boundary",
    allowedOrigins: [origin],
    bindings: [bindings[0]!],
    policy: () => ({ outcome: "allow" }),
    verifyEffect: () => true,
    onAudit(event) {
      if (event.event === "action_started") surface.dispose();
    },
  });
  const snapshot = await surface.snapshot();
  const outcome = await surface.performSafe({
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "approve",
    action: "approve",
  });
  expect(outcome).toMatchObject({
    status: "failed",
    error: { code: "stale_revision" },
  });
  await expect(page.getByRole("status")).toHaveText("approved");
});

for (const prohibitedEvent of ["dialog", "navigation", "frame"] as const) {
  test(`fails verification for post-start ${prohibitedEvent}`, async ({ page }) => {
    await page.getByRole("button", { name: "Approve" }).evaluate((button, eventName) => {
      button.addEventListener("click", () => {
        if (eventName === "dialog") window.alert("sensitive-dialog-text");
        else if (eventName === "navigation") window.history.pushState({}, "", "?changed=1");
        else document.body.append(document.createElement("iframe"));
      });
    }, prohibitedEvent);
    const surface = createPlaywrightSurface({
      page,
      surfaceId: `playwright-${prohibitedEvent}`,
      allowedOrigins: [new URL(page.url()).origin],
      bindings: [bindings[0]!],
      policy: () => ({ outcome: "allow" }),
      verifyEffect: () => true,
    });
    const snapshot = await surface.snapshot();
    const outcome = await surface.performSafe({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "approve",
      action: "approve",
    });
    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "verification_failed" },
    });
    expect(JSON.stringify(outcome)).not.toContain("sensitive-dialog-text");
    surface.dispose();
  });
}

test("dispose during policy prevents mutation and returns a fixed failure", async ({ page }) => {
  let releasePolicy!: () => void;
  const policyEntered = new Promise<void>((resolve) => {
    releasePolicy = resolve;
  });
  let signalPolicyEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    signalPolicyEntered = resolve;
  });
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-dispose",
    allowedOrigins: [new URL(page.url()).origin],
    bindings: [bindings[0]!],
    policy: async () => {
      signalPolicyEntered();
      await policyEntered;
      return { outcome: "allow" };
    },
    verifyEffect: () => true,
  });
  const snapshot = await surface.snapshot();
  const pending = surface.performSafe({
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "approve",
    action: "approve",
  });
  await entered;
  surface.dispose();
  releasePolicy();
  const outcome = await pending;
  expect(outcome).toMatchObject({ status: "failed" });
  expect(outcome.status === "failed" && outcome.error.message).toMatch(
    /stale|unexpectedly/i,
  );
  await expect(page.getByRole("status")).toHaveText("pending");
});

test("redacts credential-name corpus and serializes replay-safe writes", async ({ page }) => {
  await page.locator("body").evaluate((body) => {
    body.insertAdjacentHTML("afterbegin", [
      '<input aria-label="One-time authentication code" value="otp-123456">',
      '<input aria-label="API token" value="api-token-secret">',
      '<input aria-label="Verification code" value="verification-secret">',
      '<input aria-label="Shipping" value="">',
      '<input aria-label="Discard reason" value="">',
    ].join(""));
  });
  const origin = new URL(page.url()).origin;
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-replay",
    allowedOrigins: [origin],
    bindings: [
      {
        id: "otp",
        target: { role: "textbox", name: "One-time authentication code" },
        actions: { fill: { operation: { type: "fill" } } },
      },
      {
        id: "api-token",
        target: { role: "textbox", name: "API token" },
        actions: { fill: { operation: { type: "fill" } } },
      },
      {
        id: "verification-code",
        target: { role: "textbox", name: "Verification code" },
        actions: { fill: { operation: { type: "fill" } } },
      },
      {
        id: "shipping",
        target: { role: "textbox", name: "Shipping" },
        actions: { fill: { operation: { type: "fill" } } },
      },
      {
        id: "discard-reason",
        target: { role: "textbox", name: "Discard reason" },
        actions: { fill: { operation: { type: "fill" } } },
      },
      {
        ...bindings[2]!,
        actions: {
          fill: { operation: { type: "fill" }, idempotency: "keyed" },
        },
      },
    ],
    policy: () => ({ outcome: "allow" }),
  });
  let snapshot = await surface.snapshot();
  for (const id of ["otp", "api-token", "verification-code"]) {
    expect(snapshot.nodes.find((node) => node.id === id)?.actions).toEqual([]);
  }
  for (const id of ["shipping", "discard-reason"]) {
    expect(snapshot.nodes.find((node) => node.id === id)?.actions).toHaveLength(1);
  }
  expect(JSON.stringify(snapshot)).not.toMatch(/otp-123456|api-token-secret|verification-secret/);

  const request = {
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "name",
    action: "fill",
    input: "Grace",
    idempotencyKey: "same-write",
  } as const;
  const [first, replay] = await Promise.all([
    surface.performSafe(request),
    surface.performSafe(request),
  ]);
  expect(first.status).toBe("succeeded");
  expect(replay.status).toBe("succeeded");
  const conflict = await surface.performSafe({ ...request, input: "Ada" });
  expect(conflict).toMatchObject({ status: "failed", error: { code: "idempotency_conflict" } });
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Grace");
  surface.dispose();
});

test("serializes unkeyed writes so a retained revision mutates once", async ({ page }) => {
  const origin = new URL(page.url()).origin;
  const surface = createPlaywrightSurface({
    page,
    surfaceId: "playwright-unkeyed",
    allowedOrigins: [origin],
    bindings: [bindings[2]!],
    policy: () => ({ outcome: "allow" }),
  });
  const snapshot = await surface.snapshot();
  const base = {
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "name",
    action: "fill",
  } as const;
  const [first, second] = await Promise.all([
    surface.performSafe({ ...base, input: "first" }),
    surface.performSafe({ ...base, input: "second" }),
  ]);
  expect(first.status).toBe("succeeded");
  expect(second).toMatchObject({ status: "failed", error: { code: "stale_revision" } });
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("first");
  surface.dispose();
});
