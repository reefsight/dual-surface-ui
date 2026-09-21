import type { CanonicalJson } from "../../src/delta/canonical.js";

export const CONFORMANCE_CASE_IDS = [
  "DISC-01", "DISC-02", "SUCCESS-01", "SUCCESS-02", "INVALID-01",
  "STALE-01", "REPLACED-01", "DENY-01", "CONFIRM-01", "CONFIRM-02",
  "PRE-01", "PRE-02", "VERIFY-01", "VERIFY-02", "REPLAY-01",
  "CONFLICT-01", "ORIGIN-01", "PRINCIPAL-01", "SURFACE-01",
  "CANCEL-01", "CANCEL-02", "DISP-01", "DISP-02", "REDACT-01",
  "REDACT-02", "REDACT-03",
] as const;

export const CONFORMANCE_TARGETS = [
  { targetId: "dom-jsdom", family: "dom", tier: "in-process" },
  { targetId: "webmcp-compat", family: "webmcp", tier: "compatibility" },
  { targetId: "webmcp-native", family: "webmcp", tier: "native-webmcp" },
  { targetId: "mcp-sdk", family: "mcp", tier: "protocol" },
  { targetId: "playwright-managed", family: "playwright", tier: "managed-engine" },
] as const;

export const CONFORMANCE_SCAN_CHANNELS = [
  "scenario_artifacts", "capability_matrix", "suite_manifest",
  "fixture_host_input", "authoritative_state", "driver_result",
  "normalized_observation", "mismatches", "report_payload", "stdout",
  "stderr", "packed_tarball_files", "installed_package_files",
] as const;

export type ConformanceCaseId = typeof CONFORMANCE_CASE_IDS[number];
export type ConformanceTarget = typeof CONFORMANCE_TARGETS[number];
export type ConformanceTargetId = ConformanceTarget["targetId"];
export type ConformanceFamily = ConformanceTarget["family"];
export type ConformanceTier = ConformanceTarget["tier"];
export type ConformanceScanChannel = typeof CONFORMANCE_SCAN_CHANNELS[number];
export type ConformanceDigest = `sha256:${string}`;
export type ConformanceCapabilityStatus = "supported" | "unsupported";
export type ConformanceUnsupportedReason =
  | "dom_no_abort_signal"
  | "dom_no_disposal_boundary";

export interface ConformanceSentinelInjection {
  readonly channel: "fixture_host_input" | "authoritative_state";
  readonly sentinelId: string;
  readonly sentinelDigest: ConformanceDigest;
  readonly count: number;
}

export interface ConformanceScenario {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-conformance-scenario";
  readonly scenarioId: ConformanceCaseId;
  readonly capability: string;
  readonly actions: readonly CanonicalJson[];
  readonly initialState: CanonicalJson;
  readonly requests: readonly CanonicalJson[];
  readonly sentinelInjections: readonly ConformanceSentinelInjection[];
  readonly expected: CanonicalJson;
  readonly scenarioDigest: ConformanceDigest;
}

export interface ConformanceCapabilityEntry {
  readonly targetId: ConformanceTargetId;
  readonly status: ConformanceCapabilityStatus;
  readonly reason?: ConformanceUnsupportedReason;
}

export interface ConformanceCapabilityCase {
  readonly caseId: ConformanceCaseId;
  readonly capability: string;
  readonly targets: readonly ConformanceCapabilityEntry[];
}

export interface ConformanceCapabilityMatrix {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-conformance-capability-matrix";
  readonly matrixId: string;
  readonly targets: readonly ConformanceTarget[];
  readonly cases: readonly ConformanceCapabilityCase[];
  readonly matrixDigest: ConformanceDigest;
}

export interface ConformanceSuiteScenarioBinding {
  readonly caseId: ConformanceCaseId;
  readonly scenarioId: ConformanceCaseId;
  readonly scenarioDigest: ConformanceDigest;
  readonly injectionDigest: ConformanceDigest;
}

export interface ConformanceSuiteManifest {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-conformance-suite";
  readonly suiteId: string;
  readonly matrixDigest: ConformanceDigest;
  readonly scenarios: readonly ConformanceSuiteScenarioBinding[];
  readonly fixtureHostDigest: ConformanceDigest;
  readonly driverDigests: Readonly<Record<ConformanceTargetId, ConformanceDigest>>;
  readonly sentinelSetDigest: ConformanceDigest;
  readonly scanChannels: readonly ConformanceScanChannel[];
  readonly suiteDigest: ConformanceDigest;
}

export interface ConformanceDriverInput {
  readonly scenarioId: ConformanceCaseId;
  readonly driverInput: CanonicalJson;
}

export interface ConformanceDriver {
  readonly targetId: ConformanceTargetId;
  readonly family: ConformanceFamily;
  readonly tier: ConformanceTier;
  run(input: Readonly<ConformanceDriverInput>, signal: AbortSignal): Promise<unknown>;
}

export interface ConformanceExecutionPlan {
  readonly scenarioId: ConformanceCaseId;
  readonly actions: readonly CanonicalJson[];
  readonly initialState: CanonicalJson;
  readonly requests: readonly CanonicalJson[];
}

export interface ConformanceFixtureExecution {
  readonly scenarioId: ConformanceCaseId;
  readonly driverInput: CanonicalJson;
  readAuthoritativeState(): unknown | Promise<unknown>;
  dispose(): void | Promise<void>;
}

export interface ConformanceFixtureHost {
  create(plan: Readonly<ConformanceExecutionPlan>, target: ConformanceTarget):
    ConformanceCaseBinding | Promise<ConformanceCaseBinding>;
}

export interface ConformanceCaseBinding {
  readonly driver: ConformanceDriver;
  readonly execution: ConformanceFixtureExecution;
}

export interface NormalizedDiscovery {
  readonly actionRef: string;
  readonly risk: "read" | "write" | "consequential" | "destructive" | "credential";
  readonly requiresConfirmation: boolean;
  readonly idempotency: "none" | "keyed" | "safe-retry";
  readonly inputSchemaDigest?: ConformanceDigest;
  readonly outputSchemaDigest?: ConformanceDigest;
}

export type NormalizedOutcome =
  | Readonly<{ operation: number; status: "succeeded"; previousRevisionRef: string; revisionRef: string; actionRef: string; targetPresent: boolean; outputDigest?: ConformanceDigest }>
  | Readonly<{ operation: number; status: "failed"; revisionRef: string; code: string }>;

export interface NormalizedLifecycleEvent {
  readonly operation: number;
  readonly event: string;
  readonly outcome: string;
  readonly sequence: number;
  readonly revisionRef: string;
  readonly actionRef?: string;
}

export interface NormalizedConformanceObservation {
  readonly discovery: readonly NormalizedDiscovery[];
  readonly outcomes: readonly NormalizedOutcome[];
  readonly lifecycle: readonly NormalizedLifecycleEvent[];
  readonly finalStateDigest: ConformanceDigest;
}

export interface ConformanceDifference {
  readonly path: "discovery" | "outcome" | "lifecycle" | "final_state" | "secret_channel";
  readonly operation?: number;
  readonly index?: number;
  readonly actionRef?: string;
}

export type ConformanceCaseResult =
  | Readonly<{ caseId: ConformanceCaseId; scenarioDigest: ConformanceDigest; status: "passed" }>
  | Readonly<{ caseId: ConformanceCaseId; scenarioDigest: ConformanceDigest; status: "failed"; failureClass: "discovery_mismatch" | "outcome_mismatch" | "lifecycle_mismatch" | "final_state_mismatch" | "secret_scan_failed" | "driver_result_invalid"; differences: readonly ConformanceDifference[] }>
  | Readonly<{ caseId: ConformanceCaseId; scenarioDigest: ConformanceDigest; status: "unsupported"; reason: ConformanceUnsupportedReason }>;

export interface ConformanceSentinel {
  readonly sentinelId: string;
  readonly value: string;
  readonly channels: readonly ("fixture_host_input" | "authoritative_state")[];
  readonly sentinelDigest: ConformanceDigest;
}

export type ConformanceScanChannelEvidence =
  | Readonly<{ channel: "fixture_host_input" | "authoritative_state"; kind: "trusted_injection"; bytesScanned: number; expected: readonly Omit<ConformanceSentinelInjection, "channel">[]; observed: readonly Omit<ConformanceSentinelInjection, "channel">[] }>
  | Readonly<{ channel: ConformanceScanChannel; kind: "egress_artifact"; bytesScanned: number; matches: 0 }>;

export interface ConformanceScanEvidence {
  readonly sentinelSetDigest: ConformanceDigest;
  readonly channels: readonly ConformanceScanChannelEvidence[];
  readonly bytesScanned: number;
}

export interface ConformanceRunResult {
  readonly targetId: ConformanceTargetId;
  readonly family: ConformanceFamily;
  readonly tier: ConformanceTier;
  readonly runStatus: "completed";
  readonly environment: Readonly<Record<string, string>>;
  readonly cases: readonly ConformanceCaseResult[];
  readonly summary: { readonly passed: number; readonly failed: number; readonly unsupported: number };
}

export interface ConformanceEnvironmentFailure {
  readonly targetId: ConformanceTargetId;
  readonly family: ConformanceFamily;
  readonly tier: ConformanceTier;
  readonly runStatus: "environment_failed";
  readonly environment: Readonly<Record<string, string>>;
  readonly cases: readonly [];
  readonly reason: "native_api_unavailable" | "browser_launch_failed" | "protocol_environment_failed";
  readonly summary: { readonly passed: 0; readonly failed: 0; readonly unsupported: 0 };
}

export type ConformanceRun = ConformanceRunResult | ConformanceEnvironmentFailure;
