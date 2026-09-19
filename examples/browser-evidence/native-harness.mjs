import { createAgentSurface } from "/dist/index.js";
import { defineDomainElement } from "/dist/domain/index.js";
import { exportAgentSurfaceToWebMcp } from "/dist/webmcp/index.js";
import {
  CHECKOUT_EMAIL,
  createCheckoutWorkflow,
} from "/examples/checkout/workflow.mjs";

const status = document.querySelector("#native-status");
const output = document.querySelector("#native-output");
const fixture = document.querySelector("#native-fixture");

async function loadCheckoutMarkup() {
  const response = await fetch("/examples/checkout/index.html", { cache: "no-store" });
  if (!response.ok) throw new Error("could not load checkout fixture");
  const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
  fixture.replaceChildren(...Array.from(parsed.body.childNodes));
}

function display(value) {
  output.textContent = JSON.stringify(value, null, 2);
  return value;
}

function nativeContext() {
  const context = document.modelContext;
  return context &&
    typeof context.registerTool === "function" &&
    typeof context.getTools === "function" &&
    typeof context.executeTool === "function"
    ? context
    : undefined;
}

function catalogRecord(tool) {
  return {
    annotations: tool.annotations,
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
    origin: tool.origin,
    title: tool.title,
  };
}

function parseNativeResult(value) {
  if (typeof value !== "string") {
    throw new TypeError("Native WebMCP executeTool returned a non-string result");
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError("Native WebMCP executeTool returned invalid JSON");
  }
}

try {
  await loadCheckoutMarkup();
  const modelContext = nativeContext();
  if (!modelContext) {
    status.textContent = "UNSUPPORTED: document.modelContext native APIs are unavailable";
    window.nativeWebMcpEvidence = Object.freeze({
      supported: false,
      reason: status.textContent,
    });
    document.documentElement.dataset.nativeWebMcp = "unsupported";
  } else {
    const workflow = createCheckoutWorkflow({
      document,
      createAgentSurface,
      defineDomainElement,
      exportAgentSurfaceToWebMcp,
      modelContext,
    });
    const handle = await workflow.webMcpHandle;
    let prepared = false;

    async function catalog() {
      return (await modelContext.getTools()).map(catalogRecord);
    }

    async function prepare() {
      if (!prepared) {
        await workflow.prepareAgentCheckout();
        await handle.refresh();
        prepared = true;
      }
      return {
        catalog: await catalog(),
        state: workflow.businessState(),
      };
    }

    async function invoke() {
      await prepare();
      const tools = await modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === "checkout.place_order");
      if (!tool) throw new Error("native checkout.place_order tool is unavailable");
      const result = parseNativeResult(await modelContext.executeTool(tool, {
        input: { shippingEmail: CHECKOUT_EMAIL },
        idempotencyKey: "ORDER-1001.native-browser.v1",
      }));
      return {
        catalog: await catalog(),
        result,
        state: workflow.businessState(),
      };
    }

    async function dispose() {
      handle.dispose();
      return { catalog: await catalog(), state: workflow.businessState() };
    }

    window.nativeWebMcpEvidence = Object.freeze({
      catalog,
      dispose,
      invoke,
      prepare,
      supported: true,
    });
    document.querySelector("#native-catalog").addEventListener("click", async () => display(await catalog()));
    document.querySelector("#native-prepare").addEventListener("click", async () => display(await prepare()));
    document.querySelector("#native-invoke").addEventListener("click", async () => display(await invoke()));
    document.querySelector("#native-dispose").addEventListener("click", async () => display(await dispose()));
    addEventListener("pagehide", () => handle.dispose(), { once: true });
    status.textContent = "READY: native WebMCP package registration active";
    document.documentElement.dataset.nativeWebMcp = "ready";
  }
} catch (error) {
  const message = error instanceof Error ? error.stack : String(error);
  window.nativeWebMcpEvidenceError = message;
  status.textContent = "FAILED";
  output.textContent = message;
  document.documentElement.dataset.nativeWebMcp = "failed";
}
