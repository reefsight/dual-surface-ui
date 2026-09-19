export const CHECKOUT_EMAIL = "buyer@example.test";
export const PAYMENT_SECRET_SENTINEL = "PAYMENT_SECRET_SENTINEL_4242";
export const EXPECTED_CHECKOUT_STEPS = [
  "observe",
  "enter_shipping_email",
  "accept_terms",
  "place_order",
];

const ORDER_ID = "ORDER-1001";
const TOTAL_CENTS = 4250;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function createCheckoutWorkflow({
  document,
  createAgentSurface,
  defineDomainElement,
  exportAgentSurfaceToWebMcp,
  modelContext,
  confirmOrder = true,
  principal = { id: "buyer-17", roles: ["buyer"] },
  allowedOrigin = document.location.origin,
  verifyOrderEffect = true,
}) {
  if (typeof defineDomainElement !== "function") {
    throw new TypeError("Checkout requires defineDomainElement");
  }
  if (typeof exportAgentSurfaceToWebMcp !== "function") {
    throw new TypeError("Checkout requires exportAgentSurfaceToWebMcp");
  }
  const email = document.querySelector("#shipping-email");
  const payment = document.querySelector("#payment-token");
  const terms = document.querySelector('[data-agent-id="accept-checkout-terms"]');
  const placeOrderButton = document.querySelector("#place-order");
  const status = document.querySelector('[data-agent-id="checkout-status"]');
  const receipt = document.querySelector('[data-agent-id="order-receipt"]');
  const agentRoot = document.querySelector("#checkout-agent-surface");
  if (!email || !payment || !terms || !placeOrderButton || !status || !receipt || !agentRoot) {
    throw new Error("Checkout fixture is incomplete");
  }

  const auditEvents = [];
  const state = {
    inventoryRemaining: 1,
    order: undefined,
  };
  let commandExecutions = 0;
  let confirmationCount = 0;
  let policyChecks = 0;
  let verificationCount = 0;
  let correlationSequence = 0;

  const isAuthorized = () =>
    principal?.roles?.includes("buyer") &&
    document.location.origin === allowedOrigin;
  const evaluatePolicy = ({ currentPrincipal, risk, origin }) => {
    if (!isAuthorized() || currentPrincipal?.id !== principal.id) {
      return { outcome: "deny" };
    }
    if (origin !== document.location.origin) return { outcome: "deny" };
    return risk === "consequential"
      ? { outcome: "require_confirmation" }
      : { outcome: "allow" };
  };
  const isReady = (shippingEmail) =>
    isAuthorized() &&
    EMAIL_PATTERN.test(shippingEmail) &&
    email.value === shippingEmail &&
    terms.checked &&
    payment.value.length > 0 &&
    state.inventoryRemaining > 0 &&
    state.order === undefined;

  // This is the single business command used by both the human UI and agent.
  const placeOrder = ({ shippingEmail }) => {
    if (!isAuthorized()) throw new Error("Checkout is not authorized");
    if (!isReady(shippingEmail)) throw new Error("Checkout is not ready");
    commandExecutions += 1;
    state.inventoryRemaining -= 1;
    state.order = {
      orderId: ORDER_ID,
      status: "placed",
      totalCents: TOTAL_CENTS,
      shippingEmail,
    };
    status.textContent = "Order placed";
    receipt.textContent = `${ORDER_ID} · $42.50`;
    placeOrderButton.disabled = true;
    return {
      orderId: ORDER_ID,
      status: "placed",
      totalCents: TOTAL_CENTS,
      inventoryRemaining: state.inventoryRemaining,
    };
  };

  const requestConfirmation = () => {
    confirmationCount += 1;
    return confirmOrder;
  };

  placeOrderButton.addEventListener("click", () => {
    if (!isAuthorized()) {
      status.textContent = "Checkout is not authorized";
      return;
    }
    if (!isReady(email.value)) {
      status.textContent = "Complete checkout details";
      return;
    }
    if (!requestConfirmation()) {
      status.textContent = "Confirmation required";
      return;
    }
    placeOrder({ shippingEmail: email.value });
  });

  const surface = createAgentSurface({
    root: agentRoot,
    surfaceId: "checkout-example",
    getPrincipal: () => principal,
    policy: ({ principal: currentPrincipal, risk, origin }) => {
      policyChecks += 1;
      return evaluatePolicy({ currentPrincipal, risk, origin });
    },
    confirm: requestConfirmation,
    checkPrecondition: ({ precondition, input }) =>
      precondition === "checkout_ready" && isReady(input.shippingEmail),
    verifyEffect: ({ effect }) => {
      verificationCount += 1;
      return verifyOrderEffect &&
        effect === "order_created" &&
        state.order?.status === "placed";
    },
    createCorrelationId: () => `checkout-${++correlationSequence}`,
    onAudit: (event) => auditEvents.push(event),
  });

  const checkout = defineDomainElement({
    id: "place-order",
    description: "Place the reviewed checkout order using the saved payment credential",
    actions: {
      place_order: {
        description: "Place the current cart for the visible shipping email",
        risk: "consequential",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            shippingEmail: {
              type: "string",
              minLength: 3,
              maxLength: 254,
              pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
            },
          },
          required: ["shippingEmail"],
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            orderId: { type: "string", const: ORDER_ID, maxLength: 64 },
            status: { type: "string", const: "placed", maxLength: 16 },
            totalCents: { type: "integer", const: TOTAL_CENTS },
            inventoryRemaining: { type: "integer", minimum: 0 },
          },
          required: ["orderId", "status", "totalCents", "inventoryRemaining"],
        },
        preconditions: ["checkout_ready"],
        effects: ["order_created"],
        requiresConfirmation: true,
        idempotency: "keyed",
        webMcpName: "checkout.place_order",
        handler: (input) => placeOrder(input),
      },
    },
  });
  surface.register(placeOrderButton, checkout.definition);

  const activeTools = new Map();
  const registrations = [];
  const capturingModelContext = {
    async registerTool(tool, options) {
      await modelContext?.registerTool(tool, options);
      activeTools.set(tool.name, tool);
      registrations.push({ tool, signal: options.signal });
      options.signal.addEventListener("abort", () => activeTools.delete(tool.name), {
        once: true,
      });
    },
  };
  const webMcpHandlePromise = exportAgentSurfaceToWebMcp(surface, {
    bindings: checkout.webMcpBindings,
    modelContext: capturingModelContext,
  });
  async function prepareAgentCheckout() {
    const initialSnapshot = surface.snapshot();
    let revision = initialSnapshot.revision;
    const emailResult = await surface.perform({
      surfaceId: initialSnapshot.surfaceId,
      revision,
      elementId: "shipping-email",
      action: "set_value",
      input: CHECKOUT_EMAIL,
    });
    revision = emailResult.revision;
    const termsResult = await surface.perform({
      surfaceId: initialSnapshot.surfaceId,
      revision,
      elementId: "accept-checkout-terms",
      action: "toggle",
    });
    return { initialSnapshot, revision: termsResult.revision };
  }

  async function runAgentWorkflow() {
    const webMcpHandle = await webMcpHandlePromise;
    const prepared = await prepareAgentCheckout();
    await webMcpHandle.refresh();
    const tool = activeTools.get("checkout.place_order");
    if (!tool) throw new Error("Checkout WebMCP tool is unavailable");
    const result = await tool.execute({
      input: { shippingEmail: CHECKOUT_EMAIL },
      idempotencyKey: "ORDER-1001.place.v1",
    });
    return {
      initialSnapshot: prepared.initialSnapshot,
      result,
      steps: [...EXPECTED_CHECKOUT_STEPS],
    };
  }

  function runHumanWorkflow() {
    email.value = CHECKOUT_EMAIL;
    email.dispatchEvent(new Event("input", { bubbles: true }));
    terms.click();
    placeOrderButton.click();
    return {
      steps: ["enter_shipping_email", "accept_terms", "place_order"],
      order: state.order ? { ...state.order } : undefined,
    };
  }

  const businessState = () => ({
    inventoryRemaining: state.inventoryRemaining,
    order: state.order ? { ...state.order } : undefined,
    status: status.textContent,
    receipt: receipt.textContent,
  });

  const readPermission = ({ action }) => {
    const semanticAction = surface.snapshot().nodes
      .flatMap((node) => node.actions)
      .find((item) => item.name === action);
    if (!semanticAction) return undefined;
    const decision = evaluatePolicy({
      currentPrincipal: principal,
      risk: semanticAction.risk,
      origin: document.location.origin,
    }).outcome;
    return decision === "require_confirmation" ? "require-confirmation" : decision;
  };

  return {
    auditEvents,
    activeTools,
    businessState,
    email,
    payment,
    placeOrderButton,
    prepareAgentCheckout,
    receipt,
    readPermission,
    runAgentWorkflow,
    runHumanWorkflow,
    status,
    surface,
    terms,
    registrations,
    webMcpBindings: checkout.webMcpBindings,
    webMcpHandle: webMcpHandlePromise,
    get commandExecutions() {
      return commandExecutions;
    },
    get confirmationCount() {
      return confirmationCount;
    },
    get policyChecks() {
      return policyChecks;
    },
    get verificationCount() {
      return verificationCount;
    },
  };
}
