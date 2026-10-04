import { describe, expect, it } from "vitest";
// Internal development-script boundary, not a public export or native provider.
// @ts-expect-error development mjs has no public declarations
import { admitCollectorUnitSummary } from "../scripts/verify-p4.3-native-capture-unit.mjs";

const bytes = (value: string) => new TextEncoder().encode(value);
const valid = '{"kind":"p4.3-native-collector-unit","cases":55,"nativeExecuted":false}';
describe("native collector unit-summary admission (not native execution)", () => {
  it("admits only exact bounded deterministic summary", () => {
    expect(admitCollectorUnitSummary(bytes(valid))).toEqual({ kind: "p4.3-native-collector-unit", cases: 55, nativeExecuted: false });
  });
  it.each([
    "", "[]", "null", "{}", valid + "{}", valid.replace('55', '0'), valid.replace('55', '257'),
    valid.replace('55', '1.5'), valid.replace('55', '1e999'), valid.replace('false', 'true'),
    valid.replace('false', '"false"'), valid.replace('"kind"', '"unexpected"'),
    valid.replace('"kind"', '"kind":"wrong","kind"'),
    valid.replace('"kind"', '"ki\\u006ed":"wrong","kind"'),
    valid.replace('55', '"55"'), valid.slice(0, -1) + ',"extra":1}', "\ufeff" + valid,
    valid.replace('collector-unit', 'collector-\\ud800unit'), " ".repeat(1025),
  ])("refuses malformed/non-unit/private disclosure vectors %#", vector => {
    expect(() => admitCollectorUnitSummary(bytes(vector))).toThrow();
  });
  it("refuses malformed original UTF-8", () => {
    expect(() => admitCollectorUnitSummary(new Uint8Array([123, 34, 0xc0, 0xaf, 34, 58, 48, 125]))).toThrow();
  });
});
