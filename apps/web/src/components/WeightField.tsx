import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { readWeightDraft, weightFromDraft } from "../lib/weights";

type WeightFieldProps = {
  value: number;
  disabled?: boolean;
  label?: string;
  onCommit: (next: number) => void;
};

function formatWeight(value: number): string {
  return String(value);
}

export function WeightField({
  value,
  disabled,
  label = "Weight",
  onCommit,
}: WeightFieldProps) {
  const [draft, setDraft] = useState(formatWeight(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatWeight(value));
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      value={draft}
      className="weight-input"
      onFocus={(event) => {
        focusedRef.current = true;
        setDraft(formatWeight(value));
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const raw = event.target.value;
        const parsed = readWeightDraft(raw);
        if (parsed.status === "invalid") return;
        setDraft(parsed.status === "empty" ? "" : parsed.text);
      }}
      onBlur={() => {
        focusedRef.current = false;
        const next = weightFromDraft(draft);
        onCommit(next);
        setDraft(formatWeight(next));
      }}
    />
  );
}
