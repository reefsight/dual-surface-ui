// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentInputValidationError,
  AgentPreconditionFailedError,
  AgentStaleRevisionError,
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
import {
  exportAgentSurfaceToWebMcp,
  type WebMcpModelContext,
  type WebMcpTool,
} from "../src/webmcp/index.js";
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
  window.history.replaceState({}, "", "/approvals/DOC-1042");
  return createDocumentApprovalWorkflow({
    document,
    createAgentSurface,
    defineDomainElement,
  });
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
      expect(agent.getDocumentState()).toEqual(human.getDocumentState());
    },
    30_000,
  );

  it("executes the approval through the actual WebMCP exporter lifecycle", async () => {
    const human = await loadExample();
    human.runHumanWorkflow();
    const workflow = await loadExample();
    document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      (input as HTMLInputElement).click();
    });
    const tools = new Map<string, WebMcpTool>();
    const context: WebMcpModelContext = {
      registerTool(tool, options) {
        tools.set(tool.name, tool);
        options.signal.addEventListener("abort", () => tools.delete(tool.name), {
          once: true,
        });
      },
    };
    const handle = await exportAgentSurfaceToWebMcp(workflow.surface, {
      bindings: workflow.webMcpBindings,
      modelContext: context,
    });

    const result = await tools.get("documents.approve")!.execute({
      input: { comment: "Reviewed against the signed agreement." },
      idempotencyKey: "DOC-1042.webmcp.v1",
    });

    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(4096);
    expect(workflow.getDocumentState()).toEqual({
      documentId: "DOC-1042",
      status: "approved",
      commentAccepted: true,
    });
    expect(workflow.getDocumentState()).toEqual(human.getDocumentState());
    expect(handle.toolObservations).toHaveLength(1);
    await expect(handle.refresh()).rejects.toThrow("targets an unavailable action");
    expect(handle.toolObservations).toEqual([]);
    expect(tools.size).toBe(0);
    handle.dispose();
    expect(handle.toolObservations).toEqual([]);
    expect(tools.size).toBe(0);
  });

  it("runs the nominal example path through its exported WebMCP tool", async () => {
    const workflow = await loadExample();

    const outcome = await workflow.runWebMcpAgentWorkflow({
      exportAgentSurfaceToWebMcp,
    });

    expect(outcome.result.status).toBe("succeeded");
    expect(outcome.invokedTool).toBe("documents.approve");
    expect(outcome.registrations).toBe(2);
    expect(workflow.approvalCount).toBe(1);
  });

  it("reports consistent reviewed drift evidence for the initial workflow", async () => {
    const workflow = await loadExample();
    const context: WebMcpModelContext = { registerTool() {} };
    const handle = await exportAgentSurfaceToWebMcp(workflow.surface, {
      bindings: workflow.webMcpBindings,
      modelContext: context,
    });
    const snapshot = workflow.surface.snapshot();
    const integrityKey = await importSemanticDriftIntegrityKey(
      new Uint8Array(32).fill(22),
    );
    const manifest = await createSemanticDriftManifest({
      snapshot,
      declaredTools: workflow.webMcpBindings,
      integrityKey,
    });
    const comment = document.querySelector("#approval-comment") as HTMLTextAreaElement;
    const commentNode = snapshot.nodes.find((node) =>
      node.role === "textbox" && node.name === "Approval comment"
    );
    if (!commentNode) throw new Error("Approval comment semantic node is missing");
    const controls = [
      {
        element: document.querySelector('[data-agent-id="confirm-identity"]')!,
        elementId: "confirm-identity",
      },
      {
        element: document.querySelector('[data-agent-id="accept-terms"]')!,
        elementId: "accept-terms",
      },
      { element: comment, elementId: commentNode.id },
      {
        element: document.querySelector("#approve-document")!,
        elementId: "approve-document",
      },
    ];
    const checkboxValueDigest = await digestSemanticValue(
      integrityKey,
      "confirm-identity",
      "on",
    );
    const termsValueDigest = await digestSemanticValue(
      integrityKey,
      "accept-terms",
      "on",
    );
    const reviewedCommentValue = comment.value;
    const commentValueDigest = await digestSemanticValue(
      integrityKey,
      commentNode.id,
      reviewedCommentValue,
    );
    const observationEpoch = 1;
    const identity = document.querySelector(
      '[data-agent-id="confirm-identity"]',
    ) as HTMLInputElement;
    const terms = document.querySelector(
      '[data-agent-id="accept-terms"]',
    ) as HTMLInputElement;
    const approveButton = document.querySelector(
      "#approve-document",
    ) as HTMLButtonElement;
    const driftInput = {
      root: document.querySelector("main")!,
      readSnapshot: () => workflow.surface.snapshot(),
      manifest,
      expectedFingerprint:
        "hmac-sha256:2426212ea02d4a69a8570c5604077a43fc695b4b755bf6059898da3886c4fba5",
      integrityKey,
      controls,
      declaredTools: workflow.webMcpBindings,
      readActiveTools: () => ({
        status: "observed",
        tools: handle.toolObservations,
      }),
      readPermission: workflow.readPermission,
      readApplicationState: (elementId: string) => {
        if (elementId === "confirm-identity") {
          return {
            disabled: identity.disabled,
            checked: identity.checked,
            ...(identity.value === "on" ? { valueDigest: checkboxValueDigest } : {}),
          };
        }
        if (elementId === "accept-terms") {
          return {
            disabled: terms.disabled,
            checked: terms.checked,
            ...(terms.value === "on" ? { valueDigest: termsValueDigest } : {}),
          };
        }
        if (elementId === commentNode.id) {
          return {
            disabled: comment.disabled,
            ...(comment.value === reviewedCommentValue
              ? { valueDigest: commentValueDigest }
              : {}),
          };
        }
        if (elementId === "approve-document") {
          return { disabled: approveButton.disabled };
        }
        return undefined;
      },
      permissionContext: {
        principalId: "reviewer-7",
        originId: "document-approval-example",
        inputCaseId: "initial",
      },
      observationEpoch,
      readEpoch: () => observationEpoch,
    } as const;

    expect(manifest.fingerprint).toBe(driftInput.expectedFingerprint);
    const report = await checkSemanticDrift(driftInput);

    expect(report.status, JSON.stringify(report)).toBe("consistent");
    expect(report.issues).toEqual([]);

    approveButton.setAttribute("aria-label", "Approve without review");
    const drifted = await checkSemanticDrift(driftInput);
    expect(drifted.status).toBe("drifted");
    expect(drifted.issues.some((issue) =>
      issue.code === "accessible_name_mismatch"
    )).toBe(true);
    handle.dispose();
  });

  it(
    "does not serialize the hidden sentinel into agent or exporter evidence",
    async () => {
      const workflow = await loadExample();
      const tools = new Map<string, WebMcpTool>();
      const handle = await exportAgentSurfaceToWebMcp(workflow.surface, {
        bindings: workflow.webMcpBindings,
        modelContext: {
          registerTool(tool, options) {
            tools.set(tool.name, tool);
            options.signal.addEventListener(
              "abort",
              () => tools.delete(tool.name),
              { once: true },
            );
          },
        },
      });
      const outcome = await workflow.runAgentWorkflow();
      const serialized = JSON.stringify({
        actionInput: { comment: "Reviewed against the signed agreement." },
        snapshot: outcome.initialSnapshot,
        result: outcome.result,
        audit: workflow.auditEvents,
        bindings: workflow.webMcpBindings,
        toolDescriptors: handle.toolDescriptors,
        toolObservations: handle.toolObservations,
        registeredTools: [...tools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        })),
      });

      expect(document.documentElement.innerHTML).toContain(
        "SECRET_SENTINEL_DO_NOT_EXPOSE",
      );
      expect(serialized).not.toContain("SECRET_SENTINEL_DO_NOT_EXPOSE");
      handle.dispose();
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

  it("rejects an invalid comment before the approval command runs", async () => {
    const workflow = await loadExample();
    document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      (input as HTMLInputElement).click();
    });
    const snapshot = workflow.surface.snapshot();

    await expect(workflow.surface.perform({
      ...approvalRequest(snapshot),
      input: { comment: "" },
    })).rejects.toBeInstanceOf(AgentInputValidationError);
    expect(workflow.approvalCount).toBe(0);
    expect(workflow.confirmationCount).toBe(0);
    expect(workflow.getDocumentState().status).toBe("pending");
  });

  it("rejects a stale revision before the approval command runs", async () => {
    const workflow = await loadExample();
    const stale = workflow.surface.snapshot();
    const identity = await workflow.surface.perform({
      surfaceId: stale.surfaceId,
      revision: stale.revision,
      elementId: "confirm-identity",
      action: "toggle",
    });
    await workflow.surface.perform({
      surfaceId: stale.surfaceId,
      revision: identity.revision,
      elementId: "accept-terms",
      action: "toggle",
    });

    await expect(
      workflow.surface.perform(approvalRequest(stale)),
    ).rejects.toBeInstanceOf(AgentStaleRevisionError);
    expect(workflow.approvalCount).toBe(0);
    expect(workflow.confirmationCount).toBe(0);
    expect(workflow.getDocumentState().status).toBe("pending");
  });

  it("replays a keyed approval without duplicating the business command", async () => {
    const workflow = await loadExample();
    document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      (input as HTMLInputElement).click();
    });
    const snapshot = workflow.surface.snapshot();
    const request = approvalRequest(snapshot);

    const first = await workflow.surface.perform(request);
    const replay = await workflow.surface.perform(request);

    expect(replay).toEqual(first);
    expect(workflow.approvalCount).toBe(1);
    expect(workflow.getDocumentState()).toEqual({
      documentId: "DOC-1042",
      status: "approved",
      commentAccepted: true,
    });
  });

  it("does not execute when trusted confirmation is declined", async () => {
    document.documentElement.innerHTML = await readFile(
      resolve(projectRoot, "examples", "document-approval", "index.html"),
      "utf8",
    );
    const workflow = createDocumentApprovalWorkflow({
      document,
      createAgentSurface,
      defineDomainElement,
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
      defineDomainElement,
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

  it("applies the same origin authorization rule to the human path", () => {
    document.documentElement.innerHTML = `
      <body>
        <input type="checkbox" data-agent-id="confirm-identity">
        <input type="checkbox" data-agent-id="accept-terms">
        <textarea id="approval-comment" data-agent-id="approval-comment">Reviewed</textarea>
        <button id="approve-document">Approve</button>
        <output data-agent-id="document-status">Pending</output>
      </body>
    `;
    const workflow = createDocumentApprovalWorkflow({
      document,
      createAgentSurface,
      defineDomainElement,
      allowedOrigin: "https://untrusted.example",
    });
    document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      (input as HTMLInputElement).click();
    });

    (document.querySelector("#approve-document") as HTMLButtonElement).click();

    expect(workflow.approvalCount).toBe(0);
    expect(workflow.getDocumentState().status).toBe("pending");
    expect(workflow.status.textContent).toBe("Approval is not authorized");
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
