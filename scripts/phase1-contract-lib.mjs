export function findPhase1ContractDrift(manifest, actual) {
  const failures = [];
  if (actual.packageVersion !== manifest.packageVersion) {
    failures.push(
      `package version ${actual.packageVersion} != ${manifest.packageVersion}`,
    );
  }
  if (actual.contractVersion !== manifest.contractVersion) {
    failures.push(
      `contract version ${actual.contractVersion} != ${manifest.contractVersion}`,
    );
  }
  if (
    JSON.stringify(actual.runtimeExports) !==
    JSON.stringify(manifest.runtimeExports)
  ) {
    failures.push("runtime export names differ from the Phase 1 manifest");
  }
  for (const [path, expected] of Object.entries({
    ...manifest.declarationSha256,
    ...manifest.schemaSha256,
  })) {
    const value = actual.fileSha256[path];
    if (value === undefined) {
      failures.push(`${path} is missing; run npm run build first`);
    }
    else if (value !== expected) failures.push(`${path} hash changed`);
  }
  return failures;
}
