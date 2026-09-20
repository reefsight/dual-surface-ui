#!/usr/bin/env node

import { createNodeCliHost } from "./node-host.js";
import { createAgentCliError, serializeAgentCliOutput } from "./output.js";
import { runAgentCli } from "./runner.js";

const controller = new AbortController();
const abort = (): void => controller.abort();
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

try {
  const host = createNodeCliHost({
    cwd: process.cwd(),
    signal: controller.signal,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exitCode = await runAgentCli(process.argv.slice(2), host);
} catch {
  try {
    process.stderr.write(serializeAgentCliOutput(createAgentCliError("internal_error")));
  } catch {
    // The process exit code remains authoritative if the stderr sink itself failed.
  }
  process.exitCode = 70;
} finally {
  process.removeListener("SIGINT", abort);
  process.removeListener("SIGTERM", abort);
}
