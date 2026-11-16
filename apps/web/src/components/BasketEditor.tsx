import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
      editorSeed && editorSeed.id === editingId ? cloneBasket(editorSeed) : null,
    );
  }, [editingId, editorSeed]);

  const open = Boolean(editingId && draft);
  const sum = draft?.funds.reduce((s, f) => s + f.weight, 0) ?? 0;
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
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeEditor(); }}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-2xl bg-background sm:max-w-3xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle
            id="basket-editor-title"
            className="text-xl font-semibold tracking-[-0.02em]"
          >
            Edit basket
          </DialogTitle>
        </DialogHeader>
        {draft && (
          <>
            <label className="field">
              <span>Name</span>
              <Input
                type="text"
                value={draft.name}
                className="rounded-md"
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
            <Table className="fund-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Fund</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Lock</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.funds.map((fund) => (
                  <TableRow key={fund.schemeCode}>
                    <TableCell>{fund.schemeName}</TableCell>
                    <TableCell>
                      <WeightField
                        value={fund.weight}
                        disabled={fund.locked}
                        onCommit={(next) => setWeight(fund.schemeCode, next)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-md"
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
                        className="rounded-md"
                        onClick={() => deleteRow(fund.schemeCode)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className={balanced ? "total-ok" : "total-bad"}>
              Total: {sum.toFixed(2)}%
            </p>
            <DialogFooter className="modal-actions">
              <Button
                type="button"
                variant="outline"
                className="rounded-md"
                onClick={closeEditor}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-md"
                disabled={!balanced}
                onClick={onSave}
              >
                Save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
