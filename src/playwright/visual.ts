import type { Page } from "playwright-core";
import { PNG } from "pngjs";

import type { PlaywrightVisualCandidate, PlaywrightVisualRequest } from "./types.js";

export const MAX_VISUAL_CANDIDATES = 128;
export const MAX_VISUAL_MASKS = 512;
export const MAX_VISUAL_WIDTH = 1920;
export const MAX_VISUAL_HEIGHT = 1080;
export const MAX_VISUAL_PIXELS = MAX_VISUAL_WIDTH * MAX_VISUAL_HEIGHT;
export const MAX_VISUAL_BYTES = 4 * 1024 * 1024;
const CALLBACK_TIMEOUT_MS = 10_000;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export interface PlaywrightVisualCandidateBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function abortError(): Error {
  const error = new Error("Visual selection was aborted");
  error.name = "AbortError";
  return error;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function validPng(image: Uint8Array, width: number, height: number): boolean {
  if (image.length < 24 || image.length > MAX_VISUAL_BYTES) return false;
  if (!PNG_SIGNATURE.every((byte, index) => image[index] === byte)) return false;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  return view.getUint32(16) === width && view.getUint32(20) === height;
}

async function selectWithDeadline(
  selectCandidate: (request: PlaywrightVisualRequest) => string | undefined | Promise<string | undefined>,
  request: PlaywrightVisualRequest,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  assertNotAborted(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Visual selection callback timed out")), CALLBACK_TIMEOUT_MS);
    if (signal) {
      abortListener = () => reject(abortError());
      signal.addEventListener("abort", abortListener, { once: true });
    }
  });
  try {
    return await Promise.race([Promise.resolve().then(() => selectCandidate(request)), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}

export async function createVisualCandidateSelection(options: {
  page: Page;
  candidateBoxes: readonly PlaywrightVisualCandidateBox[];
  candidates: readonly PlaywrightVisualCandidate[];
  selectCandidate: (request: PlaywrightVisualRequest) => string | undefined | Promise<string | undefined>;
  validateBeforeCallback: () => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  assertNotAborted(options.signal);
  const viewport = options.page.viewportSize();
  if (
    !viewport || viewport.width < 1 || viewport.height < 1 ||
    viewport.width > MAX_VISUAL_WIDTH || viewport.height > MAX_VISUAL_HEIGHT ||
    viewport.width * viewport.height > MAX_VISUAL_PIXELS ||
    options.candidates.length === 0 || options.candidates.length > MAX_VISUAL_CANDIDATES ||
    options.candidateBoxes.length !== options.candidates.length
  ) return undefined;

  let image: Uint8Array | undefined;
  let decoded: PNG | undefined;
  try {
    decoded = new PNG({ width: viewport.width, height: viewport.height });
    decoded.data.fill(0);
    for (let offset = 3; offset < decoded.data.length; offset += 4) decoded.data[offset] = 255;
    for (const [index, box] of options.candidateBoxes.entries()) {
      const marker = options.candidates[index]!.marker;
      const red = Number.parseInt(marker.slice(1, 3), 16);
      const green = Number.parseInt(marker.slice(3, 5), 16);
      const blue = Number.parseInt(marker.slice(5, 7), 16);
      const left = Math.max(0, Math.floor(box.x));
      const top = Math.max(0, Math.floor(box.y));
      const right = Math.min(decoded.width, Math.ceil(box.x + box.width));
      const bottom = Math.min(decoded.height, Math.ceil(box.y + box.height));
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (decoded.width * y + x) * 4;
          decoded.data[offset] = red;
          decoded.data[offset + 1] = green;
          decoded.data[offset + 2] = blue;
          decoded.data[offset + 3] = 255;
        }
      }
    }
    const encoded = PNG.sync.write(decoded);
    image = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    if (!validPng(image, viewport.width, viewport.height)) return undefined;
    if (!await options.validateBeforeCallback()) return undefined;
    assertNotAborted(options.signal);
    const candidates = Object.freeze(options.candidates.map((candidate) => Object.freeze({ ...candidate })));
    const request = Object.freeze({ image, mimeType: "image/png" as const, candidates });
    const selected = await selectWithDeadline(options.selectCandidate, request, options.signal);
    assertNotAborted(options.signal);
    return typeof selected === "string" && candidates.some((candidate) => candidate.id === selected)
      ? selected
      : undefined;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return undefined;
  } finally {
    decoded?.data.fill(0);
    image?.fill(0);
  }
}
