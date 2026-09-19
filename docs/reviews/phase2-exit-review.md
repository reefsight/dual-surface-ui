# Phase 2 Exit Review

Status: Accepted by repository maintainer on 2026-09-19

Verified implementation commits:

- `0c6ace4e9a28ae476a0b8752ffb4d66f63fbf2c9`;
- `f1c74e5e610e1055cccd8664c1408fe6d2bcce6d`.

Audit date: 2026-09-19

Decision owner: Repository maintainer

## Recommendation

The implementation and evidence satisfy the documented Phase 2 deliverables
and exit conditions. The repository maintainer approved the Phase 2 exit gate
and authorized planning and implementation of P3.1 on 2026-09-19.

Package publication, version changes, tags, deployments, and support promises
remain separate decisions.

## Deliverable audit

| Roadmap deliverable | Work-item evidence | Implementation | Verification | Result |
|---|---|---|---|---|
| WebMCP imperative exporter | P2.1, P2.9 | `src/webmcp/` imperative exporter and descriptors | unit lifecycle, managed browser, native Chrome, DevTools MCP evidence | Pass |
| Declarative compatibility and fallback path | P2.2, P2.9 | declarative mount/detect helper with explicit imperative or human-only fallback | mutation/fail-closed tests, native fill/manual-submit/dispose evidence | Pass |
| React, Angular, and Vue adapters | P2.3–P2.5 | optional framework subpaths | framework suites plus actual-exporter unmount/remount integration | Pass |
| Trusted domain-action annotations | P2.6 | `dual-surface-ui/domain` compiler | schema/adversarial tests and all three workflows | Pass |
| Semantic drift checker | P2.7 | `dual-surface-ui/drift` reviewed-manifest checker | same-epoch DOM/tool/permission/state tests | Pass |
| Checkout, approval, and migrated-form examples | P2.8 | three runnable examples sharing application commands | Node integration and managed-browser human/agent parity | Pass |
| Browser matrix and graceful fallback | P2.9 | support matrix, managed/native runners, two-origin fixtures | 51/51 managed cases and 3/3 native Chrome cases | Pass |

The roadmap's “polyfill path” is satisfied by an explicit, reviewed fallback
decision rather than a synthetic declarative polyfill: an application chooses
native annotations, the imperative core-authoritative exporter, or its visible
human-only form. The package never selects or combines these paths
automatically.

## Exit-gate evidence

| Exit condition | Evidence | Result |
|---|---|---|
| Each example completes through human UI and agent action | checkout, approval, and legacy-form unit/integration suites plus managed browser parity against authoritative state | Pass |
| WebMCP Inspector/manual invocation for supported browsers | actual Chrome catalog/execution through the native suite and equivalent browser-owned `chrome-devtools-mcp` discovery/invocation; no literal Inspector screenshot claimed | Pass with evidence qualification |
| Framework unmount/remount does not leak or duplicate tools | React, Angular, and Vue lifecycle suites composed with the actual exporter | Pass |
| Cross-origin, iframe, navigation, and stale-tool tests pass | managed frame/lifecycle suites; native denied/delegated cross-origin cases; hard-navigation and stale-revision evidence | Pass |
| Tool descriptions and outputs meet documented budgets | 500-character tool description, 32,768-character schema, and 4,096-character example-output assertions | Pass |
| No business rule exists only in the agent adapter | thin-adapter source review and human/agent paths sharing each application-owned command | Pass |

The 4,096-character result bound is the documented reference-example budget,
not an undocumented universal core-output limit.

## Browser evidence disposition

The evidence tiers remain separate:

- Playwright-managed Chromium, Firefox, and WebKit prove built-package and
  graceful-fallback behavior: 51/51 cases.
- Chrome `153.0.8010.50` on Windows 11 build 26200 proves actual native WebMCP
  imperative, declarative, lifecycle, and origin behavior: 3/3 cases.
- Official `chrome-devtools-mcp` `list_webmcp_tools` and
  `execute_webmcp_tool` provide equivalent browser-owned manual evidence for
  both modes, including structured precondition failure, visible preparation,
  visible declarative submit/`respondWith()`, and an empty catalog after
  disposal.
- No literal Model Context Tool Inspector screenshot was captured or claimed.
- The earlier disabled-profile `UNSUPPORTED` observation remains valid
  graceful-fallback evidence, not a contradiction of the later enabled-profile
  native result.

See the dated
[`Phase 2 Native WebMCP Evidence`](../evidence/phase2-native-webmcp-2026-09-19.md)
and [`Browser Support Matrix`](../BROWSER_SUPPORT.md).

## Security disposition

| Threat | Phase 2 control and evidence | Disposition |
|---|---|---|
| Prompt-derived or credential tool exposure | explicit trusted allowlists; credential actions rejected; no DOM-derived metadata | Pass |
| Policy or business-rule bypass | exporters and frameworks delegate to the existing core lifecycle; parity workflows share one application command | Pass |
| Stale or replayed execution | URL-sensitive revisions, retained-callback aborts, keyed replay checks, stale/refresh tests | Pass |
| Lifecycle leaks and duplicate ownership | abort-owned registrations, name reservations, rollback, framework unmount/remount tests | Pass |
| Unsafe declarative mutation | full preflight, trusted activation ordering, continuous revalidation, fail-closed disposal | Pass |
| Cross-origin discovery | Permissions Policy denial, explicit delegated-child ownership, no `exposedTo`, no parent discovery | Pass |
| Browser-profile or secret exposure | fixture server returns 403 for local WebMCP profiles; native and managed evidence excludes sentinels | Pass |
| Dependency/package exposure | zero-vulnerability audit and 92-file package inspection | Pass |

Independent security and browser/API/package compatibility reviews both passed
with no unresolved critical or high finding.

## Final candidate gates

- `npm run typecheck`: passed.
- `npm run test:gate`: 24 files / 323 tests passed.
- `npm run contract:check`: 32 root runtime exports, six reachable declaration
  files, and five schemas remained frozen.
- `npm run test:browser`: 51/51 passed.
- `npm run test:browser:native`: 3/3 passed in Chrome `153.0.8010.50` with
  native WebMCP enabled and no shim.
- `npm audit --json`: zero known vulnerabilities.
- `npm pack --dry-run --json`: 92 files, 85,609 bytes packed, 442,053 bytes
  unpacked.
- Packed optional-peer-free consumer: root, domain, WebMCP, and drift imports
  passed.
- Security and compatibility review: Pass.

## Audit findings closed

1. Native declarative registration could observe `toolname` before the other
   trusted annotations. Commit `0c6ace4` installs `toolname` last and removes it
   first during disposal.
2. A browser profile under the served workspace could be exposed by the fixture
   server. Commit `f1c74e5` denies matching profile paths and adds a real-browser
   403 regression.
3. The original cross-origin case proved denial but not delegated isolation.
   The final native suite covers both undelegated and `allow="tools"` frames and
   proves no implicit parent exposure.
4. Native evidence did not explicitly aggregate-check the checkout sentinel.
   The final suite checks catalog, invocation, disposal, and navigation evidence.
5. Chrome 153's legacy JSON-string input shape differed from the current API.
   The evidence-only codec pins strings for Chrome 153/154 and objects for 155+
   in accordance with Chrome's documented deprecation boundary.

## Known limitations and non-claims

- Evidence is fixture- and version-bound; it is not an evergreen claim for
  future Chrome versions or other branded browsers.
- Managed WebKit is not a branded Safari result.
- Angular browser hydration remains unclaimed; Vue has explicit hydration
  coverage.
- CSSOM-only, media-query, animation, back-forward-cache, closed-shadow,
  arbitrary iframe aggregation, mobile, and production deployment behavior are
  not claimed.
- The package does not support cross-origin `exposedTo`; the native evidence
  verifies the absence of implicit exposure.
- No model-quality, token-efficiency, uptime, payment, or production-identity
  claim is made.
- No MCP server, Playwright fallback adapter, CLI, browser extension, or native
  desktop adapter has begun under this review.

## Maintainer decision

- [x] Approve the Phase 2 exit gate — approved 2026-09-19.
- [x] Authorize planning and implementation of P3.1 — authorized 2026-09-19.
- [ ] Keep package publication, versioning, tagging, and deployment as separate
  decisions.

Phase 2 is accepted. P3.1 may begin; later Phase 3 work items and the Phase 3
exit gate remain governed by their own reviewed evidence and decisions.
