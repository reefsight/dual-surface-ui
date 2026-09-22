export type NativeProtocolVersion = "0.1";

export type NativeProtocolCapability =
  | "actions"
  | "cancellation"
  | "deltas"
  | "events"
  | "snapshots"
  | "surface-catalog";

export interface NativeProtocolClientHello {
  readonly schemaVersion: "0.1";
  readonly kind: "client-hello";
  readonly requestId: string;
  readonly supportedVersions: readonly NativeProtocolVersion[];
  readonly capabilities: readonly NativeProtocolCapability[];
  readonly requiredCapabilities: readonly NativeProtocolCapability[];
}

export interface NativeProtocolLimits {
  readonly frameBytes: number;
  readonly snapshotBytes: number;
  readonly deltaBytes: number;
  readonly actionResultBytes: number;
  readonly errorMessageCharacters: number;
  readonly surfaces: number;
  readonly actionsPerSurface: number;
}

export interface NativeProtocolServerHello {
  readonly schemaVersion: "0.1";
  readonly kind: "server-hello";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly protocolVersion: NativeProtocolVersion;
  readonly capabilities: readonly NativeProtocolCapability[];
  readonly limits: NativeProtocolLimits;
}

export type NativeProtocolErrorCode =
  | "invalid_message"
  | "missing_required_capability"
  | "no_compatible_version";

export interface NativeProtocolError {
  readonly schemaVersion: "0.1";
  readonly kind: "protocol-error";
  readonly requestId: string | null;
  readonly code: NativeProtocolErrorCode;
  readonly message: string;
}

export type NativeProtocolHandshakeMessage =
  | NativeProtocolClientHello
  | NativeProtocolServerHello
  | NativeProtocolError;

export interface NativeProtocolNegotiationOptions {
  readonly sessionRef: string;
  readonly capabilities: readonly NativeProtocolCapability[];
}

export type NativeProtocolNegotiationResult =
  | {
      readonly status: "accepted";
      readonly message: NativeProtocolServerHello;
    }
  | {
      readonly status: "rejected";
      readonly message: NativeProtocolError;
    };
