# Browser Support and Evidence Matrix

Status: Automated real-browser evidence verified; native Chrome/Inspector evidence pending

Last reviewed: 2026-09-19 (Asia/Bangkok)

This matrix separates package behavior in a real browser engine from native
WebMCP behavior supplied by a browser. An engine row is supported only for the
capability and evidence tier explicitly shown. A passing row does not imply
support for unlisted channels, operating systems, native agents, extensions,
or mobile browsers.

## Evidence tiers

| Tier | Meaning | What it does not prove |
|---|---|---|
| Native WebMCP | Actual `document.modelContext`, browser-owned discovery/invocation, and Inspector/manual evidence | Other browser versions, channels, or operating systems |
| Browser with test shim | Built package executes in a real browser while a deterministic shim records registration and lifecycle | Native registry retention, Inspector visibility, browser agent behavior, or browser confirmation UX |
| Unsupported/no native API | The tested configuration lacks the required API and the package preserves the human path without hidden fallback | Native WebMCP support or future behavior of that browser |

An exporter observation, jsdom test, screenshot, skipped test, or browser
version number is not native WebMCP evidence.

## Current host inventory

| Browser/OS | Exact version | Native capability result | Current status |
|---|---|---|---|
| Google Chrome on Microsoft Windows 11 Pro 64-bit | Chrome 153.0.8010.50; Windows 10.0.26200 build 26200 | Package-native fixture returned `UNSUPPORTED` at 2026-09-19 18:20:09 +07:00 because the current profile exposed no `document.modelContext`; no shim was injected and the human checkout remained usable | Pending enabled-profile native suite and Inspector/manual evidence |
| Microsoft Edge on Microsoft Windows 11 Pro 64-bit | Edge 153.0.4234.32; Windows 10.0.26200 build 26200 | Not probed | No WebMCP capability claim |

The inventory was read on 2026-09-19. It proves only installed binary and OS
versions. Chrome support is not inferred from major version 153. Native status
remains pending until the run records the testing flag or origin-trial setup,
the actual API, tool discovery and invocation, authoritative state, and
Inspector/manual unregister/navigation behavior.

## Deterministic compatibility matrix

| Project | Human workflow | Built ESM package | Shimmed exporter lifecycle | Native WebMCP | Status |
|---|---|---|---|---|---|
| Playwright-managed Chromium 153.0.8010.12 | Passed | Passed | Passed | Not implied | 15/15 passed |
| Playwright-managed Firefox 155.0 | Passed | Passed | Passed | Not implied | 15/15 passed |
| Playwright-managed WebKit 26.6 | Passed | Passed | Passed | Not implied; not a branded Safari claim | 15/15 passed |
| Installed Chrome 153.0.8010.50 on Windows | Human fixture loaded | Built package loaded | Separate from native run | API unavailable in current profile | Unsupported result recorded; enabled-profile native/Inspector evidence pending |

The managed-engine run used Playwright 1.63.0 on Windows 11 build 26200 at
2026-09-19 in Asia/Bangkok. `npm run test:browser` passed 45/45 tests: 15 each
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
| Imperative API available | Explicit allowlisted tools register through the browser and invoke the core path | Native Chrome catalog, invocation, result, and authoritative state |
| Imperative API absent | `supported: false`; no registration, DOM mutation, or automatic fallback | Real-browser unsupported run plus human workflow |
| Declarative signals positive | Explicit safe annotations remain visible and browser discovery is checked separately | Native browser and Inspector/manual evidence |
| Declarative signals incomplete | Capability remains `unknown`; the normal visible form stays editable and manually submittable | Real-browser fallback run |
| Registration rejected | All exporter-owned registrations roll back | Browser shim suite and, where reproducible, native run |
| Semantic state changes | Old invocation fails with `stale_revision`; refreshed registration binds the current revision | Browser lifecycle suite and zero business mutations before refresh |
| SPA route changes | Application disposes before remount; one current catalog remains | Active catalog before/after route change |
| Hard navigation | Old document tools are unavailable from the new document | Native or browser-owned catalog evidence, not retained callback execution |
| Same-origin iframe | Child surface remains separately owned; adapter does not traverse or aggregate frame DOM | Two-document browser fixture |
| Cross-origin iframe without `tools` delegation | Registration/discovery is unavailable | Native browser evidence pending; a shim cannot prove Permissions Policy enforcement |
| Cross-origin iframe with host delegation | No implicit parent exposure because this package does not pass `exposedTo` | Signal-only registration-options assertion passed; native parent discovery remains pending |
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

## Native Chrome evidence checklist

The first target is Chrome 153.0.8010.50 on Windows 11 Pro build 26200, dated
2026-09-19 or the actual later execution date. The evidence record must include:

- exact Chrome and Windows versions;
- exact invocation date, timezone, command, and launch configuration;
- testing flag, origin-trial token, or other documented enablement state;
- confirmation that no `modelContext` shim was injected;
- tool catalog and trusted descriptor after package registration;
- Model Context Tool Inspector visibility;
- manual invocation input and structured result;
- authoritative application state proving the expected effect;
- tool absence after disposal and hard navigation;
- iframe and origin behavior for the tested cases;
- redacted trace or screenshot references with no secret sentinel; and
- reviewer name and decision.

Until every applicable item is recorded, the row and P2.9 remain **pending**.

The opt-in native runner is:

```powershell
$env:WEBMCP_NATIVE_PROFILE = 'C:\path\to\dedicated-chrome-profile'
npm run test:browser:native
```

The dedicated Chrome profile must have local WebMCP testing enabled according
to the official instructions and must not be in use by another Chrome process.
The test deliberately fails, rather than skips, when the profile or native API
is unavailable. The same package-native fixture is available at
`/examples/browser-evidence/native.html` for Inspector/manual invocation.

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
