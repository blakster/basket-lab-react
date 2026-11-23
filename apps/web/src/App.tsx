import { AppHeader } from "./components/AppHeader";
import { BacktestView } from "./components/BacktestView";
import { BasketEditor } from "./components/BasketEditor";
import { BasketList } from "./components/BasketList";
import { InsightsPanel } from "./components/InsightsPanel";
import { InvestmentSettings } from "./components/InvestmentSettings";
import { PortfolioWorkspace } from "./components/PortfolioWorkspace";
import { useLab } from "./state/LabContext";

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
        {workspace === "portfolio" && <PortfolioWorkspace />}
        {workspace === "baskets" && <BasketList />}
        {workspace === "insights" && <InsightsPanel />}
      </main>
      <BasketEditor />
    </div>
  );
}
