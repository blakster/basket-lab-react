import { describe, expect, it } from "vitest";
import { insetSigned } from "./barGeometry";

describe("insetSigned", () => {
  it("keeps a 3px baseline gap on negative bars so down years still paint", () => {
    expect(insetSigned(-15.96, 3)).toBeCloseTo(-12.96, 5);
    expect(insetSigned(72, 3)).toBe(69);
    expect(insetSigned(-2, 3)).toBe(0);
    expect(insetSigned(2, 3)).toBe(0);
  });
});
