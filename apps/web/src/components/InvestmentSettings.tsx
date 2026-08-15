import { useLab } from "../state/LabContext";
import type { Period } from "../types";

const PERIODS: Period[] = ["3M", "6M", "1Y", "3Y", "5Y", "10Y", "Custom"];

export function InvestmentSettings() {
  const { settings, setSettings } = useLab();

  return (
    <section className="investment-settings">
      <h2>Settings</h2>
      <div className="mode-toggle" role="group" aria-label="Investment mode">
        <button
          type="button"
          aria-pressed={settings.mode === "lumpsum"}
          onClick={() => setSettings({ ...settings, mode: "lumpsum" })}
        >
          Lumpsum
        </button>
        <button
          type="button"
          aria-pressed={settings.mode === "sip"}
          onClick={() => setSettings({ ...settings, mode: "sip" })}
        >
          SIP
        </button>
      </div>
      <label className="field">
        <span>Amount (₹)</span>
        <input
          type="number"
          min={100}
          value={settings.amount}
          onChange={(e) =>
            setSettings({ ...settings, amount: Number(e.target.value) })
          }
        />
      </label>
      <div className="period-buttons" role="group" aria-label="Period">
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            aria-pressed={settings.period === period}
            onClick={() => setSettings({ ...settings, period })}
          >
            {period}
          </button>
        ))}
      </div>
      {settings.period === "Custom" && (
        <div className="custom-dates">
          <label className="field">
            <span>Start</span>
            <input
              type="date"
              value={settings.customStart ?? ""}
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
            <input
              type="date"
              value={settings.customEnd ?? ""}
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
