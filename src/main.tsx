import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { TooltipProvider } from "./components/ui/tooltip";
import { PWAUpdatePrompt } from "./components/pwa/PWAUpdatePrompt";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider delayDuration={200}>
        <App />
        <PWAUpdatePrompt />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>
);