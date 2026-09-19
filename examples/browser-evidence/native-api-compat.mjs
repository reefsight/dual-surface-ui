export function encodeNativeExecuteInput(input, userAgent = navigator.userAgent) {
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent);
  const chromeMajor = match ? Number(match[1]) : undefined;
  // Chrome documents JSON-string input as deprecated beginning in 155. Keep
  // the legacy wire shape only for the earlier implementation line.
  return chromeMajor !== undefined && chromeMajor < 155
    ? JSON.stringify(input)
    : input;
}

export function parseNativeExecuteResult(value) {
  if (value !== null && typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    throw new TypeError("Native WebMCP executeTool returned an unsupported result");
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError("Native WebMCP executeTool returned invalid JSON");
  }
}
