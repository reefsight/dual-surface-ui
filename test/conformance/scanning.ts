import type { CanonicalJson } from "../../src/delta/canonical.js";
import {
  canonicalConformanceBytes,
  captureConformanceJson,
  ConformanceValidationError,
  digestConformanceValue,
  isDigest,
  isRecord,
  withoutTopLevelField,
} from "./canonical.js";
import { CONFORMANCE_DOMAINS } from "./validation.js";
import {
  CONFORMANCE_SCAN_CHANNELS,
  type ConformanceScanChannel,
  type ConformanceScanChannelEvidence,
  type ConformanceScanEvidence,
  type ConformanceSentinel,
  type ConformanceSentinelInjection,
} from "./types.js";

export interface ConformanceSentinelCorpus {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-conformance-sentinel-set";
  readonly sentinelSetId: string;
  readonly sentinels: readonly ConformanceSentinel[];
  readonly sentinelSetDigest: `sha256:${string}`;
}

async function plainSha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function captureAndValidateSentinelCorpus(value: unknown): Promise<ConformanceSentinelCorpus> {
  const captured = captureConformanceJson(value);
  if (!isRecord(captured)) throw new ConformanceValidationError("invalid_sentinel_set");
  const keys = Object.keys(captured);
  if (keys.join("\0") !== ["kind", "schemaVersion", "sentinelSetId", "sentinelSetDigest", "sentinels"].sort().join("\0")) {
    throw new ConformanceValidationError("invalid_sentinel_set");
  }
  if (captured.schemaVersion !== "0.1" || captured.kind !== "agent-conformance-sentinel-set" || !isDigest(captured.sentinelSetDigest) || !Array.isArray(captured.sentinels)) {
    throw new ConformanceValidationError("invalid_sentinel_set");
  }
  if (captured.sentinels.length < 1 || captured.sentinels.length > 64) throw new ConformanceValidationError("invalid_sentinel_set");
  const ids = new Set<string>(); const values = new Set<string>();
  for (const item of captured.sentinels) {
    if (!isRecord(item) || Object.keys(item).sort().join("\0") !== ["sentinelId", "value", "channels", "sentinelDigest"].sort().join("\0")) {
      throw new ConformanceValidationError("invalid_sentinel");
    }
    if (
      typeof item.sentinelId !== "string" || !/^[A-Za-z0-9._~-]{1,128}$/.test(item.sentinelId) ||
      typeof item.value !== "string" || item.value.length < 16 || item.value.length > 512 ||
      !Array.isArray(item.channels) || item.channels.length !== 1 ||
      (item.channels[0] !== "fixture_host_input" && item.channels[0] !== "authoritative_state") ||
      !isDigest(item.sentinelDigest) || ids.has(item.sentinelId) || values.has(item.value)
    ) throw new ConformanceValidationError("invalid_sentinel");
    if (await plainSha256(item.value) !== item.sentinelDigest) throw new ConformanceValidationError("sentinel_digest_mismatch");
    ids.add(item.sentinelId); values.add(item.value);
  }
  const setDigest = await digestConformanceValue(
    CONFORMANCE_DOMAINS.suite,
    withoutTopLevelField(captured, "sentinelSetDigest"),
  );
  if (setDigest !== captured.sentinelSetDigest) throw new ConformanceValidationError("sentinel_set_digest_mismatch");
  return captured as unknown as ConformanceSentinelCorpus;
}

const countBytes = (haystack: Uint8Array, needle: Uint8Array): number => {
  let count = 0;
  for (let index = 0; index <= haystack.length - needle.length;) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) { matches = false; break; }
    }
    if (matches) { count += 1; index += needle.length; } else index += 1;
  }
  return count;
};

const toBytes = (value: unknown): Uint8Array =>
  value instanceof Uint8Array ? new Uint8Array(value) :
    typeof value === "string" ? new TextEncoder().encode(value) : canonicalConformanceBytes(value);

export class ConformanceScanCollector {
  readonly #corpus: ConformanceSentinelCorpus;
  readonly #evidence = new Map<ConformanceScanChannel, ConformanceScanChannelEvidence>();

  constructor(corpus: ConformanceSentinelCorpus) { this.#corpus = corpus; }

  scanEgress(channel: ConformanceScanChannel, value: unknown): void {
    const bytes = toBytes(value);
    for (const sentinel of this.#corpus.sentinels) {
      if (countBytes(bytes, new TextEncoder().encode(sentinel.value)) !== 0) {
        throw new ConformanceValidationError("secret_scan_failed");
      }
    }
    this.#mergeEgress(channel, bytes.byteLength);
  }

  scanTrusted(
    channel: "fixture_host_input" | "authoritative_state",
    value: unknown,
    expected: readonly ConformanceSentinelInjection[],
  ): void {
    const bytes = toBytes(value);
    const declarations = expected.filter((item) => item.channel === channel);
    if (declarations.length === 0) {
      this.scanEgress(channel, value);
      return;
    }
    const observed = declarations.map((declaration) => {
      const sentinel = this.#corpus.sentinels.find((item) => item.sentinelId === declaration.sentinelId);
      if (!sentinel || sentinel.sentinelDigest !== declaration.sentinelDigest) {
        throw new ConformanceValidationError("sentinel_declaration_mismatch");
      }
      const count = countBytes(bytes, new TextEncoder().encode(sentinel.value));
      if (count !== declaration.count) throw new ConformanceValidationError("sentinel_count_mismatch");
      return Object.freeze({ sentinelId: sentinel.sentinelId, sentinelDigest: sentinel.sentinelDigest, count });
    });
    for (const sentinel of this.#corpus.sentinels) {
      const declared = declarations.some((item) => item.sentinelId === sentinel.sentinelId);
      if (!declared && countBytes(bytes, new TextEncoder().encode(sentinel.value)) !== 0) {
        throw new ConformanceValidationError("unexpected_sentinel_injection");
      }
    }
    const prior = this.#evidence.get(channel);
    const priorExpected = prior?.kind === "trusted_injection" ? prior.expected : [];
    const priorObserved = prior?.kind === "trusted_injection" ? prior.observed : [];
    this.#evidence.set(channel, Object.freeze({
      channel, kind: "trusted_injection", bytesScanned: (prior?.bytesScanned ?? 0) + bytes.byteLength,
      expected: Object.freeze([...priorExpected, ...declarations.map(({ channel: _channel, ...item }) => Object.freeze(item))]),
      observed: Object.freeze([...priorObserved, ...observed]),
    }));
  }

  #mergeEgress(channel: ConformanceScanChannel, bytes: number): void {
    const prior = this.#evidence.get(channel);
    if (prior?.kind === "trusted_injection") {
      this.#evidence.set(channel, Object.freeze({ ...prior, bytesScanned: prior.bytesScanned + bytes }));
      return;
    }
    this.#evidence.set(channel, Object.freeze({
      channel, kind: "egress_artifact", bytesScanned: (prior?.bytesScanned ?? 0) + bytes, matches: 0,
    }));
  }

  evidence(): ConformanceScanEvidence {
    const channels = CONFORMANCE_SCAN_CHANNELS.map((channel) => {
      const evidence = this.#evidence.get(channel);
      if (!evidence) throw new ConformanceValidationError("missing_scan_channel");
      if (evidence.kind === "trusted_injection") {
        const compare = (left: Omit<ConformanceSentinelInjection, "channel">, right: Omit<ConformanceSentinelInjection, "channel">) => {
          const a = `${left.sentinelId}\0${left.sentinelDigest}\0${left.count}`;
          const b = `${right.sentinelId}\0${right.sentinelDigest}\0${right.count}`;
          return a < b ? -1 : a > b ? 1 : 0;
        };
        return Object.freeze({ ...evidence, expected: Object.freeze([...evidence.expected].sort(compare)), observed: Object.freeze([...evidence.observed].sort(compare)) });
      }
      return evidence;
    });
    return Object.freeze({
      sentinelSetDigest: this.#corpus.sentinelSetDigest,
      channels: Object.freeze(channels),
      bytesScanned: channels.reduce((total, item) => total + item.bytesScanned, 0),
    });
  }

  /** Returns only channels actually scanned by a real tier run. */
  partialEvidence(): readonly ConformanceScanChannelEvidence[] {
    return Object.freeze(CONFORMANCE_SCAN_CHANNELS.flatMap((channel) => {
      const evidence = this.#evidence.get(channel);
      return evidence ? [evidence] : [];
    }));
  }

  mergePartial(evidence: readonly ConformanceScanChannelEvidence[]): void {
    for (const item of evidence) {
      if (!CONFORMANCE_SCAN_CHANNELS.includes(item.channel)) {
        throw new ConformanceValidationError("invalid_scan_channel");
      }
      if (!Number.isSafeInteger(item.bytesScanned) || item.bytesScanned < 0) {
        throw new ConformanceValidationError("invalid_scan_evidence");
      }
      if (item.kind === "trusted_injection") {
        if (item.channel !== "fixture_host_input" && item.channel !== "authoritative_state") {
          throw new ConformanceValidationError("invalid_scan_evidence");
        }
        if (canonicalConformanceBytes(item.expected).byteLength !== canonicalConformanceBytes(item.observed).byteLength ||
          JSON.stringify(item.expected) !== JSON.stringify(item.observed)) {
          throw new ConformanceValidationError("invalid_scan_evidence");
        }
        const prior = this.#evidence.get(item.channel);
        if (prior && prior.kind !== "trusted_injection") throw new ConformanceValidationError("invalid_scan_evidence");
        this.#evidence.set(item.channel, Object.freeze({
          channel: item.channel,
          kind: "trusted_injection",
          bytesScanned: (prior?.bytesScanned ?? 0) + item.bytesScanned,
          expected: Object.freeze([...(prior?.kind === "trusted_injection" ? prior.expected : []), ...item.expected]),
          observed: Object.freeze([...(prior?.kind === "trusted_injection" ? prior.observed : []), ...item.observed]),
        }));
      } else {
        if (item.matches !== 0) throw new ConformanceValidationError("secret_scan_failed");
        this.#mergeEgress(item.channel, item.bytesScanned);
      }
    }
  }

  recordScannedEgressBytes(channel: ConformanceScanChannel, bytesScanned: number): void {
    if (!Number.isSafeInteger(bytesScanned) || bytesScanned <= 0) {
      throw new ConformanceValidationError("invalid_scan_evidence");
    }
    this.#mergeEgress(channel, bytesScanned);
  }
}
