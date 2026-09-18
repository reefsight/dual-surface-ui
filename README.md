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
  surfaceId: "checkout",
  getPrincipal: () => ({ id: currentUser.id, roles: currentUser.roles }),
  onAudit: (event) => auditSink.write(event),
  policy: async ({ principal, risk }) => {
    if (!principal) return { outcome: "deny" };
    if (risk === "read") return { outcome: "allow" };
    return { outcome: "require_confirmation" };
  },
  confirm: async ({ action, element }) =>
    window.confirm(`Allow ${action} on ${element.name}?`),
  checkPrecondition: ({ precondition }) =>
    precondition === "order_is_ready" && orderStore.isReady(),
  verifyEffect: ({ effect }) =>
    effect === "order_submitted" && orderStore.isSubmitted(),
});

const button = document.querySelector("#place-order")!;

surface.register(button, {
  id: "confirm-order",
  description: "Confirm and submit the current order",
  actions: {
    confirm_order: {
      description: "Submit the order for payment",
      risk: "consequential",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { orderId: { type: "string" } },
        required: ["orderId"],
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          orderId: { type: "string" },
          accepted: { type: "boolean" },
        },
        required: ["orderId", "accepted"],
      },
      preconditions: ["order_is_ready"],
      effects: ["order_submitted"],
      idempotency: "keyed",
      handler: async () => {
        const order = await submitOrder();
        return { orderId: order.id, accepted: true };
      },
    },
  },
});

// Give this JSON to an agent through an API, MCP server, or browser extension.
const snapshot = surface.snapshot();
console.log(snapshot);

// Execute the agent's structured request through the same safety boundary.
const outcome = await surface.performSafe({
  surfaceId: snapshot.surfaceId,
  revision: snapshot.revision,
  elementId: "confirm-order",
  action: "confirm_order",
  input: { orderId: "order-123" },
  idempotencyKey: "order-123.submit-1",
});
if (outcome.status === "succeeded") console.log(outcome.output);
else console.error(outcome.error.code);
```

### Optional WebMCP imperative adapter

Supported experimental browsers can discover an explicit subset of the same
surface through the additive `dual-surface-ui/webmcp` entry point:

```ts
import { exportAgentSurfaceToWebMcp } from "dual-surface-ui/webmcp";

const webMcp = await exportAgentSurfaceToWebMcp(surface, {
  bindings: [
    {
      name: "checkout.confirm_order",
      description: "Submit the reviewed order for payment",
      elementId: "confirm-order",
      action: "confirm_order",
    },
  ],
});

if (!webMcp.supported) {
  console.info("This browser does not expose the WebMCP imperative API");
}

// Re-register against a new semantic revision after an application transition.
await webMcp.refresh();

// Unregister every tool owned by this adapter during unmount/navigation.
webMcp.dispose();
```

Bindings are an allowlist: names and descriptions must be trusted application
metadata, never page or user text. The adapter never exports credential-risk
actions, never enables cross-origin exposure, and never bypasses the core
policy, confirmation, validation, replay, or effect-verification boundary.
Calls use `{ input, idempotencyKey }`; `input` wraps the action's declared
schema and `idempotencyKey` is present only for keyed actions. An unsupported
browser takes a no-op path—there is no hidden automation fallback.

For simple forms, the same optional subpath can mount native declarative
annotations as a reversible progressive enhancement:

```ts
import { mountDeclarativeWebMcpForm } from "dual-surface-ui/webmcp";

const declarative = mountDeclarativeWebMcpForm({
  form: document.querySelector("#profile")!,
  name: "profile.update",
  description: "Prepare the visible profile form for human review",
  fields: [
    {
      control: document.querySelector("#display-name")!,
      description: "Public display name",
    },
  ],
});

// On unmount, restore every annotation to its exact previous state.
declarative.dispose();
```

This compatibility layer intentionally does not enable `toolautosubmit`, infer
descriptions from page text, or pretend to detect native declarative support
reliably. The current draft still leaves portable schema synthesis unfinished.
Applications must explicitly choose either these inert-safe native annotations,
the imperative `performSafe()` path above, or the ordinary human-only form;
the package never registers both automatically.

### React lifecycle adapter

React 18.2 and 19 applications can keep surface creation and security policy at
the application boundary, then bind explicit definitions with a ref:

```tsx
import { useMemo } from "react";
import {
  AgentSurfaceProvider,
  useAgentElement,
} from "dual-surface-ui/react";

function ConfirmButton() {
  const definition = useMemo(() => ({
    id: "confirm-order",
    actions: {
      confirm_order: {
        risk: "consequential" as const,
        effects: ["order_submitted"],
        handler: submitOrder,
      },
    },
  }), []);
  const ref = useAgentElement<HTMLButtonElement>(definition);
  return <button ref={ref}>Confirm order</button>;
}

root.render(
  <AgentSurfaceProvider surface={surface}>
    <ConfirmButton />
  </AgentSurfaceProvider>,
);
```

The provider accepts an already configured surface. The adapter registers only
committed DOM refs and calls the exact core disposer on ref replacement or
unmount. It contains no policy, action execution, schema inference, DOM-text
extraction, snapshot subscription, or automatic WebMCP export. Memoize
definitions to avoid safe but unnecessary unregister/register churn.

### Angular lifecycle adapter

Angular 20–22 applications can provide an application-owned surface and bind
an explicit definition to a rendered host with a standalone directive:

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import type { AgentElementDefinition } from "dual-surface-ui";
import {
  AgentElementDirective,
  provideAgentSurface,
} from "dual-surface-ui/angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [AgentElementDirective],
  templateUrl: "./app.html",
})
class AppComponent {
  readonly confirmDefinition: AgentElementDefinition = {
    id: "confirm-order",
    actions: {
      confirm_order: {
        risk: "consequential",
        effects: ["order_submitted"],
        handler: submitOrder,
      },
    },
  };
}

bootstrapApplication(AppComponent, {
  providers: [provideAgentSurface(surface)],
});
```

```html
<button [dualSurfaceAgentElement]="confirmDefinition">
  Confirm order
</button>
```

The adapter is limited to Angular dependency injection and lifecycle cleanup;
core remains responsible for policy and execution. It is verified with
zoneless lifecycle tests, server rendering, partial-Ivy output, and packed
Angular 20 and Angular 22 AOT consumers. Browser hydration has not been tested
and no hydration compatibility claim is made.

### Vue lifecycle adapter

Vue 3.3–3.5 applications can provide an existing surface through a plugin and
bind an explicit definition with a native template ref:

```vue
<script setup lang="ts">
import { shallowRef } from "vue";
import type { AgentElementDefinition } from "dual-surface-ui";
import { useAgentElement } from "dual-surface-ui/vue";

const definition = shallowRef<AgentElementDefinition>({
  id: "confirm-order",
  actions: {
    confirm_order: {
      risk: "consequential",
      effects: ["order_submitted"],
      handler: submitOrder,
    },
  },
});

const agentElement = useAgentElement<HTMLButtonElement>(definition);
</script>

<template>
  <button ref="agentElement" @click="submitOrder">
    Confirm order
  </button>
</template>
```

```ts
import { createApp } from "vue";
import { createAgentSurfacePlugin } from "dual-surface-ui/vue";
import App from "./App.vue";

createApp(App)
  .use(createAgentSurfacePlugin(surface))
  .mount("#app");
```

The adapter owns only Vue provider and ref lifecycle. It disposes bindings on
unmount and `KeepAlive` deactivation; core still owns validation, policy,
confirmation, replay protection, execution, and verification. Replace the
definition object to update semantics rather than mutating it in place.

The adapter is verified with Vue 3.5 lifecycle/KeepAlive tests, real Node SSR,
SSR-to-client hydration, and packed Vue 3.3.13 and 3.5.43 SFC consumers.

Snapshots conform to the published `0.1` JSON Schema in
`schemas/agent-snapshot-0.1.schema.json`. The schema includes a surface ID,
revision, capabilities, semantic nodes, and typed action metadata. Sensitive
fields expose only whether a value is present.

Audit events conform to `schemas/agent-audit-event-0.1.schema.json`. Enabling
`onAudit` requires an explicit opaque URL-safe `surfaceId`; raw page URLs,
request data, results, principals, and exception details are not event fields.
The observer is best effort, so durable delivery remains the host's job.

Standard controls work without registration. Inputs, selects, textareas,
buttons, and links receive generated IDs and inferred actions. Inferred write
actions require an explicit policy decision; without a policy or legacy
`authorize` callback they fail closed. Actions can require trusted host
confirmation, and the runtime rechecks the surface revision immediately before
execution.

Hidden and inert subtrees are omitted. Disabled controls remain observable but
publish no actions. Selects expose enabled choices through `select`, while forms
use native `submit`; both must pass the same policy and post-action verification
boundary as every other mutation.

## Reference workflow and Phase 1 baseline

The document-approval example demonstrates one human-visible state shared by a
normal click path and an agent path with typed actions, policy, confirmation,
preconditions, effect verification, idempotency, and redacted audit events.

```bash
npm run example:document-approval
npm run baseline:phase1
```

The baseline is a deterministic 25-run scripted measurement, not a model or
vision evaluation. It records completion, interaction steps, latency, safety
counters, and a clearly labeled provider-neutral context-token estimate. See
`docs/adr/0005-phase1-baseline-method.md` before comparing its numbers.

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
- Deduplicate retries: keyed actions bind an opaque idempotency key to the
  principal, origin, revision, action, and canonical JSON input.
- Validate before acting: declared JSON Schemas reject invalid input before
  authorization or handler execution.
- Verify after acting: `perform()` returns a versioned result with the updated
  revision and target node only after declared effects or deterministic native
  state transitions are verified.
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
- Runtime JSON Schema validation and stable typed error codes
- Deterministic allow/deny/confirmation policy boundary
- Execution-time preconditions and authoritative effect verification
- JSON-safe handler output validation against declared schemas
- Surface-local keyed replay protection with bounded result caching
- Opt-in structured failure results with fixed secret-safe messages
- Redacted, correlated lifecycle events for observation and action execution
- Updated state returned after every action
- Optional allowlisted WebMCP imperative export with revision-bound execution
- Optional React 18.2/19 provider and committed-ref lifecycle bindings
- Optional Vue 3.3–3.5 plugin and template-ref lifecycle binding

Not included yet:

- MCP or HTTP transport
- WebMCP declarative autosubmit, synthetic polyfill, or cross-origin exposure
- Svelte adapter
- Mutation-stream or incremental snapshots
- Durable audit storage, delivery retries, and retention policy
- Persistent or distributed idempotency storage
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
