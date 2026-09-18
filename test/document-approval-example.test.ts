// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentPreconditionFailedError,
  createAgentSurface,
} from "../src/index.js";
import type { AgentSnapshot } from "../src/index.js";
import {
  createDocumentApprovalWorkflow,
  EXPECTED_AGENT_STEPS,
} from "../examples/document-approval/workflow.mjs";
import {
  canonicalTextSha256,
  estimatedTokensFromBytes,
  percentile,
  summarizeBaselineSamples,
  utf8Bytes,
} from "../scripts/phase1-baseline-lib.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadExample() {
  document.documentElement.innerHTML = await readFile(
    resolve(projectRoot, "examples", "document-approval", "index.html"),
    "utf8",
  );
  return createDocumentApprovalWorkflow({ document, createAgentSurface });
}

function approvalRequest(snapshot: AgentSnapshot) {
  return {
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    elementId: "approve-document",
    action: "approve_document",
    input: { comment: "Reviewed against the signed agreement." },
    idempotencyKey: "DOC-1042.approve.test",
  };
}

describe("document approval example", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.history.replaceState({}, "", "/");
  });

  it("advertises the complete consequential approval contract", async () => {
    const workflow = await loadExample();
    const snapshot = workflow.surface.snapshot();
    const approval = snapshot.nodes.find((node) => node.id === "approve-document");

    expect(approval).toEqual(
      expect.objectContaining({
        description: "Approve DOC-1042 after every required widget is complete",
        actions: [
          expect.objectContaining({
            name: "approve_document",
            risk: "consequential",
            preconditions: ["required_widgets_complete"],
            effects: ["document_approved"],
            requiresConfirmation: true,
            idempotency: "keyed",
          }),
        ],
      }),
    );
  });

  it(
    "completes the agent workflow through policy, confirmation, and verification",
    async () => {
      const workflow = await loadExample();
      const outcome = await workflow.runAgentWorkflow();

      expect(outcome.steps).toEqual(EXPECTED_AGENT_STEPS);
      expect(outcome.result).toEqual(
        expect.objectContaining({
          status: "succeeded",
          action: "approve_document",
          output: {
            documentId: "DOC-1042",
            status: "approved",
            commentAccepted: true,
          },
        }),
      );
      expect(workflow.status.textContent).toBe("Approved");
      expect(workflow.approvalCount).toBe(1);
      expect(workflow.confirmationCount).toBe(1);
      expect(workflow.auditEvents.map((event) => event.event)).toEqual([
        "surface_observed",
        "action_requested",
        "policy_decided",
        "action_started",
        "action_verified",
        "action_requested",
        "policy_decided",
        "action_started",
        "action_verified",
        "action_requested",
        "policy_decided",
        "confirmation_requested",
        "action_started",
        "action_verified",
      ]);
    },
    30_000,
  );

  it(
    "keeps human and agent paths on the same visible application state",
    async () => {
      const human = await loadExample();
      const humanResult = human.runHumanWorkflow();
      expect(humanResult.status).toBe("Approved");
      expect(human.approvalCount).toBe(1);

      const agent = await loadExample();
      await agent.runAgentWorkflow();
      expect(agent.status.textContent).toBe(humanResult.status);
      expect(agent.approvalCount).toBe(human.approvalCount);
    },
    30_000,
  );

  it(
    "does not serialize the hidden sentinel into snapshots, results, or audit",
    async () => {
      const workflow = await loadExample();
      const outcome = await workflow.runAgentWorkflow();
      const serialized = JSON.stringify({
        snapshot: outcome.initialSnapshot,
        result: outcome.result,
        audit: workflow.auditEvents,
      });

      expect(document.documentElement.innerHTML).toContain(
        "SECRET_SENTINEL_DO_NOT_EXPOSE",
      );
      expect(serialized).not.toContain("SECRET_SENTINEL_DO_NOT_EXPOSE");
    },
    30_000,
  );

  it("blocks approval when required widgets remain incomplete", async () => {
    const workflow = await loadExample();
    const snapshot = workflow.surface.snapshot();

    await expect(
      workflow.surface.perform(approvalRequest(snapshot)),
    ).rejects.toBeInstanceOf(AgentPreconditionFailedError);
    expect(workflow.approvalCount).toBe(0);
    expect(workflow.status.textContent).toBe("Pending");
  });

  it("does not execute when trusted confirmation is declined", async () => {
    document.documentElement.innerHTML = await readFile(
      resolve(projectRoot, "examples", "document-approval", "index.html"),
      "utf8",
    );
    const workflow = createDocumentApprovalWorkflow({
      document,
      createAgentSurface,
      confirmApproval: false,
    });
    document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      (input as HTMLInputElement).click();
    });
    const snapshot = workflow.surface.snapshot();

    await expect(
      workflow.surface.perform(approvalRequest(snapshot)),
    ).rejects.toBeInstanceOf(AgentConfirmationRequiredError);
    expect(workflow.confirmationCount).toBe(1);
    expect(workflow.approvalCount).toBe(0);
  });

  it("denies approval outside the configured origin", async () => {
    document.documentElement.innerHTML = await readFile(
      resolve(projectRoot, "examples", "document-approval", "index.html"),
      "utf8",
    );
    const workflow = createDocumentApprovalWorkflow({
      document,
      createAgentSurface,
      allowedOrigin: "https://untrusted.example",
    });
    document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      (input as HTMLInputElement).click();
    });
    const snapshot = workflow.surface.snapshot();

    await expect(
      workflow.surface.perform(approvalRequest(snapshot)),
    ).rejects.toBeInstanceOf(AgentAuthorizationRequiredError);
    expect(workflow.confirmationCount).toBe(0);
    expect(workflow.approvalCount).toBe(0);
  });
});

describe("Phase 1 baseline helpers", () => {
  it("uses an explicit deterministic token proxy and nearest-rank percentiles", () => {
    expect(canonicalTextSha256("line one\r\nline two\r")).toBe(
      canonicalTextSha256("line one\nline two\n"),
    );
    expect(utf8Bytes("abcd")).toBe(4);
    expect(estimatedTokensFromBytes(5)).toBe(2);
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
  });

  it("summarizes completion, safety, context, steps, and latency", () => {
    expect(
      summarizeBaselineSamples({
        fullDom: "x".repeat(100),
        semanticSnapshot: "x".repeat(40),
        latenciesMs: [1, 2, 3, 4],
        stepCounts: [4, 4, 4, 4],
        completions: [true, true, true, true],
        confirmations: 4,
        secretLeaks: 0,
        wrongActions: 0,
        unauthorizedConsequentialActions: 0,
      }),
    ).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          estimatedTokenReductionPercent: 60,
        }),
        workflow: {
          repetitions: 4,
          completionSuccesses: 4,
          completionRate: 1,
          medianInteractionSteps: 4,
          wrongActionCount: 0,
          wrongActionRate: 0,
        },
        safety: {
          confirmations: 4,
          secretLeaks: 0,
          unauthorizedConsequentialActions: 0,
        },
        latency: { medianMs: 2, p95Ms: 4, minMs: 1, maxMs: 4 },
      }),
    );
  });
});
