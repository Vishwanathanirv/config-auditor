import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/caveat";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "./index.css";
import { PenCircle, PenUnderline } from "./ink";
import { Bench } from "./pages/Bench";
import { Desk } from "./pages/Desk";
import { Rulebook } from "./pages/Rulebook";
import { UseIt } from "./pages/UseIt";

const NAV = [
  { to: "/", t: "Desk" },
  { to: "/rules", t: "Rulebook" },
  { to: "/bench", t: "Test bench" },
  { to: "/use", t: "Use it" },
];

function Shell() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-8 gap-y-2 px-4 pb-2 pt-5 sm:px-6">
        <Link to="/" className="relative pb-1 text-[1.6rem] font-bold tracking-[-0.02em]">
          Redline
          <PenUnderline className="-bottom-0.5 left-0 h-2.5 w-full" />
        </Link>
        <nav className="flex flex-1 flex-wrap gap-x-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end className={({ isActive }) => `relative px-3 py-1.5 text-[15px] font-semibold ${isActive ? "text-ink" : "text-muted hover:text-ink"}`}>
              {({ isActive }) => (
                <>
                  {n.t}
                  {isActive && <PenCircle className="inset-0 h-full w-full" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <a href="https://github.com/Vishwanathanirv/config-auditor" className="hidden text-sm font-medium text-muted hover:text-ink sm:block">
          Source on GitHub
        </a>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-10 pt-6 sm:px-6">
        <Routes>
          <Route path="/" element={<Desk />} />
          <Route path="/rules" element={<Rulebook />} />
          <Route path="/bench" element={<Bench />} />
          <Route path="/use" element={<UseIt />} />
          <Route path="*" element={<p className="text-muted">Nothing filed here. Try the desk.</p>} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-[1320px] px-4 pb-8 text-xs text-faint sm:px-6">
        Built by{" "}
        <a href="https://vishwanathan.dev" className="text-muted underline underline-offset-4">
          Vishwanathan R
        </a>
        . Files are checked in your browser and never uploaded. The example shop is made up.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </StrictMode>,
);
