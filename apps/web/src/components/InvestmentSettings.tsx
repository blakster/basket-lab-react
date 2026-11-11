import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEffect, useRef, useState } from "react";
import { formatInrGroup, parseInrInput } from "../lib/format";
import { useLab } from "../state/LabContext";
import type { Period } from "../types";

const PERIODS: Period[] = ["3M", "6M", "1Y", "3Y", "5Y", "10Y", "Custom"];

function AmountInput() {
  const { settings, setSettings } = useLab();
  const [draft, setDraft] = useState(() => formatInrGroup(settings.amount));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatInrGroup(settings.amount));
  }, [settings.amount]);

  return (
    <label className="field field-amount">
      <span>Amount</span>
      <span className="amount-input">
        <span aria-hidden="true">₹</span>
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-label="Amount"
          value={draft}
          aria-invalid={settings.amount < 100}
          aria-describedby={settings.amount < 100 ? "amount-error" : undefined}
          className="h-auto border-0 bg-transparent px-0 text-center shadow-none dark:bg-transparent focus-visible:border-0 focus-visible:ring-0"
          onFocus={(event) => {
            focusedRef.current = true;
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const parsed = parseInrInput(event.target.value);
            if (parsed.status === "invalid") return;
            if (parsed.status === "empty") {
              setDraft("");
              setSettings({ ...settings, amount: 0 });
              return;
            }
            setDraft(parsed.text ?? "");
            setSettings({ ...settings, amount: parsed.value ?? 0 });
          }}
          onBlur={() => {
            focusedRef.current = false;
            const parsed = parseInrInput(draft);
            const next = parsed.status === "ok" ? parsed.value! : settings.amount;
            setSettings({ ...settings, amount: next });
            setDraft(formatInrGroup(next));
          }}
        />
      </span>
      {settings.amount < 100 && (
        <p id="amount-error" className="total-bad">
          Minimum amount should be ₹100
        </p>
      )}
    </label>
  );
}

export function InvestmentSettings() {
  const { settings, setSettings } = useLab();

  return (
    <section className="investment-settings" aria-label="Investment settings">
      <h2>Settings</h2>
      <Tabs
        value={settings.mode}
        onValueChange={(value) => {
          if (value === "lumpsum" || value === "sip") {
            setSettings({ ...settings, mode: value });
          }
        }}
      >
        <TabsList
          className="rounded-[var(--r-md)] bg-muted p-1"
          aria-label="Investment mode"
        >
          <TabsTrigger
            value="lumpsum"
            className="rounded-[var(--r-btn)] px-4 data-[state=active]:bg-primary! data-[state=active]:text-primary-foreground!"
          >
            Lumpsum
          </TabsTrigger>
          <TabsTrigger
            value="sip"
            className="rounded-[var(--r-btn)] px-4 data-[state=active]:bg-primary! data-[state=active]:text-primary-foreground!"
          >
            SIP
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <AmountInput />
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={1}
        value={settings.period}
        onValueChange={(value) => {
          if (!value) return;
          setSettings({ ...settings, period: value as Period });
        }}
        aria-label="Period"
        className="flex-wrap"
      >
        {PERIODS.map((period) => (
          <ToggleGroupItem
            key={period}
            value={period}
            className="rounded-[var(--r-btn)] border-0 data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!"
          >
            {period}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {settings.period === "Custom" && (
        <div className="custom-dates">
          <label className="field">
            <span>Start</span>
            <Input
              type="date"
              value={settings.customStart ?? ""}
              className="rounded-md border-0 border-b bg-transparent shadow-none"
              onChange={(e) =>
                setSettings({
                  ...settings,
                  customStart: e.target.value || null,
                })
              }
            />
          </label>
          <label className="field">
            <span>End</span>
            <Input
              type="date"
              value={settings.customEnd ?? ""}
              className="rounded-md border-0 border-b bg-transparent shadow-none"
              onChange={(e) =>
                setSettings({
                  ...settings,
                  customEnd: e.target.value || null,
                })
              }
            />
          </label>
        </div>
      )}
    </section>
  );
}
