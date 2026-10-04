import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { loadAcceptedCaptureOracle } from "./p4.3-capture-contracts.mjs";
import { admitSuiteRunRootPath, readNativeCaptureSuite, verifyNativeCapturePair, verifyNativeCaptureSuite } from "./p4.3-native-suite-contracts.mjs";

// Development evidence admission only. Fixed synthetic run directories and the
// separately reviewed source/binary freeze are required before artifact reads.
// This command never launches or mutates a native application or exposes a host.
export async function verifyOwnedNativeSuite(root, directory) {
  const { admitNativeSuiteFreeze } = await import("./p4.3-native-suite-source.mjs");
  const trusted = await admitNativeSuiteFreeze(root);
  const oracle = await loadAcceptedCaptureOracle(root);
  const input = await readNativeCaptureSuite(directory);
  return verifyNativeCaptureSuite(input.reportBytes, input.artifacts, trusted, oracle);
}

export async function verifyOwnedNativePair(root, runRoot) {
  const directory = admitSuiteRunRootPath(runRoot);
  const { admitNativeSuiteFreeze } = await import("./p4.3-native-suite-source.mjs");
  const trusted = await admitNativeSuiteFreeze(root), oracle = await loadAcceptedCaptureOracle(root);
  const firstInput = await readNativeCaptureSuite(join(directory, "first"));
  const first = verifyNativeCaptureSuite(firstInput.reportBytes, firstInput.artifacts, trusted, oracle);
  const repeatInput = await readNativeCaptureSuite(join(directory, "repeat"));
  const repeat = verifyNativeCaptureSuite(repeatInput.reportBytes, repeatInput.artifacts, trusted, oracle);
  return { ...verifyNativeCapturePair(first, repeat), sourceDigest: trusted.sourceDigest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || !["--directory", "--pair-root"].includes(process.argv[2])) throw new TypeError("suite_arguments_refused");
    if (process.argv[2] === "--pair-root") console.log(JSON.stringify(await verifyOwnedNativePair(process.cwd(), process.argv[3])));
    else {
      const result = await verifyOwnedNativeSuite(process.cwd(), process.argv[3]);
      console.log(JSON.stringify({ status: result.status, cases: result.cases, captures: result.captures,
        providerProbes: result.providerProbes, reportDigest: result.reportDigest, sourceDigest: result.sourceDigest }));
    }
  } catch { console.error("p4.3_native_capture_suite_refused"); process.exitCode = 1; }
}
