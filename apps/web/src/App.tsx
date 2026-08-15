import { AppHeader } from "./components/AppHeader";
import { BasketEditor } from "./components/BasketEditor";
import { BasketList } from "./components/BasketList";
import { InvestmentSettings } from "./components/InvestmentSettings";

export default function App() {
  return (
    <div className="app">
      <AppHeader />
      <div className="lab-row">
        <InvestmentSettings />
        <BasketList />
      </div>
      <BasketEditor />
      <section />
      <section />
    </div>
  );
}
