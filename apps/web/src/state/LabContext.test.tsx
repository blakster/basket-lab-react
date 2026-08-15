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

  it("create-new draft cancel leaves baskets unchanged and does not persist a 0% basket", () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    const before = api.current!.baskets;
    const beforeLen = before.length;
    const draft: Basket = {
      id: "draft-new",
      name: "New Basket",
      color: "#18181b",
      active: true,
      funds: [],
    };

    act(() => {
      api.current!.openEditor(draft.id, draft);
    });
    expect(api.current!.editingId).toBe("draft-new");
    expect(api.current!.editorSeed?.id).toBe("draft-new");
    expect(api.current!.baskets).toHaveLength(beforeLen);
    expect(api.current!.baskets.some((b) => b.id === "draft-new")).toBe(false);

    act(() => {
      api.current!.closeEditor();
    });
    expect(api.current!.editingId).toBeNull();
    expect(api.current!.editorSeed).toBeNull();
    expect(api.current!.baskets).toHaveLength(beforeLen);
    expect(api.current!.baskets.some((b) => b.id === "draft-new")).toBe(false);

    const raw = window.localStorage.getItem("basket-lab-v1");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { baskets: Basket[] };
    expect(persisted.baskets).toHaveLength(beforeLen);
    expect(persisted.baskets.some((b) => b.id === "draft-new")).toBe(false);
    expect(
      persisted.baskets.some(
        (b) => b.funds.length === 0 || b.funds.reduce((s, f) => s + f.weight, 0) === 0,
      ),
    ).toBe(false);
  });
});

describe("LabContext runAnalysis", () => {
  beforeEach(() => {
    window.localStorage.removeItem("basket-lab-v1");
  });

  it("skips when amount is below 100 or an active basket is unbalanced", async () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setSettings({ ...api.current!.settings, amount: 50 });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);

    act(() => {
      api.current!.setSettings({ ...api.current!.settings, amount: 1000 });
      api.current!.setBaskets(
        api.current!.baskets.map((b, i) =>
          i === 0
            ? { ...b, funds: b.funds.map((f) => ({ ...f, weight: 50 })) }
            : b,
        ),
      );
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);
  });
});
