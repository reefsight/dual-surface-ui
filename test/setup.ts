import { webcrypto } from "node:crypto";
import { TransformStream } from "node:stream/web";

// Vitest's VM pools intentionally start with a minimal global object. Restore
// the Web Crypto API that dual-surface-ui requires from its supported Node 20+
// runtime so idempotency tests exercise the production code path.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

if (!globalThis.TransformStream) {
  Object.defineProperty(globalThis, "TransformStream", {
    configurable: true,
    value: TransformStream,
  });
}
