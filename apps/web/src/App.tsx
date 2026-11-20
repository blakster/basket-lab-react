import { Suspense, lazy } from "react";
import { AppHeader } from "./components/AppHeader";
import { BacktestView } from "./components/BacktestView";
import { BasketEditor } from "./components/BasketEditor";
import { InvestmentSettings } from "./components/InvestmentSettings";
import { useLab } from "./state/LabContext";

const BasketList = lazy(() =>
  import("./components/BasketList").then((m) => ({ default: m.BasketList })),
);
const InsightsPanel = lazy(() =>
  import("./components/InsightsPanel").then((m) => ({
    default: m.InsightsPanel,
  })),
);

function WorkspaceLoading() {
  return (
    <section className="workspace-loading" aria-busy="true">
      <p className="workspace-loading-text" role="status">
        Loading workspace…
      </p>
    </section>
  );
}

export default function App() {
  const { workspace } = useLab();

  return (
    <div className="app">
      <AppHeader />
      <main id="top" className="app-body">
        {workspace === "compare" && (
          <>
            <InvestmentSettings />
            <BacktestView />
          </>
        )}
        <Suspense fallback={<WorkspaceLoading />}>
          {workspace === "baskets" && <BasketList />}
          {workspace === "insights" && <InsightsPanel />}
        </Suspense>
      </main>
      <BasketEditor />
    </div>
  );
}
