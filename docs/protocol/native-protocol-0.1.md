# Native Protocol 0.1

Status: Draft normative specification for P4.1

This document defines the language-neutral contract between an authenticated
local agent client and a future native host. JSON Schema files under
`schemas/native/` are normative for structure. This document is normative for
state transitions, authority, failure behavior, and limits that JSON Schema
cannot express.

P4.1 does not define a transport, daemon, OS adapter, authentication mechanism,
or remote-access mode. A native host must authenticate the local peer and bind
it to the current OS user/session before passing a decoded message to this
protocol.

## Encoding and frame admission

- A frame is exactly one UTF-8 encoded JSON object. Arrays and scalar top-level
  values are invalid.
- Invalid UTF-8, byte-order marks, trailing bytes, trailing JSON values,
  comments, non-finite numbers, and duplicate object keys are rejected before
  schema validation or dispatch.
- A frame larger than 1,048,576 bytes is rejected before parsing. A host may
  enforce a smaller transport limit only if it is advertised outside this
  protocol and does not change message semantics.
- Numbers must be finite JSON numbers within the interoperable integer range
  when a schema requires an integer. Revisions, identifiers, and digests are
  strings and are never coerced from numbers.
- Unknown kinds, fields, schema versions, enum values, and required
  capabilities fail closed. Frozen schemas use `additionalProperties: false`.
- The host enforces depth, node, collection, and string budgets during parsing
  or immediately after parsing and before dispatch. Rejecting an oversized
  value must not allocate storage proportional to an attacker-declared size.

## Identifiers and authority

`requestId`, `sessionRef`, `surfaceRef`, `elementId`, action names, capability
names, and idempotency keys contain 1–128 URL-safe opaque characters matching
`[A-Za-z0-9._~-]+`. They are case-sensitive and have no client-interpretable
structure.

The server mints `sessionRef` and `surfaceRef`. A valid reference proves only
that the message is well formed; it is not authorization. Trusted host state
binds every reference to the authenticated OS user/session, process/window
identity, current catalog entry, policy scope, and consent state. Process IDs,
window handles, usernames, principals, risks, policies, confirmations, and OS
selectors are never accepted as authority from the client.

Reconnect creates a new session and invalidates all prior surface references,
revisions, confirmations, cancellation targets, and replay entries. References
from a different or expired session return a fixed protocol error without
revealing whether the referenced application still exists.

## Session state machine

```text
connected --client-hello--> negotiated --surface-list-request--> active
    |                             |                                  |
    +--invalid/unsupported------> closed <----auth/consent loss-------+
                                  |
                                  +----reconnect creates new session
```

Only `client-hello` is accepted before negotiation. The server selects exactly
protocol `0.1` and an immutable capability subset from the intersection. A
missing required capability or version mismatch rejects the handshake without
creating or disclosing a session or catalog. Repeating a handshake on an
already negotiated connection is invalid.

After negotiation, every request carries the negotiated `sessionRef` and a
unique active `requestId`. Reusing an active request ID is invalid. Reusing a
completed request ID with identical replay-bound content follows the relevant
idempotency rule; reusing it with different content returns
`request_conflict`.

## Capability names

| Capability | Permitted message families |
|---|---|
| `surface-catalog` | Surface-list request and response |
| `snapshots` | Full snapshot request and response |
| `deltas` | Delta request/response and resynchronization |
| `actions` | Action request and action outcome |
| `cancellation` | Cancellation request and acknowledgement |
| `events` | Server event messages |

A message whose capability was not selected for the session returns
`capability_not_negotiated`. Capabilities do not grant OS permission or action
authority.

## Message families

Every message contains `schemaVersion: "0.1"`, a tagged `kind`, and the fields
listed below. Responses echo the initiating `requestId`. Except for a rejected
handshake, post-negotiation responses include `sessionRef`.

### Handshake

`client-hello` contains `requestId`, unique `supportedVersions`, offered
`capabilities`, and `requiredCapabilities`. Required capabilities must also be
offered. `server-hello` contains the server-minted `sessionRef`, exact selected
`protocolVersion`, sorted selected capabilities, and immutable limits.

`protocol-error` is the only handshake rejection. Its `requestId` is `null`
when the request ID itself was not structurally valid. It never contains a
session reference, catalog, platform error, exception, stack, or untrusted
message text.

After negotiation, protocol-level failures use `request-error`, which contains
the validated `requestId`, bound `sessionRef`, stable error `code`, and the
exact package-owned message for that code. It never carries a raw exception,
platform code, accessibility object, or caller-controlled message. Core action
failures remain inside `action-response` outcomes.

### Surface catalog

`surface-list-request` contains `requestId` and `sessionRef` only.
`surface-list-response` contains up to 128 server-owned entries sorted by
`surfaceRef`. Each entry contains:

- `surfaceRef`: opaque session-bound reference;
- `revision`: current opaque revision;
- `title`: redacted display title, at most 500 characters;
- `application`: redacted package/display name, at most 128 characters;
- `capabilities`: sorted semantic surface capabilities;
- `actionCount`: integer from 0 through 128.

The catalog contains no PID, window handle, executable path, bundle path,
selector, accessibility object address, username, or hidden-window content.
Catalog removal invalidates the surface reference immediately. A reused OS
handle or PID cannot revive an invalidated reference.

### Full snapshot

`snapshot-request` contains `requestId`, `sessionRef`, and `surfaceRef`.
`snapshot-response` contains those correlation fields plus `snapshot`, which
must satisfy the frozen core Agent Snapshot 0.1 schema with
`snapshot.surfaceId === surfaceRef`. The response is at most 1 MiB encoded
JSON, has at most 4,096 nodes and 1,024 total actions, and uses the core
redaction and sensitivity rules.

Passwords, credentials, secure inputs, one-time codes, and other sensitive
controls never expose a value. They may expose only safe role/name,
`sensitive: true`, and `valuePresent` metadata when the host can obtain that
metadata without reading the secret. P4.1 never makes a sensitive control
writable.

### Incremental delta

`delta-request` contains `requestId`, `sessionRef`, `surfaceRef`,
`baseRevision`, and `baseDigest`. `delta-response` contains the same
correlation fields and a core Agent Snapshot Delta 0.1 value. The delta's
surface and base fields must equal the request, its target revision must be
newer in trusted host state, and its final digest must match the authoritative
full snapshot.

The encoded response is at most 524,288 bytes with at most 512 operations. A
missing base, digest mismatch, revision collision, replaced process/window, or
expired surface returns `resync_required`; the client then requests a full
snapshot. The server never guesses or silently applies a delta to another
revision.

### Action execution

`action-request` contains `requestId`, `sessionRef`, `surfaceRef`, `revision`,
`elementId`, `action`, optional JSON `input`, and an idempotency key whenever
the catalog marks the action as keyed. No caller-supplied risk, policy,
principal, confirmation, precondition, effect, process, or window field is
allowed.

The host resolves the action only from the bound catalog entry, then rechecks
session identity, OS permission, process/window identity, revision, semantic
target, policy, confirmation, preconditions, and sensitivity before mutation.
`action-response` contains the correlation fields and a validated core action
success or failure outcome. The outcome's surface and revision must agree with
trusted state. The encoded response is at most 262,144 bytes.

Identical keyed retries return the recorded authoritative outcome. A reused key
with different bound content returns `request_conflict`. Unkeyed writes are
serialized per surface and are never implicitly replayed.

### Cancellation

`cancel-request` contains its own `requestId`, `sessionRef`, and
`targetRequestId`. It cannot target another session. `cancel-response` reports
one of `accepted`, `already-completed`, or `not-cancellable` without disclosing
another request's existence.

Cancellation is best effort before mutation. Once mutation may have committed,
the final authoritative action outcome wins; cancellation never converts a
committed success into a false failure.

### Events

`event` contains `sessionRef`, a strictly increasing positive `sequence`, an
event name, and the minimum correlation fields required for that event. Event
names are `catalog-changed`, `surface-changed`, `surface-closed`, and
`session-invalidated`. Events contain no raw accessibility data, action input,
application text beyond already validated/redacted catalog fields, or secrets.

Sequence gaps require catalog refresh or snapshot resynchronization. Events are
hints; clients verify authoritative state before acting. Session invalidation
is terminal.

## Stable protocol errors

Protocol errors use package-owned constant messages and never echo invalid
input. The 0.1 codes are:

| Code | Meaning |
|---|---|
| `invalid_message` | Encoding, budget, schema, correlation, or state-machine violation |
| `no_compatible_version` | Handshake has no exact supported protocol version |
| `missing_required_capability` | Required handshake capability is unavailable |
| `capability_not_negotiated` | Message family was not selected for the session |
| `invalid_session` | Session is expired, replaced, unauthenticated, or mismatched |
| `surface_unavailable` | Bound surface is absent, replaced, closed, or no longer permitted |
| `stale_revision` | Request does not bind the authoritative current revision |
| `resync_required` | Delta/base state cannot be safely continued |
| `request_conflict` | Request or idempotency identity was reused with different content |
| `request_cancelled` | Work was cancelled before mutation |
| `permission_denied` | Required OS accessibility permission is absent or revoked |
| `resource_limit` | Accepted structural limits would be exceeded |
| `internal_error` | Fixed non-diagnostic failure; details remain in protected host telemetry |

Core action failures remain inside validated action outcomes and are not
rewritten into platform-specific protocol errors.

## Canonicalization and digests

Wire acceptance is independent of object-key order and insignificant JSON
whitespace. Canonical JSON is used only for fixture digests, replay-bound
content, catalog identities, and other explicitly named digest inputs. Digest
inputs exclude timestamps, transport metadata, OS handles, secrets, and raw
exceptions. SHA-256 digests use lowercase hexadecimal prefixed with
`sha256:`. Any semantic mutation must change the corresponding digest.

## Compatibility

Protocol `0.x` requires an exact minor-version match. Frozen 0.1 messages never
gain optional fields in place; an additive field requires a new schema and
fixture. A future version must include accepted upgrade, downgrade, reconnect,
and replay migration fixtures. A host never advertises a version or capability
for which every mandatory fixture does not pass.

## Required conformance evidence

An implementation is conformant only when it passes the same portable corpus:

1. one golden fixture for every valid message kind and stable failure;
2. unknown-field/kind/version/capability and semantic cross-field negatives;
3. invalid UTF-8, duplicate-key, truncated-frame, oversize, depth, collection,
   string, and number-boundary inputs at the byte parser boundary;
4. reconnect, stale revision, PID/window reuse, cancellation, idempotency, and
   replay-conflict sequences;
5. secret sentinels, injection text, confused-deputy fields, and raw-error
   extraction attempts;
6. key-order/serializer-independent digest fixtures;
7. the same accept/reject and stable-error disposition in TypeScript and every
   future Rust, .NET, Swift, or other implementation.

Passing schema validation alone is not proof of protocol conformance.

The checked-in
[portable 0.1 corpus](../../fixtures/native-protocol/corpus-0.1.json) is the
current cross-language fixture source. Its schema is
`schemas/native/native-protocol-fixture-corpus-0.1.schema.json`; its accepted
and rejected dispositions must remain identical in every implementation.
