import type { AgentAuditEvent } from "../audit.js";

export type AgentCliJson =
  | null
  | boolean
  | number
  | string
  | readonly AgentCliJson[]
  | { readonly [key: string]: AgentCliJson };

export type AgentCliDigest = `sha256:${string}`;
export type AgentCliExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 70;

export interface AgentEvaluationCaseDefinition {
  readonly caseId: string;
  readonly input: AgentCliJson;
  readonly expected: Readonly<Record<string, AgentCliJson>>;
}

export interface AgentEvaluationDefinition {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-evaluation-definition";
  readonly suiteId: string;
  readonly dimensions: readonly string[];
  readonly cases: readonly AgentEvaluationCaseDefinition[];
  readonly definitionDigest: AgentCliDigest;
}

export interface AgentEvaluationScore {
  readonly dimension: string;
  readonly earned: 0 | 1;
  readonly possible: 1;
}

export type AgentEvaluationCaseResult =
  | {
      readonly caseId: string;
      readonly status: "scored";
      readonly scores: readonly AgentEvaluationScore[];
    }
  | {
      readonly caseId: string;
      readonly status: "environment_error";
      readonly code: "environment_unavailable";
    };

export interface AgentEvaluationDimensionResult {
  readonly dimension: string;
  readonly earned: number;
  readonly possible: number;
  readonly unscored: number;
}

export interface AgentEvaluationResult {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-evaluation-result";
  readonly suiteId: string;
  readonly definitionDigest: AgentCliDigest;
  readonly driverId: string;
  readonly status: "complete" | "incomplete";
  readonly caseCount: number;
  readonly dimensionCount: number;
  readonly cases: readonly AgentEvaluationCaseResult[];
  readonly dimensions: readonly AgentEvaluationDimensionResult[];
  readonly environmentErrors: number;
}

export type AgentEvaluationDriverCaseResult =
  | {
      readonly status: "observed";
      readonly observations: Readonly<Record<string, AgentCliJson>>;
    }
  | { readonly status: "environment_unavailable" };

export interface AgentEvaluationCaseObservation {
  readonly caseId: string;
  readonly result: AgentEvaluationDriverCaseResult;
}

export interface AgentCliTrustedDriver {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-cli-driver";
  readonly driverId: string;
  readonly record?: (context: Readonly<{
    signal: AbortSignal;
    emitAudit: (event: AgentAuditEvent) => void;
  }>) => void | Promise<void>;
  readonly evaluateCase?: (
    request: Readonly<{ caseId: string; input: AgentCliJson }>,
    context: Readonly<{ signal: AbortSignal }>,
  ) => Promise<AgentEvaluationDriverCaseResult>;
}

export type CreateDualSurfaceCliDriver = () =>
  | AgentCliTrustedDriver
  | Promise<AgentCliTrustedDriver>;
