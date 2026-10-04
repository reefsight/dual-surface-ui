import { admitCapturePublication, loadAcceptedCaptureOracle, parseCapturePublication } from "./p4.3-capture-contracts.mjs";

// Receives actual C# unit output from the fixed launcher, not a golden-generated
// sample. This proves serialization/schema/policy interoperability only.
try {
  let total = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    total += chunk.byteLength;
    if (total > 16384) throw new Error("unit_output_budget");
    chunks.push(chunk);
  }
  const output = parseCapturePublication(Buffer.concat(chunks));
  const keys = ["kind", "cases", "nativeExecuted", "publication"];
  if (Object.keys(output).length !== keys.length || keys.some(k => !(k in output)) ||
      output.kind !== "p4.3-capture-foundation-unit" || !Number.isInteger(output.cases) || output.cases < 1 || output.nativeExecuted !== false)
    throw new Error("unit_output_shape");
  const { manifest, validators } = await loadAcceptedCaptureOracle(process.cwd());
  const publication = admitCapturePublication(Buffer.from(JSON.stringify(output.publication), "utf8"), validators, manifest);
  console.log(JSON.stringify({ kind: "p4.3-capture-foundation-interop", unitCases: output.cases,
    subjects: publication.publicSnapshot.nodes.length, nativeExecuted: false, coreAndProtocolAdmitted: true }));
} catch {
  console.error("p4.3_capture_unit_interop_refused"); process.exitCode = 1;
}
