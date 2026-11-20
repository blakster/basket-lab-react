import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Basket } from "../types";
import { BasketSwitch, basketSwitchTabId } from "./BasketSwitch";

const basket = (id: string, name: string): Basket => ({
  id,
  name,
  color: "#000",
  active: true,
  funds: [],
});

const baskets = [basket("1", "Core"), basket("2", "Sat"), basket("3", "Edge")];

function Harness() {
  const [selected, setSelected] = useState("1");
  return (
    <BasketSwitch
      baskets={baskets}
      selectedId={selected}
      onSelect={setSelected}
      idPrefix="switch"
      panelId="switch-panel"
    />
  );
}

const tabs = () => screen.getAllByRole("tab");

describe("BasketSwitch", () => {
  afterEach(cleanup);

  it("renders a tablist with a roving tabindex and panel linkage", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "Basket" });
    expect(list).toBeInTheDocument();
    const [first, second, third] = tabs();
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("aria-selected", "false");
    expect(second).toHaveAttribute("tabindex", "-1");
    expect(third).toHaveAttribute("tabindex", "-1");
    for (const tab of tabs()) {
      expect(tab).toHaveAttribute("aria-controls", "switch-panel");
    }
    expect(first.id).toBe(basketSwitchTabId("switch", "1"));
  });

  it("moves selection and focus with ArrowRight and ArrowLeft", () => {
    render(<Harness />);
    const [first, second, third] = tabs();
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: "ArrowRight" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the first and last tab with Home and End", () => {
    render(<Harness />);
    const [first, , third] = tabs();
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(third, { key: "Home" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("ignores keys that are not part of the tabs pattern", () => {
    const onSelect = vi.fn();
    render(
      <BasketSwitch
        baskets={baskets}
        selectedId="1"
        onSelect={onSelect}
        idPrefix="switch"
        panelId="switch-panel"
      />,
    );
    const [first] = tabs();
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "a"]) {
      fireEvent.keyDown(first, { key });
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the first tab reachable when selectedId is not in the strip", () => {
    render(
      <BasketSwitch
        baskets={baskets}
        selectedId="inactive-basket"
        onSelect={() => {}}
        idPrefix="switch"
        panelId="switch-panel"
      />,
    );
    const [first, second] = tabs();
    expect(first).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("aria-selected", "false");
    expect(second).toHaveAttribute("tabindex", "-1");
  });

  it("still selects on click", () => {
    render(<Harness />);
    fireEvent.click(tabs()[1]!);
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveAttribute("tabindex", "-1");
  });
});
