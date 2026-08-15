import { useEffect, useRef, useState } from "react";
import { applyWeightChange } from "../lib/weights";
import { useLab } from "../state/LabContext";
import type { Basket, SearchHit } from "../types";
import { FundSearch } from "./FundSearch";

const SWATCHES = [
  "#18181b",
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#d97706",
  "#7c3aed",
];

const WEIGHT_TOLERANCE = 0.1;

function cloneBasket(basket: Basket): Basket {
  return structuredClone(basket);
}

export function BasketEditor() {
  const { baskets, editingId, editorSeed, closeEditor, saveBasket } = useLab();
  const [draft, setDraft] = useState<Basket | null>(null);
  const basketsRef = useRef(baskets);
  basketsRef.current = baskets;

  // Re-clone only when a different basket is opened, not on every list update.
  useEffect(() => {
    if (!editingId) {
      setDraft(null);
      return;
    }
    const found = basketsRef.current.find((b) => b.id === editingId);
    if (found) {
      setDraft(cloneBasket(found));
      return;
    }
    // Create-new path: seed is editor-only until saveBasket upserts it.
    setDraft(
      editorSeed && editorSeed.id === editingId ? cloneBasket(editorSeed) : null,
    );
  }, [editingId, editorSeed]);

  if (!editingId || !draft) return null;

  const sum = draft.funds.reduce((s, f) => s + f.weight, 0);
  const balanced = Math.abs(sum - 100) < WEIGHT_TOLERANCE;

  function addFund(hit: SearchHit) {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.funds.some((f) => f.schemeCode === hit.schemeCode)) return prev;
      return {
        ...prev,
        funds: [
          ...prev.funds,
          {
            schemeCode: hit.schemeCode,
            schemeName: hit.schemeName,
            isin: hit.isin,
            weight: 0,
            locked: false,
          },
        ],
      };
    });
  }

  function setWeight(schemeCode: string, next: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const fund = prev.funds.find((f) => f.schemeCode === schemeCode);
      if (!fund || fund.locked) return prev;
      return { ...prev, funds: applyWeightChange(prev.funds, schemeCode, next) };
    });
  }

  function toggleLock(schemeCode: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        funds: prev.funds.map((f) =>
          f.schemeCode === schemeCode ? { ...f, locked: !f.locked } : f,
        ),
      };
    });
  }

  function deleteRow(schemeCode: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, funds: prev.funds.filter((f) => f.schemeCode !== schemeCode) };
    });
  }

  function onSave() {
    if (!draft || !balanced) return;
    if (saveBasket(draft)) closeEditor();
  }

  return (
    <div className="modal-backdrop" onClick={closeEditor}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="basket-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="basket-editor-title">Edit basket</h2>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <fieldset className="swatches">
          <legend>Color</legend>
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch"
              style={{ background: color }}
              aria-label={color}
              aria-pressed={draft.color === color}
              onClick={() => setDraft({ ...draft, color })}
            />
          ))}
        </fieldset>
        <FundSearch onSelect={addFund} />
        <table className="fund-table">
          <thead>
            <tr>
              <th>Fund</th>
              <th>Weight</th>
              <th>Lock</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.funds.map((fund) => (
              <tr key={fund.schemeCode}>
                <td>{fund.schemeName}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={fund.weight}
                    disabled={fund.locked}
                    onChange={(e) =>
                      setWeight(fund.schemeCode, Number(e.target.value))
                    }
                  />
                </td>
                <td>
                  <button type="button" onClick={() => toggleLock(fund.schemeCode)}>
                    {fund.locked ? "Unlock" : "Lock"}
                  </button>
                </td>
                <td>
                  <button type="button" onClick={() => deleteRow(fund.schemeCode)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={balanced ? "total-ok" : "total-bad"}>
          Total: {sum.toFixed(2)}%
        </p>
        <div className="modal-actions">
          <button type="button" onClick={closeEditor}>
            Cancel
          </button>
          <button type="button" disabled={!balanced} onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
