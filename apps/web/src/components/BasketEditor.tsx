import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEffect, useRef, useState } from "react";
import { BASKET_COLORS } from "../lib/theme";
import { applyWeightChange, isWeightBalanced } from "../lib/weights";
import { useLab } from "../state/LabContext";
import type { Basket, SearchHit } from "../types";
import { FundSearch } from "./FundSearch";
import { WeightField } from "./WeightField";

const SWATCHES = BASKET_COLORS;

function cloneBasket(basket: Basket): Basket {
  return structuredClone(basket);
}

export function BasketEditor() {
  const { baskets, editingId, editorSeed, closeEditor, saveBasket } = useLab();
  const [draft, setDraft] = useState<Basket | null>(null);
  const basketsRef = useRef(baskets);
  basketsRef.current = baskets;

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
    setDraft(
      editorSeed && editorSeed.id === editingId
        ? cloneBasket(editorSeed)
        : null,
    );
  }, [editingId, editorSeed]);

  const open = Boolean(editingId && draft);
  const sum = draft?.funds.reduce((s, f) => s + f.weight, 0) ?? 0;
  const balanced = isWeightBalanced(sum);
  const named = Boolean(draft?.name.trim());
  const canSave = balanced && named;
  const creating = !baskets.some((basket) => basket.id === editingId);

  function addFund(hit: SearchHit) {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.funds.some((f) => f.schemeCode === hit.schemeCode)) return prev;
      const initialWeight = prev.funds.length === 0 ? 100 : 0;
      return {
        ...prev,
        funds: [
          ...prev.funds,
          {
            schemeCode: hit.schemeCode,
            schemeName: hit.schemeName,
            isin: hit.isin,
            weight: initialWeight,
            locked: false,
          },
        ],
      };
    });
  }

  function equalSplit() {
    setDraft((prev) => {
      if (!prev) return prev;
      const unlocked = prev.funds.filter((f) => !f.locked);
      if (!unlocked.length) return prev;
      const lockedTotal = prev.funds
        .filter((f) => f.locked)
        .reduce((s, f) => s + f.weight, 0);
      const remainingCents = Math.max(0, Math.round((100 - lockedTotal) * 100));
      const base = Math.floor(remainingCents / unlocked.length);
      let extra = remainingCents - base * unlocked.length;
      return {
        ...prev,
        funds: prev.funds.map((f) => {
          if (f.locked) return f;
          const cents = base + (extra > 0 ? 1 : 0);
          if (extra > 0) extra -= 1;
          return { ...f, weight: cents / 100 };
        }),
      };
    });
  }

  function setWeight(schemeCode: string, next: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const fund = prev.funds.find((f) => f.schemeCode === schemeCode);
      if (!fund || fund.locked) return prev;
      return {
        ...prev,
        funds: applyWeightChange(prev.funds, schemeCode, next),
      };
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
      return {
        ...prev,
        funds: prev.funds.filter((f) => f.schemeCode !== schemeCode),
      };
    });
  }

  function onSave() {
    if (!draft || !canSave) return;
    if (saveBasket(draft)) closeEditor();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeEditor();
      }}
    >
      <DialogContent
        className="basket-editor flex flex-col gap-0 p-0 w-[min(48rem,calc(100%-2rem))] max-w-none sm:max-w-none"
        onEscapeKeyDown={(event) => {
          const combo =
            event.target instanceof Element
              ? event.target.closest('[role="combobox"]')
              : null;
          if (combo?.getAttribute("aria-expanded") === "true") {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="editor-header gap-[0.35rem] text-left">
          <DialogTitle id="basket-editor-title" className="editor-title">
            {creating ? "New basket" : "Edit basket"}
          </DialogTitle>
          <DialogDescription className="editor-description">
            Add funds, set weights, and lock allocations you want to keep.
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <>
            <div className="editor-body">
              <div className="editor-identity">
                <label className="field">
                  <span>Name</span>
                  <Input
                    type="text"
                    className="border-0 rounded-[var(--r-sm)] bg-[var(--paper)] px-[0.65rem] py-[0.45rem] min-w-[8rem] shadow-[var(--shadow-border)]"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                <fieldset className="swatches">
                  <legend>Chart color</legend>
                  {SWATCHES.map((swatch) => (
                    <button
                      key={swatch.value}
                      type="button"
                      className="swatch"
                      style={{ background: swatch.value }}
                      aria-label={swatch.label}
                      aria-pressed={
                        draft.color === swatch.value ||
                        (!!swatch.hex && draft.color.toUpperCase() === swatch.hex)
                      }
                      onClick={() =>
                        setDraft({ ...draft, color: swatch.value })
                      }
                    />
                  ))}
                </fieldset>
              </div>
              <FundSearch
                onSelect={addFund}
                selectedCodes={draft.funds.map((fund) => fund.schemeCode)}
              />
              <div className="editor-allocation-heading">
                <div className="editor-allocation-title">
                  <h3>Allocation</h3>
                  <span>
                    {draft.funds.length}{" "}
                    {draft.funds.length === 1 ? "fund" : "funds"}
                  </span>
                </div>
                {draft.funds.length >= 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={draft.funds.every((f) => f.locked)}
                    onClick={equalSplit}
                  >
                    Equal split
                  </Button>
                )}
              </div>
              {draft.funds.length === 0 ? (
                <div className="editor-empty">
                  <p>No funds yet</p>
                  <p>
                    Search above to add your first fund, then allocate 100%
                    across your basket.
                  </p>
                </div>
              ) : (
                <Table className="fund-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fund</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Lock</TableHead>
                      <TableHead>
                        <span className="sr-only">Remove</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.funds.map((fund) => (
                      <TableRow key={fund.schemeCode}>
                        <TableCell className="editor-fund-name">
                          {fund.schemeName}
                          <span className="editor-fund-code">
                            {fund.schemeCode}
                          </span>
                        </TableCell>
                        <TableCell className="editor-weight-cell">
                          <span className="editor-weight">
                            <WeightField
                              value={fund.weight}
                              disabled={fund.locked}
                              onCommit={(next) =>
                                setWeight(fund.schemeCode, next)
                              }
                              label={`Weight for ${fund.schemeName}`}
                            />
                            <span aria-hidden="true">%</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`${fund.locked ? "Unlock" : "Lock"} ${fund.schemeName}`}
                            aria-pressed={fund.locked}
                            onClick={() => toggleLock(fund.schemeCode)}
                          >
                            {fund.locked ? "Unlock" : "Lock"}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="editor-delete"
                            aria-label={`Delete ${fund.schemeName}`}
                            onClick={() => deleteRow(fund.schemeCode)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="editor-help">
                Weights must total 100%. Changing a weight redistributes the
                remaining unlocked funds.
              </p>
            </div>
            <DialogFooter className="editor-footer flex-row flex-wrap justify-between gap-4 sm:justify-between">
              <div className="editor-total" role="status">
                <span>Total allocation</span>
                <strong
                  className={
                    balanced
                      ? "total-ok"
                      : draft.funds.length
                        ? "total-bad"
                        : ""
                  }
                >
                  {sum.toFixed(2)}%
                </strong>
                <span>
                  {balanced
                    ? named
                      ? "Ready to save"
                      : "Add a name to save"
                    : draft.funds.length
                      ? "Adjust weights to reach 100%"
                      : "Add a fund to begin"}
                </span>
              </div>
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={closeEditor}>
                  Cancel
                </Button>
                <Button type="button" disabled={!canSave} onClick={onSave}>
                  Save basket
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
