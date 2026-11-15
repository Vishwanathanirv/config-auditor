import { useState } from "react";
import { KIND_NAME, RULES, type Kind } from "@redline/core";

const KINDS = Object.keys(KIND_NAME) as Kind[];
const SEV_TONE = { critical: "var(--pen)", high: "var(--pen)", medium: "var(--pen)", low: "var(--pencil)" } as const;

function Code({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="font-type text-[0.95em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function Rulebook() {
  const [kind, setKind] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");
  const shown = RULES.filter((r) => (kind === "all" || r.kind === kind) && (!q || `${r.id} ${r.title} ${r.why}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="max-w-4xl">
      <h1 className="text-[2.2rem] font-bold leading-[1.05] tracking-[-0.02em]">The rulebook</h1>
      <p className="mt-3 max-w-2xl text-[1.02rem] leading-relaxed text-muted">
        Every check Redline makes, in plain English: what it looks for, why it matters, and what to do. {RULES.filter((r) => r.autofix).length} of the {RULES.length} come with a fix Redline can write for you. Each one points to the guide it comes from.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["all", ...KINDS] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`rounded-[3px] px-3 py-1 text-sm font-semibold ${kind === k ? "bg-paper text-paper-ink shadow-[var(--shadow)]" : "text-muted hover:text-ink"}`}>
            {k === "all" ? "Everything" : KIND_NAME[k]}
          </button>
        ))}
        <input className="field ml-auto w-full max-w-[16rem] py-1 text-sm" placeholder="Search the rules" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the rules" />
      </div>
      <ol className="printout mt-5 divide-y divide-[color-mix(in_oklab,var(--paper-faint)_35%,transparent)] py-2">
        {shown.map((r) => (
          <li key={r.id}>
            <details className="group px-3 py-3">
              <summary className="flex cursor-pointer list-none items-baseline gap-3">
                <span className="w-16 shrink-0 font-type text-[13px] text-paper-faint">{r.id}</span>
                <span className="flex-1 font-semibold">{r.title}</span>
                <span className="hand text-[18px]" style={{ color: SEV_TONE[r.severity] }}>
                  {r.severity}
                </span>
                {r.autofix && <span className="hand hidden text-[18px] text-blue sm:inline">fixable</span>}
              </summary>
              <div className="mt-2 space-y-2 pl-0 text-[14.5px] leading-relaxed sm:pl-[4.75rem]">
                <p>
                  <Code text={r.why} />
                </p>
                <p>
                  <span className="font-semibold">Fix: </span>
                  <Code text={r.fix} />
                </p>
                <p className="text-sm text-paper-faint">
                  {KIND_NAME[r.kind]}.{" "}
                  {r.refs.map((x, i) => (
                    <span key={x.url}>
                      {i > 0 && ", "}
                      <a className="underline underline-offset-2" href={x.url} target="_blank" rel="noreferrer">
                        {x.label}
                      </a>
                    </span>
                  ))}
                </p>
              </div>
            </details>
          </li>
        ))}
        {!shown.length && <li className="px-3 py-8 text-center text-paper-faint">No rule matches that.</li>}
      </ol>
    </div>
  );
}
