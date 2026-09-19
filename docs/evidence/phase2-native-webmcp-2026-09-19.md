# Phase 2 Native WebMCP Evidence — 2026-09-19

Status: Verified evidence; Phase 2 maintainer approval pending

Evidence date: 2026-09-19 (Asia/Bangkok)

Implementation commits:

- `0c6ace4e9a28ae476a0b8752ffb4d66f63fbf2c9` — declarative tools activate only
  after every trusted annotation is installed;
- `f1c74e5e610e1055cccd8664c1408fe6d2bcce6d` — native WebMCP lifecycle,
  declarative, origin, secret, and browser-profile evidence.

Environment:

- Microsoft Windows 11 Pro, version 10.0.26200, build 26200, 64-bit;
- Google Chrome `153.0.8010.50` stable channel;
- local WebMCP testing enabled in a dedicated, disposable Chrome profile;
- loopback fixture origins on `127.0.0.1`;
- no `modelContext` shim in the native or DevTools MCP runs.

## Evidence boundaries

This record keeps four evidence classes separate:

1. deterministic Node/jsdom tests;
2. built-package tests in Playwright-managed browser engines with a narrow test
   shim;
3. native Chrome tests against the browser's actual `document.modelContext`;
4. equivalent browser-owned discovery and invocation through the official
   `chrome-devtools-mcp` `list_webmcp_tools` and `execute_webmcp_tool` tools.

The fourth class exercises the same browser-owned catalog and execution path
that a developer inspects manually. It is accepted here as equivalent
browser-owned manual evidence. It is **not** a literal screenshot of the
DevTools Model Context Tool Inspector, and this record does not claim that such
a screenshot was captured.

## Automated browser evidence

`npm run test:browser` passed **51/51** cases:

- 17 in Playwright-managed Chromium `153.0.8010.12`;
- 17 in Playwright-managed Firefox `155.0`;
- 17 in Playwright-managed WebKit `26.6`.

The managed suite loaded the built ESM package and proved the three human and
exported-agent workflow pairs, unsupported fallback, rollback, stale/refresh,
SPA/pagehide/hard-navigation cleanup, frame isolation, profile-file denial,
secret exclusion, metadata/output budgets, and the Chrome input-codec version
boundary. This is real-browser package evidence, not native WebMCP evidence.

With `WEBMCP_NATIVE_PROFILE` pointing to the dedicated enabled profile,
`npm run test:browser:native` passed **3/3** cases in real Chrome
`153.0.8010.50`:

- the imperative checkout tool was registered, enumerated, invoked through
  `executeTool()`, verified against authoritative order state, removed on
  disposal, and absent after hard navigation;
- the declarative profile tool was synthesized from package-installed
  annotations, filled its visible fields, completed through the visible human
  submit button and `SubmitEvent.respondWith()`, and disappeared after exact
  annotation restoration;
- a cross-origin child without `allow="tools"` failed with
  `NotAllowedError`; a delegated child registered its own tool, while the
  parent still could not discover it because the package never supplies
  `exposedTo`.

The native assertions also proved that the configured checkout secret sentinel
was absent from catalogs, results, disposal evidence, and navigation evidence.
The fixture server returned `403` for a workspace-local WebMCP browser profile,
and the profile and generated Playwright artifacts were not packaged.

## Equivalent browser-owned discovery and invocation

The official `chrome-devtools-mcp` tools were used against the actual Chrome
WebMCP implementation, without injecting the test shim.

### Imperative checkout

1. `list_webmcp_tools` discovered the package-generated checkout tool.
2. `execute_webmcp_tool` before the application was ready returned the existing
   structured precondition failure and did not mutate order state.
3. The visible application prepare control was used, preserving the human UI
   boundary rather than changing state through hidden setup.
4. The browser-owned tool was invoked again and completed the reviewed checkout
   through the core policy, confirmation, precondition, command, and effect
   verification path.
5. The fixture's package handle was disposed; a subsequent
   `list_webmcp_tools` returned no package tool.

### Declarative profile form

1. `list_webmcp_tools` discovered `profile.prepare`, synthesized by Chrome from
   the package-installed declarative annotations.
2. `execute_webmcp_tool` populated the visible `displayName` and `biography`
   controls but did not auto-submit the form.
3. The visible human submit button completed the operation, and the form's
   existing submit handler returned its structured result through
   `SubmitEvent.respondWith()`.
4. After the package handle disposed and restored the annotations,
   `list_webmcp_tools` returned no declarative package tool.

This proves browser-owned discovery and execution for both exporter modes while
retaining the visible human confirmation/submission boundary. It does not prove
behavior for any other Chrome version, browser channel, operating system,
extension, model, or production deployment.

## Chrome 153 input compatibility

[Chrome's imperative WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
states that JSON-stringified input arguments are deprecated beginning with
Chrome 155. The native evidence codec therefore sends a JSON string to Chrome
153 and 154, and sends the JavaScript object directly to Chrome 155 and later
or to an unknown future implementation. The managed browser suite pins this
boundary and accepts both object and legacy JSON-string results from the native
evidence API. This compatibility code exists only in the evidence fixture; it
does not change the package exporter contract.

The related [declarative API documentation](https://developer.chrome.com/docs/ai/webmcp/declarative-api)
defines the visible form lifecycle, `toolactivated`, manual submission, and
`SubmitEvent.respondWith()`. The
[WebMCP overview](https://developer.chrome.com/docs/ai/webmcp) documents local
testing and the Model Context Tool Inspector, while the
[security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
describes origin and tool-safety boundaries.

## Final repository gates

The candidate passed:

- `npm run typecheck`;
- `npm run test:gate`: **24 files / 323 tests**;
- `npm run contract:check`: **32** root runtime exports, **6** reachable
  declaration files, and **5** schemas;
- `npm audit --json`: **0 known vulnerabilities**;
- `npm pack --dry-run --json`: **92 files**, **85,609 bytes packed**, and
  **442,053 bytes unpacked**;
- managed browser suite: **51/51**;
- native Chrome suite: **3/3**;
- independent security review: **Pass**, no unresolved critical/high finding;
- independent browser/API/package compatibility review: **Pass**, no unresolved
  critical/high finding.

These results make the Phase 2 candidate ready for a maintainer decision. They
do not themselves approve the phase, publish a package, create a release tag,
or authorize Phase 3.
