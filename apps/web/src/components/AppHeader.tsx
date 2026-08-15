import { useLab, type LabStatus } from "../state/LabContext";

export function statusLabel(status: LabStatus): string {
  switch (status.kind) {
    case "ready":
      return "ready";
    case "cached-nav":
      return `Using saved NAV (${status.detail ?? ""})`;
    case "no-nav":
      return "Can't load NAV";
    case "search-down":
      return "Search unavailable";
    case "insights-down":
      return "Insights unavailable";
  }
}

export function AppHeader() {
  const { status } = useLab();
  return (
    <header className="app-header">
      <h1>Basket Lab</h1>
      <div className="app-header-meta">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.href).catch(() => {});
          }}
        >
          Share
        </button>
        <p className="status-line">{statusLabel(status)}</p>
      </div>
    </header>
  );
}
