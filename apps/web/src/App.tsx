import { AppHeader } from "./components/AppHeader";
import { BacktestView } from "./components/BacktestView";
import { BasketEditor } from "./components/BasketEditor";
import { BasketList } from "./components/BasketList";
import { InsightsPanel } from "./components/InsightsPanel";
import { InvestmentSettings } from "./components/InvestmentSettings";
import { ShareBar } from "./components/ShareBar";

export default function App() {
  return (
    <div className="app">
      <AppHeader />
      <div className="lab-row">
        <InvestmentSettings />
        <BasketList />
      </div>
      <BasketEditor />
      <BacktestView />
      <InsightsPanel />
      <ShareBar />
    </div>
  );
}
