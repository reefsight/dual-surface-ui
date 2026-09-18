# Security and Trust Model

Status: Accepted at Gate 0 on 2026-09-18

## Security objective

An agent receives only the minimum state and authority needed for the user's
current task. Compromise or manipulation of model context must not create more
authority than the authenticated application session and deterministic policy
permit.

## Trust boundaries

- Human user and confirmation UI
- Application and authoritative business services
- Dual Surface compiler and runtime
- Model/agent process
- Web content and third-party/user-generated text
- Browser extension, MCP client/server, or native daemon
- Operating-system accessibility service
- Logs, traces, fixtures, and evaluation datasets

The model, page text, external content, and action arguments are untrusted.

## Threats and required controls

| Threat | Required control |
|---|---|
| Indirect prompt injection | Mark untrusted content; separate data from instructions; deterministic policy |
| Confused deputy | Bind principal, origin, surface, revision, and action scope |
| Secret exfiltration | Redaction before serialization/logging; deny sensitive reads |
| Unauthorized write | Deny by default; application authorization rechecked at execution |
| Consequential action | Explicit metadata and trusted user confirmation |
| Stale state / TOCTOU | Revision token plus immediate precondition recheck |
| Replay / duplicate action | Idempotency key and replay policy |
| Cross-origin abuse | Origin isolation, allowlist, and permissions policy |
| Tool substitution | Signed/versioned catalog identity where transport requires it |
| Hidden action drift | CI parity checks against visible workflow and permissions |
| Native privilege escalation | Least-privilege daemon, authenticated channel, OS consent |
| Audit leakage | Structured redacted events; no raw prompt/input by default |

## Data classification

- Public: safe to include in snapshots.
- Internal: include only when needed for the current surface.
- Personal: minimize and redact according to policy.
- Credential: never serialize; expose at most `valuePresent`.
- Secret: never serialize, log, fixture, replay, or send to a model.

Fields may be classified explicitly. Password inputs, tokens, authorization
headers, cookies, private keys, one-time codes, and payment credentials are
credential/secret by default.

## Risk classes

- `read`: no state change, but may still require privacy authorization.
- `write`: reversible or ordinary state mutation.
- `consequential`: financial, legal, external communication, submission, or
  meaningful permission/status change.
- `destructive`: deletion or difficult-to-recover mutation.
- `credential`: handles authentication or secret-bearing input.

Risk metadata is advisory to agents but mandatory input to the policy engine.
Missing risk is treated as the safest restrictive class, not `read`.

## Confirmation

Confirmation UI must be controlled by the trusted host, not supplied by page
content or the model. It shows action, target, material input summary, expected
effects, and irreversibility. Approval is scoped to one request or an explicit
bounded policy; vague “allow everything” confirmation is not accepted.

## Tool exposure

- Expose the smallest action catalog needed for the current state.
- Keep descriptions concise and free of untrusted instructions.
- Label untrusted output, read-only operations, and consequential operations.
- Do not expose internal admin/debug tools in production catalogs by default.
- Cross-origin exposure requires an explicit allowlist.
- Fallback automation uses the same policy checks as domain actions.

## Error behavior

External errors are stable and non-sensitive: invalid input, not authorized,
confirmation required, stale state, precondition failed, unsupported action,
verification failed, or internal error. Stack traces and internal selectors do
not cross the trust boundary.

## Security release gate

- Threat model updated for changed surfaces.
- Secret-leak corpus passes.
- Authorization/confirmation bypass tests pass.
- Injection and untrusted-output evals pass.
- Dependencies and packaged files reviewed.
- No unresolved critical/high finding.

Security guidance baseline:

- https://developer.chrome.com/docs/ai/webmcp/secure-tools
- https://developer.chrome.com/docs/ai/webmcp
- https://modelcontextprotocol.io/specification/
- https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiautocore-overview
