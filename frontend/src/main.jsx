import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./context/ThemeContext";
import App from "./App.jsx";
import { Toaster } from "sonner"

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <>
      <App />
      <Toaster richColors position="bottom-right" closeButton />
    </>
    </ThemeProvider>
  </StrictMode>
);
