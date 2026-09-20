import type { Readable, Writable } from "node:stream";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createNodeAtomicWriter,
  createNodeReadInput,
  NodeIoError,
} from "./node-io.js";
import {
  executeNodeTrustedDriver,
  TrustedDriverExecutionError,
} from "./driver-host.js";
import {
  AgentCliHostError,
  type AgentCliHost,
} from "./types.js";

export interface NodeCliHostOptions {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly stdin?: Pick<Readable, typeof Symbol.asyncIterator>;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
}

const writeExact = async (stream: Writable, value: string): Promise<void> => {
  if (typeof value !== "string") throw new AgentCliHostError("output_io");
  await new Promise<void>((resolve, reject) => {
    stream.write(value, "utf8", (error?: Error | null) => {
      if (error) reject(new AgentCliHostError("output_io"));
      else resolve();
    });
  });
};

const driverFilesystemPath = (value: string): string => {
  if (value.startsWith("file:")) return resolve(fileURLToPath(new URL(value)));
  if (!isAbsolute(value)) throw new AgentCliHostError("driver_error");
  return resolve(value);
};

/** Creates the reference secure Node host without registering process handlers. */
export const createNodeCliHost = (options: NodeCliHostOptions): AgentCliHost => {
  const readInput = createNodeReadInput(
    options.cwd,
    options.stdin ?? process.stdin,
    options.signal,
  );
  const writeAtomic = createNodeAtomicWriter(options.cwd);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let protectedRecordDriver: string | undefined;

  return Object.freeze({
    cwd: options.cwd,
    signal: options.signal,
    readInput: async (request: Parameters<AgentCliHost["readInput"]>[0]) => {
      try {
        return await readInput(request);
      } catch (error) {
        if (error instanceof NodeIoError && error.kind === "cancelled") {
          throw new AgentCliHostError("cancelled");
        }
        throw new AgentCliHostError("input_io");
      }
    },
    writeAtomic: async (request: Parameters<AgentCliHost["writeAtomic"]>[0]) => {
      try {
        await writeAtomic({
          ...request,
          forbidPaths: protectedRecordDriver === undefined ? [] : [protectedRecordDriver],
        });
      } catch (error) {
        if (error instanceof NodeIoError && error.kind === "cancelled") {
          throw new AgentCliHostError("cancelled");
        }
        throw new AgentCliHostError("output_io");
      }
    },
    executeTrustedDriver: async (
      request: Parameters<AgentCliHost["executeTrustedDriver"]>[0],
    ) => {
      try {
        const result = await executeNodeTrustedDriver(request, options.cwd, options.signal);
        protectedRecordDriver = request.mode === "record"
          ? driverFilesystemPath(request.driver)
          : undefined;
        return result;
      } catch (error) {
        if (
          error instanceof TrustedDriverExecutionError &&
          error.reason === "cancelled"
        ) throw new AgentCliHostError("cancelled");
        throw new AgentCliHostError("driver_error");
      }
    },
    writeStdout: async (line: string) => writeExact(stdout, line),
    writeStderr: async (line: string) => writeExact(stderr, line),
  });
};
