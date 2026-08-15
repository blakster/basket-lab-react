import { describe, expect, it, vi } from "vitest";
import { searchFunds } from "./search";

describe("searchFunds", () => {
  it("maps TigZig hits and does not call the full MFAPI list", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(String(url)).not.toMatch(/api\.mfapi\.in\/mf$/);
      return {
        ok: true,
        json: async () => ({
          results: [
            { scheme_code: 140084, scheme_name: "Nippon India ETF Nifty 50 BeES", isin: "INF204KB14I2" },
          ],
        }),
      } as Response;
    });
    const hits = await searchFunds("bees", fetchFn as unknown as typeof fetch);
    expect(hits[0]).toEqual({
      schemeCode: "140084",
      schemeName: "Nippon India ETF Nifty 50 BeES",
      isin: "INF204KB14I2",
    });
    expect(String(fetchFn.mock.calls[0][0])).toContain("api.tigzig.com/mf/v1/search");
    expect(String(fetchFn.mock.calls[0][0])).toContain("limit=20");
  });

  it("falls back to MFAPI search when TigZig fails", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("tigzig")) throw new Error("down");
      expect(u).toContain("api.mfapi.in/mf/search");
      return {
        ok: true,
        json: async () => [{ schemeCode: 122639, schemeName: "PPFAS" }],
      } as Response;
    });
    const hits = await searchFunds("ppfas", fetchFn as unknown as typeof fetch);
    expect(hits[0].schemeCode).toBe("122639");
  });
});
