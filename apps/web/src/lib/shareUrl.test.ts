import { describe, expect, it } from "vitest";
import defaults from "../data/defaults.json";
import type { Basket, LabSettings } from "../types";
import { decodeShare, encodeShare } from "./shareUrl";

const payload = defaults as { settings: LabSettings; baskets: Basket[] };

describe("encodeShare / decodeShare", () => {
  it("round-trips defaults.json", () => {
    const encoded = encodeShare(payload);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded).not.toMatch(/[+/=]/);

    const decoded = decodeShare(encoded);
    expect(decoded).toEqual(payload);
  });

  it("returns null for corrupt input", () => {
    expect(decodeShare("%%%")).toBeNull();
  });
});
