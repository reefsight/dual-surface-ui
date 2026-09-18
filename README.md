# Dual Surface UI

> Project status: documentation-first exploratory prototype. The public API is
> not stable. Read the [master plan](PLAN.md) and [documentation index](docs/README.md)
> before implementing or adopting it.

Dual Surface UI keeps the interface humans see unchanged while exposing a
compact, stateful, and actionable semantic representation for AI agents.

It is a framework-agnostic TypeScript proof of concept. The package derives its
agent view from the live DOM and accessibility semantics, then lets an app add
stable IDs, domain-specific actions, descriptions, and risk metadata.

## Why

Screenshot-only computer use is flexible, but an agent has to infer labels,
state, and click targets from pixels. DOM-only automation is precise, but often
contains large amounts of styling and implementation detail. Dual Surface UI
provides the smaller contract an agent actually needs:

```json
{
  "id": "confirm-order",
  "role": "button",
  "name": "Place order",
  "description": "Confirm and submit the current order",
  "state": { "disabled": false },
  "actions": [{ "name": "confirm_order", "risk": "consequential" }]
}
```

The human interface and agent interface share the same DOM and application
state, avoiding a second hidden page that can drift away from what the user
sees.

## Install

```bash
npm install dual-surface-ui
```

The package name was available when this prototype was created, but registry
availability must be checked again immediately before publishing.

## Basic usage

```ts
import { createAgentSurface } from "dual-surface-ui";

const surface = createAgentSurface({
  authorize: async ({ risk, element, action }) => {
    if (risk === "read") return true;
    return window.confirm(`Allow ${action} on ${element.name}?`);
  },
});

const button = document.querySelector("#place-order")!;

surface.register(button, {
  id: "confirm-order",
  description: "Confirm and submit the current order",
  actions: {
    confirm_order: {
      description: "Submit the order for payment",
      risk: "consequential",
      handler: async () => {
        await submitOrder();
      },
    },
  },
});

// Give this JSON to an agent through an API, MCP server, or browser extension.
const snapshot = surface.snapshot();
console.log(snapshot);

// Execute the agent's structured request through the same safety boundary.
await surface.perform({
  surfaceId: snapshot.surfaceId,
  revision: snapshot.revision,
  elementId: "confirm-order",
  action: "confirm_order",
});
```

Snapshots conform to the published `0.1` JSON Schema in
`schemas/agent-snapshot-0.1.schema.json`. The schema includes a surface ID,
revision, capabilities, semantic nodes, and typed action metadata. Sensitive
fields expose only whether a value is present.

Standard controls work without registration. Inputs, selects, textareas,
buttons, and links receive generated IDs and inferred actions. Inferred write
actions require an `authorize` callback; without approval they fail closed.

## Design principles

- One state, two representations: never maintain a separate hidden AI page.
- Accessibility first: reuse roles, labels, values, and states already present
  in the application.
- Stable domain actions: prefer `confirm_order` over raw screen coordinates.
- Fail closed: write, consequential, credential, and destructive actions require
  authorization.
- Secret-safe snapshots: password and `data-agent-sensitive="true"` values are
  never serialized; agents can only see whether a value is present.
- Reject stale actions: requests bind to the observed surface and revision.
- Verify after acting: `perform()` returns a versioned result with the updated
  revision and target node when it is still present.
- Vision remains a fallback for canvas, charts, maps, and unannotated legacy UI.

## Prototype scope

Included:

- Semantic snapshots from a live browser DOM
- Accessible names and common implicit roles
- Stable agent element IDs
- Duplicate-ID detection and semantic revision tracking
- Inferred native actions for standard controls
- Custom domain actions
- Action risk metadata and authorization hook
- Updated state returned after every action

Not included yet:

- MCP or HTTP transport
- React/Vue/Svelte adapters
- Mutation-stream or incremental snapshots
- JSON Schema validation for action inputs
- Screenshot alignment and visual verification
- Shadow DOM, iframe, canvas, or native desktop adapters

## Suggested roadmap

1. Add a local MCP server exposing `snapshot` and `perform` tools.
2. Add a browser extension so an agent can discover enabled pages.
3. Add React helpers and input schemas for typed domain actions.
4. Stream DOM mutations instead of sending a complete tree each turn.
5. Merge semantic nodes with screenshot bounds and vision fallbacks.
6. Define adapters for Windows UI Automation and mobile semantics trees.

## Development

```bash
npm install
npm test
npm run build
```
