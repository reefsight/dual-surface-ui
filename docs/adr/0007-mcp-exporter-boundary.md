# ADR 0007: MCP Export Uses a Dedicated Low-Level Server Boundary

Status: Accepted for P3.1 implementation on 2026-09-19

Date: 2026-09-19

## Context

Phase 3 begins by exposing the frozen Dual Surface UI contract through Model
Context Protocol (MCP). A transport-facing MCP server can reveal private UI
state and invoke consequential application actions, so it cannot treat MCP
discovery, client metadata, URIs, or tool arguments as authority.

The official TypeScript SDK offers both a high-level `McpServer` registry and a
low-level `Server`. The high-level registry owns `resources/list` and
`tools/list`, which prevents this adapter from applying its required
deny-by-default authorization callback to every list request. P3.1 also needs
dynamic current-state catalogs, exact resource lookup, and a strict separation
between protocol serving and HTTP/stdio authentication.

## Decision

1. Add an optional `dual-surface-ui/mcp` package subpath backed by the official
   `@modelcontextprotocol/server` v2 line.
2. Create a dedicated low-level MCP `Server` for one application surface. The
   adapter owns only `resources/list`, `resources/read`, `tools/list`, and
   `tools/call`; it does not open stdio, HTTP, sockets, or an OAuth flow.
3. Require a host-supplied authorization callback for every request, including
   both list operations and read-only snapshot access. Absence, rejection, or
   failure denies access without revealing whether a resource or tool exists.
4. Export one trusted, explicitly allowlisted MCP tool per bound element/action.
   Never expose a generic caller-selected surface/element/action dispatcher,
   inferred DOM catalog, or credential-risk action.
5. Bind the internal surface ID, element ID, action, risk, and schemas in the
   server closure. Callers may supply only the observed revision, nested action
   input when declared, and an idempotency key when required.
6. Execute only through `surface.performSafe()`. Core validation, current
   principal/origin policy, trusted confirmation, preconditions, replay
   protection, effect verification, audit, and normalized failures remain
   authoritative.
7. Expose one mutable, private, zero-TTL current-snapshot resource at a URI
   minted from a required opaque `surfaceRef`. Do not claim immutable revision
   resources until the package retains immutable historical bytes.
8. Project snapshots before serialization: replace the internal surface ID
   with `surfaceRef`, remove URL credentials/query/fragment, preserve the
   already-redacted semantic state, deep-clone the result, and never place raw
   page URLs, principals, tenants, selectors, or filesystem paths in the URI.
9. Use strict JSON-Schema input envelopes and deterministic tool order. Return
   compact structured success/failure data and fixed text; untrusted page or
   action output is data, never instructions or policy.
10. Keep the frozen root export/schema contract unchanged. MCP SDK types and
    runtime code are reachable only through the optional subpath.
11. Target the MCP 2026-07-28 protocol through the official SDK. Direct linked
    transports may be used as legacy-era test evidence, while modern protocol
    evidence must use the SDK's modern serving path and stay labeled separately.

## Security amendment recorded during implementation review

The accepted boundary above is refined by the following mandatory controls;
they do not change its transport-neutral direction:

- each exporter is bound to one opaque host-owned `principalRef`; authorization
  sees only that binding and SDK `authInfo` already validated by the transport,
  never MCP client assertions or the full request context;
- output-bearing actions require a trusted `projectOutput` callback and every
  projected success is validated against its advertised schema; failure codes
  and messages are normalized from the package allowlist;
- application schemas recursively reject `x-mcp-header`, preventing action
  input from becoming transport header data;
- mutable caller options are captured before handler registration and are not
  consulted again;
- keyed replay is not advertised as generally idempotent because it is bounded,
  in-memory, and process-local; only `safe-retry` actions receive that hint;
- revisions and identifiers are bounded to 128 characters, bindings to 128,
  descriptions to 500 characters, snapshots to 1 MiB, tool catalogs to 256
  KiB, and projected action results to 256 KiB;
- sensitive node metadata/actions and all credential actions are removed from
  the MCP snapshot projection in addition to core value redaction.

For modern HTTP serving, `createMcpHandler` must receive a factory that creates
a fresh `Server` per request. Reusing and rebinding one server instance across
concurrent request transports is unsupported.

## Dependency boundary

`@modelcontextprotocol/server` is an optional peer and a development dependency
for build and tests. `@modelcontextprotocol/client` is development-only for
wire-level integration tests. Consumers that never import
`dual-surface-ui/mcp` do not acquire an MCP transport or server runtime.

## Consequences

- Per-request authorization covers discovery as well as execution.
- A host must map transport-authenticated identity to its authorization
  callback; MCP `clientInfo`, `_meta`, session IDs, and arguments are not
  accepted as identity.
- A host must create a dedicated surface/exporter binding for each principal;
  this is what keeps core policy and process-local replay identity aligned.
- A dedicated server cannot be merged into an arbitrary existing low-level MCP
  server without an explicit composition layer. That is intentional for P3.1:
  silently replacing another handler would be unsafe.
- Remote HTTP authorization, TLS, OAuth audience/issuer validation, CORS,
  Origin/DNS-rebinding defenses, scopes, and rate limits remain transport-owner
  responsibilities and are not claimed by this adapter.
- The current in-memory replay cache remains surface-local and process-local;
  P3.1 does not claim distributed or exactly-once execution.

## Rejected alternatives

- High-level `McpServer.registerTool/registerResource`: rejected for P3.1
  because list authorization cannot be enforced per request.
- Generic `perform(surfaceId, elementId, action)` tool: rejected as a broad
  confused-deputy surface.
- Automatic export of all snapshot actions: rejected because inference is not
  authority and may expose credential or unintended actions.
- Raw snapshot serialization: rejected because default surface IDs and page
  URLs may contain tokens or personal identifiers.
- Revision-addressed snapshot resources: rejected until immutable snapshot
  history exists.
- Bundled stdio/HTTP server: rejected because transport authentication and
  deployment policy are outside this work item.

## References

- [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)
- [MCP security best practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices)
- [Official TypeScript SDK v2 migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [Official JSON Schema adapter guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/schema-libraries.md)
