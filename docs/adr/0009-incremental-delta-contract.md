# ADR 0009: Incremental Snapshots Bind Exact Canonical Bases

Status: Accepted for P3.3 implementation on 2026-09-20

Date: 2026-09-20

## Context

Full snapshots are safe but wasteful for frequently changing or large surfaces.
An incremental format must remain deterministic and bounded while preserving the
existing rule that only the live surface can authorize an action. A revision
string alone is not an exact base identity: focus, bounds, metadata, or a
producer error can produce different snapshots with the same revision.

Delta input, cached snapshots, object graphs, and delivery order are untrusted.
Generic JSON Patch or merge behavior could retain removed secrets, mutate
caller data, invoke accessors, pollute prototypes, or downgrade action metadata.

## Decision

1. Add the capability only at `dual-surface-ui/delta`. Do not change the
   frozen root exports, declarations, snapshot version, five Phase 1 schemas,
   or their manifest.
2. Version the delta independently as `0.1`, with a fixed kind discriminator.
   A delta binds `surfaceId`, opaque `baseRevision` and target `revision`, a
   canonical SHA-256 base digest, and a canonical SHA-256 target digest.
   Digests detect exact-content mismatch; they do not authenticate a producer.
3. Carry complete target metadata: title, URL, generation time, focus as
   `string | null`, and capabilities. Omission never doubles as a clear
   operation.
4. Represent node changes as sorted full-node upserts and ID-only removals.
   Never accept paths, partial nodes, recursive merge, or last-write-wins.
5. Canonicalization uses detached plain JSON data, fixed object construction,
   code-unit ordering for nodes, actions, capabilities, preconditions and
   effects, recursively ordered keys for embedded schema/state records, and
   normalized finite numbers. Set-like lists are sorted; other array order is
   preserved.
6. Before schema validation or serialization, capture inputs through own data
   property descriptors. Reject getters, setters, symbols, sparse arrays,
   cycles, functions, bigint, undefined, non-finite numbers, exotic
   prototypes, excessive depth, size, strings, nodes, actions, conditions, or
   schema complexity. Do not invoke `toJSON`.
7. Reject duplicate node IDs, duplicate action names, duplicate capabilities,
   duplicate removals/upserts, overlap, missing removal targets, invalid focus,
   unknown properties, unchanged-revision state collisions, and malformed
   nested actions or schemas. Revisions are compared only by exact equality.
8. Diff validates and captures both full snapshots before comparison. A truly
   identical same-revision pair produces no delta; different state under the
   same revision is producer corruption and requires resynchronization.
9. Apply requires exact schema version, surface, base revision, and base digest.
   It reconstructs atomically, validates the complete snapshot and semantic
   invariants, then verifies the target digest. Every failure returns a fixed
   `resync_required` reason without partial state or untrusted error text.
10. The initial limits are 4,096 snapshot nodes, 512 combined delta
    operations, 64 actions per node, 1,024 actions total, 256 capabilities,
    1 MiB per captured full snapshot, and 1 MiB per delta. Structural limits
    are enforced during capture; canonical UTF-8 byte limits are enforced
    before returning a value. Inputs are never truncated.
11. Public create/apply APIs are asynchronous because digesting uses the
    platform Web Crypto SHA-256 implementation available in supported Node and
    browsers. No hashing dependency is added.
12. Returned snapshots and deltas are detached and deeply frozen. Inputs are
    never mutated, shared, logged, or reflected in errors.
13. A delta and its reconstructed snapshot are observation and transport data,
    never current execution authority. There is no apply-and-perform API.
    Execution must still resolve current live action metadata and revision
    through the existing lifecycle.

## Contract shape

The schema requires these fields and rejects additional properties:

```ts
interface AgentSnapshotDelta {
  schemaVersion: "0.1";
  kind: "agent-snapshot-delta";
  surfaceId: string;
  baseRevision: string;
  revision: string;
  baseDigest: `sha256:${string}`;
  targetDigest: `sha256:${string}`;
  target: {
    title: string;
    url: string;
    generatedAt: string;
    focusedElementId: string | null;
    capabilities: readonly string[];
  };
  nodeUpserts: readonly AgentElementSnapshot[];
  removedNodeIds: readonly string[];
}
```

`createAgentSnapshotDelta(base, target)` returns either a detached delta, a
no-change result, or a fixed resynchronization reason. `applyAgentSnapshotDelta`
returns either an applied detached snapshot or a fixed resynchronization
reason. Raw validation and hashing exceptions do not cross the boundary.

## Consequences

- Exact base and target digests make stale, replayed, cross-lineage, and
  tampered chains detectable even if revision tokens are reused.
- Full metadata and full-node replacement are slightly larger than sparse
  patches but remove ambiguous clearing and stale-secret behavior.
- Canonicalization normalizes set-like ordering; it does not preserve visual
  node order as semantic state in this version.
- Consumers that miss a delta or exceed a budget must fetch a full snapshot.
- The Phase 3 schema and package gate remain separate from the frozen Phase 1
  manifest and contract count.

## Rejected alternatives

- Surface and revision only: rejected because they do not bind exact snapshot
  content or a restarted surface lineage.
- JSON Patch or generic recursive merge: rejected because paths and partial
  updates create ambiguity, pollution risk, and stale-secret retention.
- Synchronous custom hashing or a new hash dependency: rejected because the
  supported runtimes already provide Web Crypto.
- Treating the reconstructed snapshot as action authority: rejected because
  transport data cannot prove current live UI state or policy.
- Silent deduplication, truncation, or best-effort apply: rejected because it
  hides producer corruption and gaps.

