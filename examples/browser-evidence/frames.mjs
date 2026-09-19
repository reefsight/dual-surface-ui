import { createAgentSurface } from "/dist/index.js";

const parameters = new URL(location.href).searchParams;
const childOrigin = parameters.get("childOrigin") ?? location.origin;
const mode = parameters.get("mode") ?? "imperative";
const frame = document.querySelector("#evidence-frame");
frame.src = `${childOrigin}/examples/browser-evidence/frame.html?mode=${encodeURIComponent(mode)}`;

const surface = createAgentSurface({
  root: document.querySelector("#parent-root"),
  surfaceId: "frame-parent",
});

window.browserEvidence = {
  parentSnapshot: () => surface.snapshot(),
};
document.documentElement.dataset.browserEvidence = "ready";
