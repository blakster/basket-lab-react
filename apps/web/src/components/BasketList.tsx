import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import defaults from "../data/defaults.json";
import { tintTowardWell } from "../lib/theme";
import { useLab } from "../state/LabContext";
import { useTheme } from "../state/ThemeContext";
import type { Basket, LabSettings } from "../types";
import { AllocationStack } from "./LabCharts";

const COLORS = [
  "#121212",
  "#6B6B6B",
  "#5E5E5E",
  "#B33A2B",
  "#8A8A8A",
  "#3A3A3A",
];

function newId(): string {
  return crypto.randomUUID();
}

function fundTint(base: string, index: number, theme: "light" | "dark"): string {
  const steps = [1, 0.72, 0.5, 0.34, 0.2];
  const t = steps[index % steps.length] ?? 0.4;
  return tintTowardWell(base, t, theme);
}

export function BasketList() {
  const {
    baskets,
    setBaskets,
    setSettings,
    openEditor,
    closeEditor,
    editingId,
    openInsights,
  } = useLab();
  const { theme } = useTheme();

  function toggleActive(id: string) {
    setBaskets((prev) =>
      prev.map((b) => (b.id === id ? { ...b, active: !b.active } : b)),
    );
  }

  function duplicate(basket: Basket) {
    const copy: Basket = {
      ...basket,
      id: newId(),
      name: `${basket.name} (Copy)`,
      funds: basket.funds.map((f) => ({ ...f })),
    };
    setBaskets((prev) => [...prev, copy]);
  }

  function remove(id: string) {
    if (baskets.length <= 1) return;
    setBaskets((prev) => prev.filter((b) => b.id !== id));
    if (editingId === id) closeEditor();
  }

  function createNew() {
    const basket: Basket = {
      id: newId(),
      name: "New Basket",
      color: COLORS[baskets.length % COLORS.length],
      active: true,
      funds: [],
    };
    openEditor(basket.id, basket);
  }

  function resetDefaults() {
    const next = structuredClone(defaults) as {
      baskets: Basket[];
      settings: LabSettings;
    };
    setBaskets(next.baskets);
    setSettings(next.settings);
    closeEditor();
  }

  const activeCount = baskets.filter((b) => b.active).length;

  return (
    <section className="basket-list" aria-label="Baskets">
      <div className="basket-list-header">
        <div className="basket-list-title-wrap">
          <h2>Baskets</h2>
          <span className="basket-count-badge">
            {activeCount} of {baskets.length} active
          </span>
        </div>
        <div className="basket-list-actions">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={createNew}
          >
            + Create New Basket
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetDefaults}
          >
            Reset Defaults
          </Button>
        </div>
      </div>
      <p className="lead-hint">
        Active baskets are the columns on Compare. Weights must sum to 100% to
        save.
      </p>
      <ul className="basket-league">
        {baskets.map((basket) => {
          const totalWeight = basket.funds.reduce((s, f) => s + f.weight, 0);
          const inputId = `basket-active-${basket.id}`;
          return (
            <li
              key={basket.id}
              className={`basket-card${basket.active ? " is-on" : " is-inactive"}`}
            >
              <span className="league-tick" aria-hidden="true" />
              <div className="basket-card-head">
                <div className="flex flex-1 items-center gap-2">
                  <Checkbox
                    id={inputId}
                    checked={basket.active}
                    onCheckedChange={() => toggleActive(basket.id)}
                    className="rounded-sm border-foreground cursor-pointer"
                  />
                  <label
                    htmlFor={inputId}
                    className="flex flex-wrap items-baseline gap-1.5 cursor-pointer font-medium"
                  >
                    <span>{basket.name}</span>
                    <span className="basket-fund-count">
                      ({basket.funds.length} {basket.funds.length === 1 ? "fund" : "funds"}
                      {basket.funds.length > 0 ? ` · ${totalWeight.toFixed(0)}%` : ""})
                    </span>
                  </label>
                </div>
                <div className="basket-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openInsights(basket.id)}
                  >
                    Insights
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditor(basket.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => duplicate(basket)}
                  >
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={baskets.length <= 1}
                    onClick={() => remove(basket.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {basket.funds.length > 0 ? (
                <AllocationStack
                  segments={basket.funds.map((fund, i) => ({
                    key: fund.schemeCode,
                    label: fund.schemeName,
                    weight: fund.weight,
                    color: fundTint(basket.color, i, theme),
                  }))}
                />
              ) : (
                <div className="basket-empty-hint">
                  No funds added yet · Click <strong>Edit</strong> to add funds
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
