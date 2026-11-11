import { describe, expect, it } from "vitest";
import { formatCompactInr, formatInr, formatInrGroup, parseInrInput } from "./format";

describe("formatInr", () => {
  it("uses Indian grouping, not Western", () => {
    expect(formatInr(100000)).toBe("₹1,00,000");
    expect(formatInr(3600000)).toBe("₹36,00,000");
    expect(formatInr(3995626.53)).toBe("₹39,95,626.53");
    expect(formatInr(100000)).not.toBe("₹100,000");
  });

  it("returns an em dash for non-finite values", () => {
    expect(formatInr(Number.NaN)).toBe("—");
  });
});

describe("formatCompactInr", () => {
  it("uses lakh, thousand, and crore steps", () => {
    expect(formatCompactInr(100000)).toBe("₹1L");
    expect(formatCompactInr(150000)).toBe("₹1.5L");
    expect(formatCompactInr(80000)).toBe("₹80k");
    expect(formatCompactInr(2e7)).toBe("₹2Cr");
    expect(formatCompactInr(-120000)).toBe("−₹1.2L");
  });
});

describe("formatInrGroup", () => {
  it("groups without the rupee sign", () => {
    expect(formatInrGroup(100000)).toBe("1,00,000");
  });
});

describe("parseInrInput", () => {
  it("accepts digits and Indian commas", () => {
    expect(parseInrInput("1,00,000")).toEqual({
      status: "ok",
      value: 100000,
      text: "1,00,000",
    });
    expect(parseInrInput("")).toEqual({ status: "empty" });
    expect(parseInrInput("12.5")).toEqual({ status: "invalid" });
  });
});
