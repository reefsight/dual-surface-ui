# Browser Support and Evidence Matrix

Status: Phase 2 evidence accepted on 2026-09-19

Last reviewed: 2026-09-19 (Asia/Bangkok)

This matrix separates package behavior in a real browser engine from native
WebMCP behavior supplied by a browser. An engine row is supported only for the
capability and evidence tier explicitly shown. A passing row does not imply
support for unlisted channels, operating systems, native agents, extensions,
or mobile browsers.

## Evidence tiers

| Tier | Meaning | What it does not prove |
|---|---|---|
| Native WebMCP | Actual `document.modelContext` plus browser-owned discovery/invocation and Inspector or equivalent manual evidence | Other browser versions, channels, or operating systems |
| Browser with test shim | Built package executes in a real browser while a deterministic shim records registration and lifecycle | Native registry retention, Inspector visibility, browser agent behavior, or browser confirmation UX |
| Unsupported/no native API | The tested configuration lacks the required API and the package preserves the human path without hidden fallback | Native WebMCP support or future behavior of that browser |

An exporter observation, jsdom test, screenshot, skipped test, or browser
version number is not native WebMCP evidence.

## Current host inventory

| Browser/OS | Exact version | Native capability result | Current status |
|---|---|---|---|
| Google Chrome on Microsoft Windows 11 Pro 64-bit | Chrome 153.0.8010.50; Windows 10.0.26200 build 26200 | Disabled profile preserved the human path as `UNSUPPORTED`; enabled dedicated profile passed native 3/3 without a shim | Native and equivalent browser-owned manual evidence accepted for Phase 2 |
| Microsoft Edge on Microsoft Windows 11 Pro 64-bit | Edge 153.0.4234.32; Windows 10.0.26200 build 26200 | Not probed | No WebMCP capability claim |

The inventory and evidence were recorded on 2026-09-19. Support is not inferred
from the major version: the enabled dedicated profile exercised the actual
Chrome API, authoritative state, unregister/navigation behavior, and browser-
owned catalog/invocation. The disabled-profile result remains separate valid
fallback evidence.

## Deterministic compatibility matrix

| Project | Human workflow | Built ESM package | Shimmed exporter lifecycle | Native WebMCP | Status |
|---|---|---|---|---|---|
| Playwright-managed Chromium 153.0.8010.12 | Passed | Passed | Passed | Not implied | 17/17 passed |
| Playwright-managed Firefox 155.0 | Passed | Passed | Passed | Not implied | 17/17 passed |
| Playwright-managed WebKit 26.6 | Passed | Passed | Passed | Not implied; not a branded Safari claim | 17/17 passed |
| Installed Chrome 153.0.8010.50 on Windows | Visible workflows preserved | Built package loaded | Separate from native run | Imperative, declarative, lifecycle, and origin cases passed | Native 3/3 plus equivalent browser-owned manual evidence |

The managed-engine run used Playwright 1.63.0 on Windows 11 build 26200 at
2026-09-19 in Asia/Bangkok. `npm run test:browser` passed 51/51 tests: 17 each
for Chromium 153.0.8010.12, Firefox 155.0, and WebKit 26.6. Failure-only
artifacts are written below `test-results/`, which is gitignored; the passing
run retained no evidence artifact. Managed engine results are not relabeled as
results from Google Chrome, Mozilla Firefox, or Apple Safari.

The suite loads the built ESM package over two loopback HTTP origins and proves
all three human/exported-agent workflow pairs, unsupported no-op behavior,
rollback, stale rejection and refresh, SPA/pagehide/hard-navigation cleanup,
same- and cross-origin frame isolation, declarative frame fail-closed behavior,
secret exclusion, and metadata/output budgets. Its model-context shim records
only registration and AbortSignal lifecycle; it is not native WebMCP evidence.

## Capability behavior

| Capability or condition | Required behavior | Evidence needed |
|---|---|---|
| Imperative API available | Explicit allowlisted tools register through the browser and invoke the core path | Passed in native Chrome and equivalent DevTools MCP evidence |
| Imperative API absent | `supported: false`; no registration, DOM mutation, or automatic fallback | Real-browser unsupported run plus human workflow |
| Declarative signals positive | Explicit safe annotations remain visible and browser discovery is checked separately | Passed: browser fill, visible human submit/`respondWith()`, disposal |
| Declarative signals incomplete | Capability remains `unknown`; the normal visible form stays editable and manually submittable | Real-browser fallback run |
| Registration rejected | All exporter-owned registrations roll back | Browser shim suite and, where reproducible, native run |
| Semantic state changes | Old invocation fails with `stale_revision`; refreshed registration binds the current revision | Browser lifecycle suite and zero business mutations before refresh |
| SPA route changes | Application disposes before remount; one current catalog remains | Active catalog before/after route change |
| Hard navigation | Old document tools are unavailable from the new document | Passed in native and managed browser-owned catalogs |
| Same-origin iframe | Child surface remains separately owned; adapter does not traverse or aggregate frame DOM | Two-document browser fixture |
| Cross-origin iframe without `tools` delegation | Registration/discovery is unavailable | Native Chrome returned `NotAllowedError` |
| Cross-origin iframe with host delegation | Child owns its tool; parent gets no implicit exposure because this package omits `exposedTo` | Native child registration and parent non-discovery passed |
| Declarative form in any iframe | Mount fails before attribute mutation; human form remains usable | Browser frame fixture |
| Unregister during active execution | Catalog removal is distinct from cancellation; core policy/preconditions/effect verification remain authoritative | Chrome 153-specific lifecycle record |

## Fallback contract

Graceful fallback means preserving the ordinary application, not silently
switching control mechanisms. The package never installs Playwright, vision,
mouse/keyboard injection, synthetic submission, or both native and imperative
paths automatically. An application can explicitly retain its human UI or use
the Phase 1 core through its own trusted integration.

Failure to obtain native WebMCP support is reported as unsupported or pending.
It must not be converted into a native pass because the test shim, jsdom suite,
manual DOM workflow, or package build succeeds.

Declarative mounts continuously revalidate observed DOM child and attribute
mutations and dispose on annotation, visibility, ownership, or credential-risk
drift. CSSOM API edits, media-query transitions, and animations do not produce
MutationObserver records; applications that change effective visibility only
through those mechanisms must dispose and remount the declarative handle at the
same lifecycle boundary. This limitation is not a claim of automatic CSS
visibility monitoring.

## Native Chrome evidence record

Chrome 153.0.8010.50 on Windows 11 Pro build 26200 was tested on 2026-09-19
with local WebMCP testing enabled in a dedicated profile. No `modelContext`
shim was injected. The 3/3 native suite covers imperative and declarative
catalogs, invocation, authoritative state, disposal, navigation, and both
denied and delegated cross-origin frames.

Official `chrome-devtools-mcp` `list_webmcp_tools` and
`execute_webmcp_tool` calls provide equivalent browser-owned manual evidence:
imperative invocation first failed its authoritative precondition, succeeded
after visible preparation, and disappeared after fixture disposal; declarative
invocation filled visible fields, required the human submit button, returned
through `SubmitEvent.respondWith()`, and disappeared after disposal. This is
not a literal Model Context Tool Inspector screenshot.

The full dated record, evidence qualifications, official references, and final
gate numbers are in
[`evidence/phase2-native-webmcp-2026-09-19.md`](evidence/phase2-native-webmcp-2026-09-19.md).

The opt-in native runner is:

```powershell
$env:WEBMCP_NATIVE_PROFILE = 'C:\path\to\dedicated-chrome-profile'
npm run test:browser:native
```

The dedicated Chrome profile must have local WebMCP testing enabled according
to the official instructions and must not be in use by another Chrome process.
The test deliberately fails, rather than skips, when the profile or native API
is unavailable. Passing evidence is version- and configuration-bound.

## Official references

- [Chrome WebMCP overview and testing setup](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api)
- [Chrome WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/)
- [Playwright browser projects](https://playwright.dev/docs/browsers)

These are evolving sources. A dated test result applies only to the recorded
browser configuration and does not create an evergreen compatibility claim.

## Out of scope for Phase 2

- Phase 3 Playwright fallback adapter and external MCP transport;
- browser-extension delivery or agent/model quality evaluation;
- cross-origin tool exposure support;
- back-forward-cache guarantees;
- mobile browsers and native mobile surfaces;
- branded Safari support inferred from Playwright WebKit;
- production deployment, performance, or uptime guarantees; and
- mouse, keyboard, or vision automation as an implicit fallback.
