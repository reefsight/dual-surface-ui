import { webcrypto } from "node:crypto";

// Vitest's VM pools intentionally start with a minimal global object. Restore
// the Web Crypto API that dual-surface-ui requires from its supported Node 20+
// runtime so idempotency tests exercise the production code path.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}
