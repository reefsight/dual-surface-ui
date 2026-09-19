const DOCUMENT_ID = "DOC-1042";
const APPROVAL_COMMENT = "Reviewed against the signed agreement.";

export const EXPECTED_AGENT_STEPS = [
  "observe",
  "confirm_identity",
  "accept_terms",
  "approve_document",
];

export function installWindowGlobals(window) {
  for (const name of [
    "Document",
    "Element",
    "Event",
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLDetailsElement",
    "HTMLFormElement",
    "HTMLImageElement",
    "HTMLInputElement",
    "HTMLOptGroupElement",
    "HTMLOptionElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "HTMLElement",
    "Node",
  ]) {
    globalThis[name] = window[name];
  }
  globalThis.document = window.document;
}

export function createDocumentApprovalWorkflow({
  document,
  createAgentSurface,
  defineDomainElement,
  confirmApproval = true,
  principal = { id: "reviewer-7", roles: ["reviewer"] },
  allowedOrigin = document.location.origin,
}) {
  if (typeof defineDomainElement !== "function") {
    throw new TypeError("Document approval requires defineDomainElement");
  }
  const approveButton = document.querySelector("#approve-document");
  const comment = document.querySelector("#approval-comment");
  const identity = document.querySelector('[data-agent-id="confirm-identity"]');
  const terms = document.querySelector('[data-agent-id="accept-terms"]');
  const status = document.querySelector('[data-agent-id="document-status"]');
  if (!approveButton || !comment || !identity || !terms || !status) {
    throw new Error("Document approval fixture is incomplete");
  }

  const auditEvents = [];
  const documentRecord = {
    documentId: DOCUMENT_ID,
    status: "pending",
    commentAccepted: false,
  };
  let approvalCount = 0;
  let confirmationCount = 0;
  let correlationSequence = 0;

  const widgetsComplete = () => identity.checked && terms.checked;
  const isAuthorized = () =>
    principal?.roles?.includes("reviewer") &&
    document.location.origin === allowedOrigin;
  const evaluatePolicy = ({ activePrincipal, risk, origin }) => {
    if (
      !isAuthorized() ||
      activePrincipal?.id !== principal.id ||
      origin !== document.location.origin
    ) {
      return { outcome: "deny" };
    }
    return risk === "consequential"
      ? { outcome: "require_confirmation" }
      : { outcome: "allow" };
  };
  const approveDocument = (approvalComment) => {
    if (!isAuthorized()) throw new Error("Approval is not authorized");
    if (!widgetsComplete()) throw new Error("Required widgets are incomplete");
    approvalCount += 1;
    documentRecord.status = "approved";
    documentRecord.commentAccepted = approvalComment.length > 0;
    status.textContent = "Approved";
    approveButton.disabled = true;
    return {
      ...documentRecord,
    };
  };

  approveButton.addEventListener("click", () => {
    if (!isAuthorized()) {
      status.textContent = "Approval is not authorized";
      return;
    }
    if (!widgetsComplete()) {
      status.textContent = "Complete all required widgets";
      return;
    }
    approveDocument(comment.value);
  });

  const surface = createAgentSurface({
    root: approveButton.closest("main") ?? document.body,
    surfaceId: "document-approval-example",
    getPrincipal: () => principal,
    policy: ({ principal: activePrincipal, risk, origin }) =>
      evaluatePolicy({ activePrincipal, risk, origin }),
    confirm: () => {
      confirmationCount += 1;
      return confirmApproval;
    },
    checkPrecondition: ({ precondition }) =>
      precondition === "required_widgets_complete" && widgetsComplete(),
    verifyEffect: ({ effect }) =>
      effect === "document_approved" && documentRecord.status === "approved",
    createCorrelationId: () => `approval-${++correlationSequence}`,
    onAudit: (event) => auditEvents.push(event),
  });

  const approval = defineDomainElement({
    id: "approve-document",
    description: "Approve DOC-1042 after every required widget is complete",
    actions: {
      approve_document: {
        description: "Approve the current document with a reviewer comment",
        risk: "consequential",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            comment: { type: "string", minLength: 1, maxLength: 500 },
          },
          required: ["comment"],
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            documentId: { type: "string", const: DOCUMENT_ID },
            status: { type: "string", const: "approved" },
            commentAccepted: { type: "boolean", const: true },
          },
          required: ["documentId", "status", "commentAccepted"],
        },
        preconditions: ["required_widgets_complete"],
        effects: ["document_approved"],
        requiresConfirmation: true,
        idempotency: "keyed",
        webMcpName: "documents.approve",
        handler: (input) => approveDocument(input.comment),
      },
    },
  });
  surface.register(approveButton, approval.definition);

  async function runAgentWorkflow() {
    const steps = [];
    const initialSnapshot = surface.snapshot();
    steps.push(EXPECTED_AGENT_STEPS[0]);
    let revision = initialSnapshot.revision;

    for (const [elementId, step] of [
      ["confirm-identity", EXPECTED_AGENT_STEPS[1]],
      ["accept-terms", EXPECTED_AGENT_STEPS[2]],
    ]) {
      const result = await surface.perform({
        surfaceId: initialSnapshot.surfaceId,
        revision,
        elementId,
        action: "toggle",
      });
      revision = result.revision;
      steps.push(step);
    }

    const result = await surface.perform({
      surfaceId: initialSnapshot.surfaceId,
      revision,
      elementId: "approve-document",
      action: "approve_document",
      input: { comment: APPROVAL_COMMENT },
      idempotencyKey: "DOC-1042.approve.v1",
    });
    steps.push(EXPECTED_AGENT_STEPS[3]);

    return { initialSnapshot, result, steps };
  }

  async function runWebMcpAgentWorkflow({
    exportAgentSurfaceToWebMcp,
    modelContext,
  }) {
    if (typeof exportAgentSurfaceToWebMcp !== "function") {
      throw new TypeError("WebMCP workflow requires exportAgentSurfaceToWebMcp");
    }
    const activeTools = new Map();
    const registrations = [];
    const capturingModelContext = {
      async registerTool(tool, options) {
        await modelContext?.registerTool(tool, options);
        activeTools.set(tool.name, tool);
        registrations.push({ tool, signal: options.signal });
        options.signal.addEventListener(
          "abort",
          () => activeTools.delete(tool.name),
          { once: true },
        );
      },
    };
    const exporter = await exportAgentSurfaceToWebMcp(surface, {
      bindings: approval.webMcpBindings,
      modelContext: capturingModelContext,
    });
    try {
      const steps = [];
      const initialSnapshot = surface.snapshot();
      steps.push(EXPECTED_AGENT_STEPS[0]);
      let revision = initialSnapshot.revision;
      for (const [elementId, step] of [
        ["confirm-identity", EXPECTED_AGENT_STEPS[1]],
        ["accept-terms", EXPECTED_AGENT_STEPS[2]],
      ]) {
        const result = await surface.perform({
          surfaceId: initialSnapshot.surfaceId,
          revision,
          elementId,
          action: "toggle",
        });
        revision = result.revision;
        steps.push(step);
      }
      await exporter.refresh();
      const tool = activeTools.get("documents.approve");
      if (!tool) throw new Error("Approval WebMCP tool is unavailable");
      const result = await tool.execute({
        input: { comment: APPROVAL_COMMENT },
        idempotencyKey: "DOC-1042.approve.webmcp.v1",
      });
      steps.push(EXPECTED_AGENT_STEPS[3]);
      return {
        initialSnapshot,
        result,
        steps,
        registrations: registrations.length,
        invokedTool: tool.name,
      };
    } finally {
      exporter.dispose();
    }
  }

  function runHumanWorkflow() {
    const steps = [];
    identity.click();
    steps.push("confirm_identity");
    terms.click();
    steps.push("accept_terms");
    comment.value = APPROVAL_COMMENT;
    comment.dispatchEvent(new Event("input", { bubbles: true }));
    steps.push("enter_comment");
    approveButton.click();
    steps.push("approve_document");
    return { steps, status: status.textContent };
  }

  const readPermission = ({ action }) => {
    const semanticAction = surface.snapshot().nodes
      .flatMap((node) => node.actions)
      .find((item) => item.name === action);
    if (!semanticAction) return undefined;
    const decision = evaluatePolicy({
      activePrincipal: principal,
      risk: semanticAction.risk,
      origin: document.location.origin,
    }).outcome;
    return decision === "require_confirmation" ? "require-confirmation" : decision;
  };

  return {
    auditEvents,
    get approvalCount() {
      return approvalCount;
    },
    get confirmationCount() {
      return confirmationCount;
    },
    getDocumentState() {
      return { ...documentRecord };
    },
    readPermission,
    runAgentWorkflow,
    runHumanWorkflow,
    runWebMcpAgentWorkflow,
    status,
    surface,
    webMcpBindings: approval.webMcpBindings,
  };
}
