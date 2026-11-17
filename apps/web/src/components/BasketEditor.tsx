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
import { applyWeightChange } from "../lib/weights";
import { useLab } from "../state/LabContext";
import type { Basket, SearchHit } from "../types";
import { FundSearch } from "./FundSearch";
import { WeightField } from "./WeightField";

const SWATCHES = [
  "#121212",
  "#6B6B6B",
  "#5E5E5E",
  "#B33A2B",
  "#8A8A8A",
  "#3A3A3A",
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
  const balanced = Math.abs(sum - 100) < WEIGHT_TOLERANCE;
  const creating = !baskets.some((basket) => basket.id === editingId);

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
    if (!draft || !balanced) return;
    if (saveBasket(draft)) closeEditor();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeEditor();
      }}
    >
      <DialogContent className="basket-editor">
        <DialogHeader className="editor-header">
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
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                <fieldset className="swatches">
                  <legend>Chart color</legend>
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
              </div>
              <FundSearch
                onSelect={addFund}
                selectedCodes={draft.funds.map((fund) => fund.schemeCode)}
              />
              <div className="editor-allocation-heading">
                <h3>Allocation</h3>
                <span>
                  {draft.funds.length}{" "}
                  {draft.funds.length === 1 ? "fund" : "funds"}
                </span>
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
            <DialogFooter className="editor-footer">
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
                    ? "Ready to save"
                    : draft.funds.length
                      ? "Adjust weights to reach 100%"
                      : "Add a fund to begin"}
                </span>
              </div>
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={closeEditor}>
                  Cancel
                </Button>
                <Button type="button" disabled={!balanced} onClick={onSave}>
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
