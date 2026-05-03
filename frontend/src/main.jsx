import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./context/ThemeContext";
import { I18nProvider } from "./context/I18nContext";
import App from "./App.jsx";
import { Toaster } from "sonner"

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <>
          <App />
          <Toaster richColors position="bottom-right" closeButton />
        </>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>
);
