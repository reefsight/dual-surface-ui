import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createNodeCliHost } from "../src/cli/node-host.js";
import { AgentCliHostError } from "../src/cli/types.js";

const collect = (stream: PassThrough): Promise<string> => new Promise((resolve) => {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

describe("reference Node CLI host", () => {
  it("writes supplied bytes exactly once to the selected channel", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutText = collect(stdout);
    const stderrText = collect(stderr);
    const host = createNodeCliHost({
      cwd: process.cwd(),
      signal: new AbortController().signal,
      stdin: Readable.from([]),
      stdout,
      stderr,
    });
    await host.writeStdout("one\n");
    await host.writeStderr("two\n");
    stdout.end();
    stderr.end();
    await expect(stdoutText).resolves.toBe("one\n");
    await expect(stderrText).resolves.toBe("two\n");
  });

  it("normalizes Node input failures without reflecting a path", async () => {
    const host = createNodeCliHost({
      cwd: process.cwd(),
      signal: new AbortController().signal,
      stdin: Readable.from([]),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    await expect(host.readInput({
      source: { kind: "file", path: "missing-private-name.json" },
      maxBytes: 128,
    })).rejects.toEqual(new AgentCliHostError("input_io"));
  });
});
