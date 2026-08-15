import defaults from "../data/defaults.json";
import { useLab } from "../state/LabContext";
import type { Basket } from "../types";

const COLORS = [
  "#18181b",
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#d97706",
  "#7c3aed",
];

function newId(): string {
  return crypto.randomUUID();
}

export function BasketList() {
  const { baskets, setBaskets, openEditor, closeEditor, editingId } = useLab();

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
    setBaskets((prev) => [...prev, basket]);
    openEditor(basket.id);
  }

  function resetDefaults() {
    setBaskets(structuredClone(defaults.baskets) as Basket[]);
    closeEditor();
  }

  return (
    <section className="basket-list">
      <h2>Baskets</h2>
      <ul>
        {baskets.map((basket) => (
          <li key={basket.id} className="basket-card">
            <span className="basket-swatch" style={{ background: basket.color }} />
            <label>
              <input
                type="checkbox"
                checked={basket.active}
                onChange={() => toggleActive(basket.id)}
              />
              {basket.name}
            </label>
            <div className="basket-actions">
              <button type="button" onClick={() => openEditor(basket.id)}>
                Edit
              </button>
              <button type="button" onClick={() => duplicate(basket)}>
                Duplicate
              </button>
              <button
                type="button"
                disabled={baskets.length <= 1}
                onClick={() => remove(basket.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="basket-list-actions">
        <button type="button" onClick={createNew}>
          Create New Basket
        </button>
        <button type="button" onClick={resetDefaults}>
          Reset Defaults
        </button>
      </div>
    </section>
  );
}
