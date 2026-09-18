# Product Scope and Positioning

Status: Accepted at Gate 0 on 2026-09-18

## Positioning

Dual Surface UI is not another browser-driving agent. It is an application-side
compatibility, safety, and conformance layer for agent-ready interfaces.

| Existing category | Strength | Project relationship |
|---|---|---|
| Vision computer use | Works without site cooperation | Last-resort fallback |
| Accessibility snapshots | Compact roles, names, and state | Semantic input |
| Playwright/MCP automation | Deterministic browser control | External fallback/export |
| WebMCP | Browser-native structured site tools | Primary web export target |
| MCP | Cross-platform tools and resources | Remote/local transport target |
| Stagehand-style agents | Natural-language browser workflows | Potential consumer, not competitor |

## Differentiated value

1. **Migration compiler:** derive safe starting contracts from existing DOM and
   accessibility semantics, then enrich them with domain annotations.
2. **One definition, multiple exports:** WebMCP, MCP, testing, documentation,
   and native adapters consume the same core contract.
3. **Policy by construction:** risk, consent, origin, role, redaction, and
   verification are part of the action contract rather than model prompts.
4. **Drift detection:** verify that tools, visible controls, application state,
   and permissions remain consistent.
5. **Agent eval toolkit:** test discovery, selection, arguments, refusal,
   execution, and outcome verification separately.
6. **Legacy-to-native path:** support unmodified controls first and allow teams
   to adopt explicit business actions incrementally.

## Editions and deliverables

The initial project is an MIT-licensed SDK and CLI. A future hosted or
enterprise product may add fleet policy, centralized audit, dashboards, and
managed evaluation, but the open core contract remains portable.

## Supported surfaces by phase

| Surface | Phase | Support level |
|---|---:|---|
| Standards-compliant HTML controls | 1 | Reference |
| Custom web controls with ARIA | 1 | Reference |
| WebMCP imperative/declarative tools | 2 | First-class |
| React, Angular, Vue | 2 | Framework adapters |
| Browser automation fallback | 3 | Playwright adapter |
| MCP clients | 3 | Tool/resource export |
| Windows desktop | 4 | First native target |
| macOS desktop | 4 | Second native target |
| Android/iOS | Post-Phase 4 evaluation | Research only |

## Adoption modes

- Observe only: snapshots and conformance diagnostics; no execution.
- Assisted: safe reads and draft/fill actions; user commits manually.
- Confirmed execution: consequential actions require explicit confirmation.
- Policy execution: preapproved actions execute inside fixed policy bounds.

An integration must declare its mode. There is no implicit upgrade from a safer
mode to a more permissive mode.

## Compatibility promise

- `0.x`: schema and APIs may change with migration notes.
- `1.x`: backward-compatible schema additions; breaking changes require a new
  major version and conformance fixtures for both versions.
- Experimental adapters are clearly labeled and excluded from the stable API.

## External standards baseline

- WAI-ARIA supplies roles, states, names, and accessibility-tree semantics.
- WebMCP is the preferred in-browser structured-tool interface.
- MCP supplies cross-platform tool/resource transport.
- JSON Schema describes action input and structured output.
- Platform accessibility APIs supply native UI structure and action patterns.

Reference material:

- https://www.w3.org/TR/wai-aria-1.2/
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/compare-mcp
- https://modelcontextprotocol.io/specification/
- https://playwright.dev/docs/aria-snapshots
