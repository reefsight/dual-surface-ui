import { createAgentSurface } from "/dist/index.js";
import { exportAgentSurfaceToWebMcp } from "/dist/webmcp/index.js";

const modelContext = document.modelContext;
if (!modelContext || typeof modelContext.getTools !== "function") {
  throw new Error("Native WebMCP modelContext is unavailable in child frame");
}

const surface = createAgentSurface({
  root: document.querySelector("#child-root"),
  surfaceId: "native-frame-child",
});
surface.register(document.querySelector("#child-control"), {
  id: "child-control",
  actions: {
    inspect: {
      description: "Inspect the isolated child frame",
      handler: () => ({ frame: "child" }),
      risk: "read",
    },
  },
});
let handle;
let registrationError;
try {
  handle = await exportAgentSurfaceToWebMcp(surface, {
    document,
    modelContext,
    bindings: [{
      action: "inspect",
      description: "Inspect the isolated child frame",
      elementId: "child-control",
      name: "frame.inspect_child",
    }],
  });
} catch (error) {
  registrationError = {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "UnknownError",
  };
}

window.nativeFrameEvidence = Object.freeze({
  async catalog() {
    try {
      return { names: (await modelContext.getTools()).map((tool) => tool.name) };
    } catch (error) {
      return {
        rejected: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "UnknownError",
        },
      };
    }
  },
  dispose: () => handle?.dispose(),
  registrationError,
});
addEventListener("pagehide", () => handle?.dispose(), { once: true });
document.documentElement.dataset.nativeFrameWebMcp = handle ? "ready" : "blocked";
