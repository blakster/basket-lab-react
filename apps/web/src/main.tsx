import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LabProvider } from "./state/LabContext";
import { ThemeProvider } from "./state/ThemeContext";
import "./index.css";
import "./lab-surfaces.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LabProvider>
          <TooltipProvider delayDuration={400} skipDelayDuration={800}>
            <App />
          </TooltipProvider>
        </LabProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
