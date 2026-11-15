import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import { Workbench } from "./Workbench";

try {
  const t = localStorage.getItem("redline-theme");
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
} catch {
  /* storage blocked */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Workbench />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
