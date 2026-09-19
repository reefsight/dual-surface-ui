import { mountDeclarativeWebMcpForm } from "/dist/webmcp/index.js";
import {
  encodeNativeExecuteInput,
  parseNativeExecuteResult,
} from "./native-api-compat.mjs";

const form = document.querySelector("#profile");
const displayName = document.querySelector("#display-name");
const biography = document.querySelector("#biography");
const status = document.querySelector("#native-declarative-status");
const modelContext = document.modelContext;

if (!modelContext || typeof modelContext.getTools !== "function") {
  throw new Error("Native WebMCP modelContext is unavailable");
}

let activationCount = 0;
let invocationError;
let invocationResult;
let submitCount = 0;
const activationSources = new Set();
addEventListener("toolactivated", () => {
  activationSources.add("window");
  activationCount += 1;
});
if (typeof modelContext.addEventListener === "function") {
  modelContext.addEventListener("toolactivated", () => {
    activationSources.add("modelContext");
    activationCount += 1;
  });
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCount += 1;
  const result = {
    displayName: displayName.value,
    status: "reviewed",
  };
  if (event.agentInvoked && typeof event.respondWith === "function") {
    event.respondWith(Promise.resolve(result));
  }
});

const handle = mountDeclarativeWebMcpForm({
  form,
  name: "profile.prepare",
  description: "Prepare the visible profile form for human review",
  fields: [
    { control: displayName, description: "Public display name" },
    { control: biography, description: "Public profile biography" },
  ],
});

async function catalog() {
  return (await modelContext.getTools()).map((tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
    origin: tool.origin,
  }));
}

async function activate() {
  const tool = (await modelContext.getTools()).find(
    (candidate) => candidate.name === "profile.prepare",
  );
  if (!tool) throw new Error("native declarative tool is unavailable");
  void modelContext.executeTool(tool, encodeNativeExecuteInput({
    biography: "A browser-native declarative evidence record",
    displayName: "Ada Lovelace",
  }))
    .then((result) => {
      invocationResult = parseNativeExecuteResult(result);
    })
    .catch((error) => {
      invocationError = error instanceof Error ? error.message : String(error);
    });
}

async function dispose() {
  handle.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    annotationsPresent: form.hasAttribute("toolname"),
    catalog: await catalog(),
  };
}

window.nativeDeclarativeEvidence = Object.freeze({
  activate,
  catalog,
  dispose,
  state: () => ({
    activationCount,
    activationSources: [...activationSources],
    biography: biography.value,
    displayName: displayName.value,
    invocationError,
    invocationResult,
    submitCount,
    toolAutoSubmit: form.hasAttribute("toolautosubmit"),
  }),
});
status.textContent = "READY: native declarative WebMCP form active";
document.documentElement.dataset.nativeDeclarativeWebMcp = "ready";
