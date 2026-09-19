// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentIdempotencyConflictError,
  AgentInputValidationError,
  AgentPreconditionFailedError,
  AgentStaleRevisionError,
  AgentVerificationFailedError,
  createAgentSurface,
} from "../src/index.js";
import type { AgentSnapshot } from "../src/index.js";
import { defineDomainElement } from "../src/domain/index.js";
import {
  checkSemanticDrift,
  createSemanticDriftManifest,
  digestSemanticValue,
  importSemanticDriftIntegrityKey,
} from "../src/drift/index.js";
import { exportAgentSurfaceToWebMcp } from "../src/webmcp/index.js";
import {
  CHECKOUT_EMAIL,
  EXPECTED_CHECKOUT_STEPS,
  PAYMENT_SECRET_SENTINEL,
  createCheckoutWorkflow,
} from "../examples/checkout/workflow.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadExample(options = {}) {
  document.documentElement.innerHTML = await readFile(
    resolve(projectRoot, "examples", "checkout", "index.html"),
    "utf8",
  );
  window.history.replaceState({}, "", "/checkout");
  return createCheckoutWorkflow({
    document,
    createAgentSurface,
    defineDomainElement,
    exportAgentSurfaceToWebMcp,
    ...options,
  });
}

function placeOrderRequest(snapshot: AgentSnapshot, revision = snapshot.revision) {
  return {
    surfaceId: snapshot.surfaceId,
    revision,
    elementId: "place-order",
    action: "place_order",
    input: { shippingEmail: CHECKOUT_EMAIL },
    idempotencyKey: "ORDER-1001.test",
  };
}

describe("checkout example", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.history.replaceState({}, "", "/");
  });

  it("advertises the complete consequential checkout contract", async () => {
    const workflow = await loadExample();
    const action = workflow.surface.snapshot().nodes
      .find((node) => node.id === "place-order")?.actions[0];

    expect(action).toEqual(expect.objectContaining({
      name: "place_order",
      risk: "consequential",
      preconditions: ["checkout_ready"],
      effects: ["order_created"],
      requiresConfirmation: true,
      idempotency: "keyed",
      inputSchema: expect.objectContaining({ required: ["shippingEmail"] }),
      outputSchema: expect.objectContaining({
        required: ["orderId", "status", "totalCents", "inventoryRemaining"],
      }),
    }));
    expect(workflow.webMcpBindings).toEqual([{
      name: "checkout.place_order",
      description: "Place the current cart for the visible shipping email",
      elementId: "place-order",
      action: "place_order",
    }]);
  });

  it("checks a pinned reviewed snapshot against live exporter, policy, and UI evidence", async () => {
    const workflow = await loadExample();
    const handle = await workflow.webMcpHandle;
    const snapshot = workflow.surface.snapshot();
    const integrityKey = await importSemanticDriftIntegrityKey(
      new Uint8Array(32).fill(11),
    );
    const manifest = await createSemanticDriftManifest({
      snapshot,
      declaredTools: workflow.webMcpBindings,
      integrityKey,
    });
    const emailValueDigest = await digestSemanticValue(
      integrityKey,
      "shipping-email",
      "",
    );
    const termsValueDigest = await digestSemanticValue(
      integrityKey,
      "accept-checkout-terms",
      "on",
    );
    const observationEpoch = 1;
    const driftInput = {
      root: document.querySelector("#checkout-agent-surface")!,
      readSnapshot: () => workflow.surface.snapshot(),
      manifest,
      expectedFingerprint:
        "hmac-sha256:aac4513d348e57d21c65dd88946a9e40d97763c9cc4a60d386f8bbed457d1dde",
      integrityKey,
      controls: [
        { element: workflow.email, elementId: "shipping-email" },
        { element: workflow.terms, elementId: "accept-checkout-terms" },
        { element: workflow.placeOrderButton, elementId: "place-order" },
      ],
      declaredTools: workflow.webMcpBindings,
      readActiveTools: () => ({
        status: "observed",
        tools: handle.toolObservations,
      }),
      readPermission: workflow.readPermission,
      readApplicationState: (elementId: string) => {
        if (elementId === "shipping-email") {
          return {
            disabled: workflow.email.disabled,
            ...(workflow.email.value === "" ? { valueDigest: emailValueDigest } : {}),
          };
        }
        if (elementId === "accept-checkout-terms") {
          return {
            disabled: workflow.terms.disabled,
            checked: workflow.terms.checked,
            ...(workflow.terms.value === "on" ? { valueDigest: termsValueDigest } : {}),
          };
        }
        if (elementId === "place-order") {
          return { disabled: workflow.placeOrderButton.disabled };
        }
        return undefined;
      },
      permissionContext: {
        principalId: "buyer-17",
        originId: "checkout-example",
        inputCaseId: "initial",
      },
      observationEpoch,
      readEpoch: () => observationEpoch,
    } as const;

    expect(manifest.fingerprint).toBe(driftInput.expectedFingerprint);
    const report = await checkSemanticDrift(driftInput);

    expect(report.status, JSON.stringify(report)).toBe("consistent");
    expect(report.issues).toEqual([]);

    workflow.placeOrderButton.setAttribute("aria-label", "Pay without review");
    const drifted = await checkSemanticDrift(driftInput);
    expect(drifted.status).toBe("drifted");
    expect(drifted.issues.some((issue) =>
      issue.code === "accessible_name_mismatch"
    )).toBe(true);
    handle.dispose();
  });

  it("places an order through policy, confirmation, precondition, and effect verification", async () => {
    const workflow = await loadExample();
    const outcome = await workflow.runAgentWorkflow();

    expect(outcome.steps).toEqual(EXPECTED_CHECKOUT_STEPS);
    expect(outcome.result).toEqual(expect.objectContaining({
      status: "succeeded",
      action: "place_order",
      output: {
        orderId: "ORDER-1001",
        status: "placed",
        totalCents: 4250,
        inventoryRemaining: 0,
      },
    }));
    expect(workflow.businessState()).toEqual({
      inventoryRemaining: 0,
      order: {
        orderId: "ORDER-1001",
        status: "placed",
        totalCents: 4250,
        shippingEmail: CHECKOUT_EMAIL,
      },
      status: "Order placed",
      receipt: "ORDER-1001 · $42.50",
    });
    expect(workflow.commandExecutions).toBe(1);
    expect(workflow.confirmationCount).toBe(1);
    expect(workflow.policyChecks).toBe(3);
    expect(workflow.verificationCount).toBe(1);
    expect(workflow.registrations).toHaveLength(2);
    expect(workflow.registrations[0].signal.aborted).toBe(true);
    expect(workflow.registrations[1].signal.aborted).toBe(false);
    expect(JSON.stringify(outcome.result.output).length).toBeLessThanOrEqual(4096);
  });

  it("refreshes and disposes the exported tool lifecycle", async () => {
    const workflow = await loadExample();
    const handle = await workflow.webMcpHandle;
    expect(handle.toolObservations[0]?.generation).toBe(1);
    expect(workflow.activeTools.has("checkout.place_order")).toBe(true);

    await handle.refresh();
    expect(handle.toolObservations[0]?.generation).toBe(2);
    expect(workflow.registrations[0].signal.aborted).toBe(true);
    expect(workflow.activeTools.has("checkout.place_order")).toBe(true);

    handle.dispose();
    expect(workflow.registrations[1].signal.aborted).toBe(true);
    expect(workflow.activeTools.size).toBe(0);
    expect(handle.toolObservations).toEqual([]);
  });

  it("keeps the human and agent paths on the same business command and final state", async () => {
    const human = await loadExample();
    human.runHumanWorkflow();

    const agent = await loadExample();
    await agent.runAgentWorkflow();

    expect(agent.businessState()).toEqual(human.businessState());
    expect(human.commandExecutions).toBe(1);
    expect(agent.commandExecutions).toBe(1);
    expect(human.confirmationCount).toBe(1);
    expect(agent.confirmationCount).toBe(1);
  });

  it("validates input before policy or business execution", async () => {
    const workflow = await loadExample();
    const snapshot = workflow.surface.snapshot();
    await expect(workflow.surface.perform({
      ...placeOrderRequest(snapshot),
      input: { shippingEmail: "invalid email" },
    })).rejects.toBeInstanceOf(AgentInputValidationError);
    expect(workflow.policyChecks).toBe(0);
    expect(workflow.commandExecutions).toBe(0);
  });

  it("blocks checkout when its authoritative precondition is false", async () => {
    const workflow = await loadExample();
    workflow.email.value = CHECKOUT_EMAIL;
    workflow.email.dispatchEvent(new Event("input", { bubbles: true }));
    const snapshot = workflow.surface.snapshot();

    await expect(
      workflow.surface.perform(placeOrderRequest(snapshot)),
    ).rejects.toBeInstanceOf(AgentPreconditionFailedError);
    expect(workflow.commandExecutions).toBe(0);
  });

  it("enforces trusted confirmation and buyer policy", async () => {
    const declined = await loadExample({ confirmOrder: false });
    const declinedReady = await declined.prepareAgentCheckout();
    await expect(declined.surface.perform(placeOrderRequest(
      declinedReady.initialSnapshot,
      declinedReady.revision,
    ))).rejects.toBeInstanceOf(AgentConfirmationRequiredError);
    expect(declined.commandExecutions).toBe(0);

    const denied = await loadExample({ principal: { id: "guest", roles: ["guest"] } });
    await expect(denied.prepareAgentCheckout())
      .rejects.toBeInstanceOf(AgentAuthorizationRequiredError);
    denied.runHumanWorkflow();
    expect(denied.status.textContent).toBe("Checkout is not authorized");
    expect(denied.confirmationCount).toBe(0);
    expect(denied.commandExecutions).toBe(0);
  });

  it("replays the same idempotency key once and rejects conflicting input", async () => {
    const workflow = await loadExample();
    const prepared = await workflow.prepareAgentCheckout();
    const request = placeOrderRequest(prepared.initialSnapshot, prepared.revision);
    const first = await workflow.surface.perform(request);
    const replay = await workflow.surface.perform(request);

    expect(replay).toEqual(first);
    expect(workflow.commandExecutions).toBe(1);
    await expect(workflow.surface.perform({
      ...request,
      input: { shippingEmail: "other@example.test" },
    })).rejects.toBeInstanceOf(AgentIdempotencyConflictError);
    expect(workflow.commandExecutions).toBe(1);
  });

  it("keeps the saved payment credential outside snapshots, results, and audit", async () => {
    const workflow = await loadExample();
    const outcome = await workflow.runAgentWorkflow();
    const paymentNode = outcome.initialSnapshot.nodes
      .find((node) => node.id === "payment-token");
    const serialized = JSON.stringify({
      snapshot: outcome.initialSnapshot,
      result: outcome.result,
      audit: workflow.auditEvents,
    });

    expect(workflow.payment.value).toBe(PAYMENT_SECRET_SENTINEL);
    expect(paymentNode).toBeUndefined();
    expect(serialized).not.toContain(PAYMENT_SECRET_SENTINEL);
  });

  it("rejects stale revisions before confirmation or business execution", async () => {
    const workflow = await loadExample();
    const stale = workflow.surface.snapshot();
    await workflow.surface.perform({
      surfaceId: stale.surfaceId,
      revision: stale.revision,
      elementId: "shipping-email",
      action: "set_value",
      input: CHECKOUT_EMAIL,
    });

    await expect(
      workflow.surface.perform(placeOrderRequest(stale)),
    ).rejects.toBeInstanceOf(AgentStaleRevisionError);
    expect(workflow.confirmationCount).toBe(0);
    expect(workflow.commandExecutions).toBe(0);
  });

  it("fails closed when the declared order effect cannot be verified", async () => {
    const workflow = await loadExample({ verifyOrderEffect: false });
    const prepared = await workflow.prepareAgentCheckout();
    await expect(workflow.surface.perform(placeOrderRequest(
      prepared.initialSnapshot,
      prepared.revision,
    ))).rejects.toBeInstanceOf(AgentVerificationFailedError);
    expect(workflow.verificationCount).toBe(1);
    expect(workflow.commandExecutions).toBe(1);
  });
});
