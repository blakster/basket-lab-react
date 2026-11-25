import { afterEach, describe, expect, it, vi } from "vitest";
import { postCommissionCheck } from "./portfolio";

describe("postCommissionCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("splits large portfolios into requests the API accepts", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ rows: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 201 }, (_, index) => `amfi:${index}`);

    await postCommissionCheck(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    );
    expect(bodies[0].instrumentIds).toHaveLength(200);
    expect(bodies[1].instrumentIds).toEqual(["amfi:200"]);
  });
});
