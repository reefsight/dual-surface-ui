import { pathToFileURL } from "node:url";
import { parseCapturePublication } from "./p4.3-capture-contracts.mjs";

export function admitCollectorUnitSummary(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024) throw new TypeError("collector_unit_refused");
  const summary = parseCapturePublication(bytes);
  if (summary === null || typeof summary !== "object" || Array.isArray(summary) ||
      Object.keys(summary).sort().join(",") !== "cases,kind,nativeExecuted" ||
      summary.kind !== "p4.3-native-collector-unit" || !Number.isInteger(summary.cases) ||
      summary.cases < 1 || summary.cases > 512 || summary.nativeExecuted !== false)
    throw new TypeError("collector_unit_refused");
  return { kind: summary.kind, cases: summary.cases, nativeExecuted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let length = 0; const chunks = [];
    for await (const chunk of process.stdin) {
      length += chunk.byteLength;
      if (length > 1024) throw new TypeError("collector_unit_refused");
      chunks.push(chunk);
    }
    console.log(JSON.stringify(admitCollectorUnitSummary(Buffer.concat(chunks))));
  } catch { console.error("p4.3_native_collector_unit_summary_refused"); process.exitCode = 1; }
}
