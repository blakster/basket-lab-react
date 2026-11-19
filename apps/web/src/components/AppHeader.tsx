import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useLab, type LabStatus, type Workspace } from "../state/LabContext";
import { useTheme } from "../state/ThemeContext";

export function statusLabel(status: LabStatus): string {
  switch (status.kind) {
    case "ready":
      return "LIVE";
    case "cached-nav":
      return status.detail ? `SAVED NAV ${status.detail}` : "SAVED NAV";
    case "no-nav":
      return "BLACKOUT";
    case "search-busy":
      return "Search busy…";
    case "search-down":
      return "Search unavailable";
    case "insights-down":
      return "Insights unavailable";
  }
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

const WORKSPACES: { id: Workspace; label: string }[] = [
  { id: "compare", label: "Compare" },
  { id: "baskets", label: "Baskets" },
  { id: "insights", label: "Insights" },
];

export function AppHeader() {
  const { status, insightsStatus, workspace, setWorkspace } = useLab();
  const { theme, toggleTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const banner =
    status.kind === "insights-down" ? { kind: "ready" as const } : status;

  function handleShare() {
    const url = new URL(window.location.href);
    const href = `${url.origin}${url.pathname}${url.search}`;
    const write = navigator.clipboard?.writeText?.(href);
    if (!write) return;
    void write
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <header className="app-header">
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <div className="masthead">
        <span className="brand-mark" data-mark="ring" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"
            />
          </svg>
        </span>
        <h1>Basket Lab</h1>
        <p className="masthead-date">{todayLabel()}</p>
      </div>
      <nav className="app-nav" aria-label="Workspace">
        {WORKSPACES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={workspace === item.id ? "page" : undefined}
            onClick={() => setWorkspace(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="app-header-meta">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="share-text text-[0.88rem]"
          aria-pressed={theme === "dark"}
          aria-label="Night edition"
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Badge
          variant="ghost"
          className="status-plate px-[0.5rem] py-[0.28rem] text-[0.8125rem]"
          data-kind={banner.kind}
        >
          {statusLabel(banner)}
        </Badge>
        <Button
          type="button"
          variant="outline"
          className="share-cta h-auto bg-transparent px-[0.65rem] py-[0.35rem] text-[0.8125rem]"
          onClick={handleShare}
        >
          {copied ? "Copied" : "Share"}
        </Button>
        {insightsStatus.kind === "insights-down" ? (
          <Badge
            variant="ghost"
            className="status-plate px-[0.5rem] py-[0.28rem] text-[0.8125rem] [@media(max-width:800px)]:hidden"
            data-kind="insights-down"
          >
            {statusLabel(insightsStatus)}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}
