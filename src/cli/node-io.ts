import { createHash, randomBytes } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  type ReadStream,
} from "node:fs";
import {
  link,
  lstat,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

import { MAX_CLI_INPUT_BYTES } from "./json-input.js";

export const MAX_NODE_OUTPUT_BYTES = MAX_CLI_INPUT_BYTES;

export type NodeIoErrorKind = "input" | "output" | "cancelled";

export class NodeIoError extends Error {
  readonly kind: NodeIoErrorKind;

  constructor(kind: NodeIoErrorKind) {
    super(
      kind === "input"
        ? "Unable to read input."
        : kind === "output"
          ? "Unable to write output."
          : "Operation cancelled.",
    );
    this.name = "NodeIoError";
    this.kind = kind;
  }
}

export interface NodeReadInputRequest {
  readonly source:
    | { readonly kind: "stdin" }
    | { readonly kind: "file"; readonly path: string };
  readonly maxBytes: number;
}

export interface NodeAtomicWriteRequest {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly force: boolean;
  readonly signal: AbortSignal;
  /** Existing files whose identity must never be replaced by this write. */
  readonly forbidPaths?: readonly string[];
}

type NodeStdin = Pick<Readable, typeof Symbol.asyncIterator> & {
  readonly destroy?: () => unknown;
};

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

interface ChainEntry extends FileIdentity {
  readonly path: string;
}

const WINDOWS_DEVICE_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error;

const isMissing = (error: unknown): boolean =>
  isNodeError(error) && error.code === "ENOENT";

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const identityOf = (value: { readonly dev: bigint; readonly ino: bigint }): FileIdentity => ({
  dev: value.dev,
  ino: value.ino,
});

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new NodeIoError("cancelled");
};

/** Captures and validates the process working directory exactly once. */
export function captureNodeCwd(cwd = process.cwd()): string {
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.includes("\0") || !isAbsolute(cwd)) {
    throw new NodeIoError("input");
  }
  return resolve(cwd);
}

const hasUrlSyntax = (value: string): boolean => {
  if (/^[A-Za-z]:[\\/]/u.test(value)) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
};

const resolveLocalPath = (cwd: string, value: string, kind: "input" | "output"): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    hasUrlSyntax(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\")
  ) {
    throw new NodeIoError(kind);
  }
  const absolute = resolve(cwd, value);
  if (process.platform === "win32") {
    const components = relative(parse(absolute).root, absolute).split(/[\\/]+/u);
    if (components.some((component) => WINDOWS_DEVICE_COMPONENT.test(component))) {
      throw new NodeIoError(kind);
    }
  }
  return absolute;
};

const pathComponents = (absolutePath: string): readonly string[] => {
  const root = parse(absolutePath).root;
  const suffix = relative(root, absolutePath);
  const components: string[] = [root];
  let current = root;
  for (const component of suffix.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    components.push(current);
  }
  return components;
};

const inspectDirectoryChain = async (directory: string): Promise<readonly ChainEntry[]> => {
  const result: ChainEntry[] = [];
  for (const component of pathComponents(directory)) {
    const info = await lstat(component, { bigint: true });
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe path component");
    result.push({ path: component, ...identityOf(info) });
  }
  return result;
};

const recheckDirectoryChain = async (expected: readonly ChainEntry[]): Promise<void> => {
  for (const entry of expected) {
    const info = await lstat(entry.path, { bigint: true });
    if (info.isSymbolicLink() || !info.isDirectory() || !sameIdentity(entry, info)) {
      throw new Error("directory chain changed");
    }
  }
};

const assertSafeTarget = async (target: string, force: boolean): Promise<boolean> => {
  try {
    const info = await lstat(target, { bigint: true });
    if (info.isSymbolicLink() || !info.isFile() || !force) throw new Error("unsafe target");
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
};

const assertTargetNotForbidden = async (
  target: string,
  forbiddenPaths: readonly string[],
): Promise<void> => {
  if (forbiddenPaths.length === 0) return;
  const normalizedTarget = resolve(target);
  let targetIdentity: FileIdentity | undefined;
  try {
    const targetInfo = await lstat(normalizedTarget, { bigint: true });
    if (targetInfo.isSymbolicLink() || !targetInfo.isFile()) throw new Error("unsafe target");
    targetIdentity = identityOf(targetInfo);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  for (const forbiddenPath of forbiddenPaths) {
    if (!isAbsolute(forbiddenPath)) throw new Error("invalid forbidden path");
    const normalizedForbidden = resolve(forbiddenPath);
    if (
      process.platform === "win32"
        ? normalizedTarget.toLowerCase() === normalizedForbidden.toLowerCase()
        : normalizedTarget === normalizedForbidden
    ) throw new Error("output target is protected");
    const forbiddenInfo = await lstat(normalizedForbidden, { bigint: true });
    if (forbiddenInfo.isSymbolicLink() || !forbiddenInfo.isFile()) throw new Error("unsafe forbidden path");
    if (targetIdentity !== undefined && sameIdentity(targetIdentity, forbiddenInfo)) {
      throw new Error("output target aliases a protected file");
    }
  }
};

const openRegularFile = async (path: string): Promise<FileHandle> => {
  const noFollow = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
  const handle = await open(path, fsConstants.O_RDONLY | noFollow);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile()) throw new Error("input is not a regular file");
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
};

const readHandleBounded = async (handle: FileHandle, maxBytes: number): Promise<Uint8Array> => {
  const info = await handle.stat({ bigint: true });
  if (info.size > BigInt(maxBytes)) throw new Error("input too large");
  const chunks: Buffer[] = [];
  let total = 0;
  const stream: ReadStream = createReadStream("", {
    fd: handle.fd,
    autoClose: false,
    start: 0,
  });
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error("input too large");
    }
    chunks.push(buffer);
  }
  const after = await handle.stat({ bigint: true });
  if (
    !sameIdentity(info, after) ||
    after.size !== BigInt(total) ||
    after.mtimeNs !== info.mtimeNs ||
    after.ctimeNs !== info.ctimeNs
  ) {
    throw new Error("input changed during read");
  }
  return new Uint8Array(Buffer.concat(chunks, total));
};

const readStdinBounded = async (
  stdin: NodeStdin,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  let total = 0;
  const iterator = stdin[Symbol.asyncIterator]();
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      try { stdin.destroy?.(); } catch { /* cancellation remains authoritative */ }
      reject(new NodeIoError("cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    throwIfAborted(signal);
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      throwIfAborted(signal);
      if (next.done) break;
      const chunk = next.value;
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
      total += buffer.byteLength;
      if (total > maxBytes) throw new Error("stdin too large");
      chunks.push(buffer);
    }
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    if (signal.aborted && iterator.return !== undefined) {
      void Promise.resolve(iterator.return()).catch(() => undefined);
    }
  }
  return new Uint8Array(Buffer.concat(chunks, total));
};

const validateByteLimit = (maxBytes: number): void => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_CLI_INPUT_BYTES) {
    throw new Error("invalid byte limit");
  }
};

/** Creates a bounded input reader pinned to one captured working directory. */
export function createNodeReadInput(
  cwd: string,
  stdin: NodeStdin = process.stdin,
  signal: AbortSignal = new AbortController().signal,
): (request: Readonly<NodeReadInputRequest>) => Promise<Uint8Array> {
  const capturedCwd = captureNodeCwd(cwd);
  return async (request): Promise<Uint8Array> => {
    try {
      validateByteLimit(request.maxBytes);
      if (request.source.kind === "stdin") {
        return await readStdinBounded(stdin, request.maxBytes, signal);
      }
      const inputPath = resolveLocalPath(capturedCwd, request.source.path, "input");
      const parent = resolve(inputPath, "..");
      const chain = await inspectDirectoryChain(parent);
      const before = await lstat(inputPath, { bigint: true });
      if (before.isSymbolicLink() || !before.isFile()) throw new Error("unsafe input");
      const handle = await openRegularFile(inputPath);
      try {
        const opened = await handle.stat({ bigint: true });
        if (!sameIdentity(before, opened)) throw new Error("input changed before open");
        const bytes = await readHandleBounded(handle, request.maxBytes);
        await recheckDirectoryChain(chain);
        const after = await lstat(inputPath, { bigint: true });
        if (after.isSymbolicLink() || !after.isFile() || !sameIdentity(opened, after)) {
          throw new Error("input path changed during read");
        }
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof NodeIoError) throw error;
      throw new NodeIoError("input");
    }
  };
}

const digestBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const validateOwnedFile = async (
  path: string,
  expectedIdentity: FileIdentity,
  expectedBytes: Uint8Array,
): Promise<void> => {
  const info = await lstat(path, { bigint: true });
  if (info.isSymbolicLink() || !info.isFile() || !sameIdentity(expectedIdentity, info)) {
    throw new Error("owned file identity changed");
  }
  const handle = await openRegularFile(path);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(expectedIdentity, opened) || opened.size !== BigInt(expectedBytes.byteLength)) {
      throw new Error("owned file changed");
    }
    const actual = await readHandleBounded(handle, expectedBytes.byteLength);
    if (digestBytes(actual) !== digestBytes(expectedBytes)) throw new Error("owned file digest changed");
  } finally {
    await handle.close();
  }
};

const removeOwnedTemp = async (path: string, identity: FileIdentity): Promise<void> => {
  try {
    const info = await lstat(path, { bigint: true });
    if (info.isSymbolicLink() || !info.isFile() || !sameIdentity(identity, info)) return;
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};

const createOwnedTemp = async (
  directory: string,
  basename: string,
): Promise<{ readonly handle: FileHandle; readonly path: string; readonly identity: FileIdentity }> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomBytes(16).toString("hex");
    const tempPath = resolve(directory, `.${basename}.dual-surface-ui-${process.pid}-${suffix}.tmp`);
    try {
      const handle = await open(
        tempPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
        0o600,
      );
      try {
        await handle.chmod(0o600);
        const info = await handle.stat({ bigint: true });
        return { handle, path: tempPath, identity: identityOf(info) };
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("unable to allocate temporary output");
};

/** Creates an atomic writer pinned to one captured working directory. */
export function createNodeAtomicWriter(
  cwd: string,
): (request: Readonly<NodeAtomicWriteRequest>) => Promise<void> {
  const capturedCwd = captureNodeCwd(cwd);
  return async (request): Promise<void> => {
    let ownedTemp: { readonly path: string; readonly identity: FileIdentity } | undefined;
    let committed = false;
    try {
      throwIfAborted(request.signal);
      if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength > MAX_NODE_OUTPUT_BYTES) {
        throw new Error("invalid output bytes");
      }
      if (typeof request.force !== "boolean") throw new Error("invalid force option");

      const target = resolveLocalPath(capturedCwd, request.path, "output");
      const parsed = parse(target);
      const directory = resolve(target, "..");
      if (target === parsed.root) throw new Error("invalid output target");
      const chain = await inspectDirectoryChain(directory);
      await assertSafeTarget(target, request.force);
      await assertTargetNotForbidden(target, request.forbidPaths ?? []);

      const temp = await createOwnedTemp(directory, parsed.base);
      ownedTemp = { path: temp.path, identity: temp.identity };
      try {
        await temp.handle.writeFile(request.bytes, { signal: request.signal });
        await temp.handle.sync();
      } finally {
        await temp.handle.close();
      }
      await validateOwnedFile(temp.path, temp.identity, request.bytes);

      throwIfAborted(request.signal);
      await recheckDirectoryChain(chain);
      const targetExists = await assertSafeTarget(target, request.force);
      await assertTargetNotForbidden(target, request.forbidPaths ?? []);
      throwIfAborted(request.signal);

      if (request.force && targetExists) {
        // Node does not document atomic replace semantics for rename on Windows.
        if (process.platform === "win32") throw new Error("atomic replacement unsupported");
        await rename(temp.path, target);
      } else {
        await link(temp.path, target);
      }
      committed = true;

      await validateOwnedFile(target, temp.identity, request.bytes);
      if (!(request.force && targetExists)) await removeOwnedTemp(temp.path, temp.identity);
      ownedTemp = undefined;
    } catch (error) {
      if (error instanceof NodeIoError) throw error;
      if (!committed && request.signal.aborted) {
        throw new NodeIoError("cancelled");
      }
      throw new NodeIoError("output");
    } finally {
      if (ownedTemp !== undefined) {
        await removeOwnedTemp(ownedTemp.path, ownedTemp.identity).catch(() => undefined);
      }
    }
  };
}
