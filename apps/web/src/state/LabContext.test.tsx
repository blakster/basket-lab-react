import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LabProvider, useLab } from "./LabContext";
import type { Basket } from "../types";

function makeBasket(weight: number): Basket {
  return {
    id: "test-1",
    name: "Test",
    color: "#18181b",
    active: true,
    funds: [
      {
        schemeCode: "118741",
        schemeName: "UTI Nifty 50 Index Fund",
        isin: null,
        weight,
        locked: false,
      },
    ],
  };
}

function Consumer({
  api,
}: {
  api: { current: ReturnType<typeof useLab> | null };
}) {
  api.current = useLab();
  return null;
}

describe("LabContext saveBasket", () => {
  beforeEach(() => {
    window.localStorage.removeItem("basket-lab-v1");
  });

  it("returns false when weights sum to 90 and true when they sum to 100", () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    let ok90 = true;
    act(() => {
      ok90 = api.current!.saveBasket(makeBasket(90));
    });
    expect(ok90).toBe(false);
    expect(api.current!.baskets.some((b) => b.id === "test-1")).toBe(false);

    let ok100 = false;
    act(() => {
      ok100 = api.current!.saveBasket(makeBasket(100));
    });
    expect(ok100).toBe(true);
    const saved = api.current!.baskets.find((b) => b.id === "test-1");
    expect(saved).toBeDefined();
    expect(saved!.name).toBe("Test");
    expect(saved!.funds.reduce((s, f) => s + f.weight, 0)).toBe(100);
  });
});
