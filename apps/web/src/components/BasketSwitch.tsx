import type { KeyboardEvent, RefObject } from "react";
import type { Basket } from "../types";

type BasketSwitchProps = {
  baskets: Basket[];
  selectedId: string | null;
  onSelect: (basketId: string) => void;
  /** Prefix for each tab's id; the labelled panel points back to the selected one. */
  idPrefix: string;
  /** Id of the tabpanel the tabs control. */
  panelId: string;
  /** Strip element for callers tracking scroll position (edge fades). */
  listRef?: RefObject<HTMLDivElement>;
  /** Which strip edges currently hide tabs; drives the fade masks. */
  fades?: { left: boolean; right: boolean };
};

/** Basket picker rendered as a standard tab strip: arrow keys, Home/End,
 * roving tabindex, and each tab pointing at its labelled panel. */
export function BasketSwitch({
  baskets,
  selectedId,
  onSelect,
  idPrefix,
  panelId,
  listRef,
  fades,
}: BasketSwitchProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    if (current === -1) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % tabs.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    tabs[next]!.focus();
    onSelect(baskets[next]!.id);
  };

  return (
    <div
      className="insights-switch"
      role="tablist"
      aria-label="Basket"
      ref={listRef}
      data-scroll-left={fades?.left}
      data-scroll-right={fades?.right}
      onKeyDown={onKeyDown}
    >
      {baskets.map((basket) => (
        <button
          key={basket.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${basket.id}`}
          aria-selected={basket.id === selectedId}
          aria-controls={panelId}
          tabIndex={basket.id === selectedId ? 0 : -1}
          className="insights-switch-item"
          onClick={() => onSelect(basket.id)}
        >
          {basket.name}
        </button>
      ))}
    </div>
  );
}

/** Id of the tab owning the strip's panel, for the panel's aria-labelledby. */
export function basketSwitchTabId(idPrefix: string, basketId: string) {
  return `${idPrefix}-tab-${basketId}`;
}
