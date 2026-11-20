import { useEffect, useMemo, useRef, useState } from "react";
import { audit, detect, diffLines, fix, KIND_NAME, RULE, SAMPLES, SEVERITY_RANK, type Finding, type Severity } from "@redline/core";
import { SEV_COLOR } from "./lib";

const SEEN_KEY = "redline-briefed";

/** Whether to open on the briefing: the first visit only, remembered in this browser. */
export function useBriefing(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setShow(v);
    if (!v)
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* private window: show it again next time */
      }
  };
  return [show, set];
}

/** Closes on Escape, focuses the first marked control and keeps Tab inside while open. */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea, [tabindex='0']")];
      if (!f.length) return;
      const wrapTo = e.shiftKey ? (document.activeElement === f[0] ? f.at(-1) : null) : document.activeElement === f.at(-1) ? f[0] : null;
      if (wrapTo) {
        e.preventDefault();
        wrapTo.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return ref;
}

const gradeTone = (g: string) => (g <= "B" ? "var(--ok)" : g === "C" ? "var(--med)" : "var(--crit)");

/** A line of a Dockerfile being marked up by hand, on a loop: the picture of the idea. */
function Markup() {
  return (
    <div className="code relative overflow-hidden rounded-[6px] border border-line bg-[var(--editor)] px-4 py-3 text-[13px] leading-[1.9]" aria-hidden>
      <div className="text-faint">FROM node:20</div>
      <div>
        <span className="markup-strike relative">ENV API_KEY=sk_live_51H…</span>
        <span className="markup-note hand ml-3 text-[18px] text-[var(--accent)]">secret baked into the image!</span>
      </div>
      <div className="text-faint">COPY . .</div>
      <div>
        <span className="markup-insert hand text-[18px] text-[var(--accent)]">‸ USER node</span>
      </div>
      <div className="text-faint">CMD ["node", "server.js"]</div>
      <span className="markup-stamp stamp hand absolute right-4 top-3 text-[22px]" style={{ color: "var(--crit)" }}>
        D
      </span>
    </div>
  );
}

/** The idea, on the first screen, over the live desk, with the demo one click away. */
export function Briefing({ onTry, onHow, onClose }: { onTry: () => void; onHow: () => void; onClose: () => void }) {
  const ref = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_80%,transparent)] p-3 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <div ref={ref} className="sheet briefing-card w-full max-w-2xl px-5 py-6 shadow-[var(--lift)] sm:px-9 sm:py-8">
        <p className="typed text-[11px] uppercase tracking-[0.18em] text-muted">Redline · the config inspector</p>
        <h1 id="briefing-title" className="typed mt-2 text-[clamp(1.6rem,4.4vw,2.3rem)] font-bold leading-[1.12]">
          Every config file gets a <span className="text-[var(--accent)]">red pen</span> before it ships.
        </h1>
        <div className="mt-4">
          <Markup />
        </div>
        <dl className="mt-5 grid gap-4 text-[14.5px] leading-relaxed sm:grid-cols-3">
          <div>
            <dt className="typed text-[12px] font-bold uppercase tracking-[0.12em]">The problem</dt>
            <dd className="mt-1 text-muted">Dockerfiles, Compose, Kubernetes, nginx and SSH configs ship with quiet mistakes: containers running as root, secrets in images, weak TLS. Scanners answer with a wall of JSON.</dd>
          </div>
          <div>
            <dt className="typed text-[12px] font-bold uppercase tracking-[0.12em]">The idea</dt>
            <dd className="mt-1 text-muted">Treat each file like a typed sheet on an inspector's desk. Problems are marked in the margin with why they matter, fixes appear as proofreading marks you approve, and the sheet gets a grade.</dd>
          </div>
          <div>
            <dt className="typed text-[12px] font-bold uppercase tracking-[0.12em]">Why it's different</dt>
            <dd className="mt-1 text-muted">Fixes are real edits: preview them as a patch, apply only the ones you tick, undo. The same engine runs here, on the command line and in CI, and your files never leave this browser.</dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          <button data-autofocus className="btn btn-accent h-11 px-5 text-[15px]" onClick={onTry}>
            Fix a risky Dockerfile →
          </button>
          <button className="btn h-11 px-4 text-[15px]" onClick={onHow}>
            How it works
          </button>
        </div>
        <button className="typed mt-4 text-[12.5px] text-muted underline-offset-4 hover:text-ink hover:underline" onClick={onClose}>
          Go to the desk <kbd className="kbd ml-1">Esc</kbd>
        </button>
      </div>
    </div>
  );
}

const STAGES = [
  { t: "Recognise", q: "What kind of file is it?" },
  { t: "Read", q: "Can it be read the way the server reads it?" },
  { t: "Mark", q: "What's wrong, and where?" },
  { t: "Explain", q: "Why does it matter?" },
  { t: "Fix", q: "What would the fix change?" },
  { t: "Grade", q: "How safe is it, before and after?" },
] as const;

const WEIGHT: Record<Severity, number> = { critical: 30, high: 12, medium: 5, low: 1 };
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/**
 * How it works, as a walk through the real engine: each stage is the shipping code running on
 * the file you choose, from recognising it to grading the fixed version.
 */
export function HowItWorks({ onClose, onOpen }: { onClose: () => void; onOpen: (f: { sample?: string; name: string; text: string }) => void }) {
  const ref = useDialog(onClose);
  const [pick, setPick] = useState<string>(SAMPLES[0].name);
  const [ownName, setOwnName] = useState("Dockerfile");
  const [ownText, setOwnText] = useState("");
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState(0);
  const own = pick === "own";
  const sample = SAMPLES.find((s) => s.name === pick);
  const name = own ? ownName.trim() || "Dockerfile" : pick;
  const text = own ? ownText : (sample?.text ?? "");

  const run = useMemo(() => {
    const kind = detect(name, text);
    const before = audit(name, text);
    const after = fix(name, text);
    const order = [...before.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.line - b.line);
    const diff = diffLines(text, after.text);
    return { kind, before, after, order, diff };
  }, [name, text]);

  useEffect(() => setFocus(0), [name, text]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(STAGES.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lines = text.split("\n");
  const f: Finding | undefined = run.order[Math.min(focus, run.order.length - 1)];
  const rule = f ? RULE[f.rule] : undefined;
  const changed = run.diff.filter((d) => d.kind !== "same").length;
  const lit = [!run.kind, run.before.errors.length > 0, run.before.findings.length > 0, run.before.findings.length > 0, run.after.fixed.length > 0, run.before.grade > "B"];

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_84%,transparent)] p-2 backdrop-blur-[3px] sm:p-4" role="dialog" aria-modal="true" aria-labelledby="how-title">
      <div ref={ref} className="sheet w-full max-w-4xl px-4 py-5 shadow-[var(--lift)] sm:px-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="typed text-[11px] uppercase tracking-[0.18em] text-muted">How it works · the real engine, live</p>
            <h2 id="how-title" className="typed mt-1 text-[1.45rem] font-bold">
              Follow one file across the desk
            </h2>
          </div>
          <button className="btn h-8 px-3 text-[13px]" onClick={onClose} aria-label="Close how it works">
            Close
          </button>
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="File to follow">
          {[...SAMPLES.map((s) => s.name), "own"].map((n) => (
            <button key={n} role="radio" aria-checked={pick === n} onClick={() => setPick(n)} className={`typed h-8 shrink-0 rounded-full border px-3 text-[12.5px] ${pick === n ? "border-[var(--accent)] text-ink" : "border-line text-muted hover:text-ink"}`}>
              {n === "own" ? "Paste your own" : n.split("/").pop()}
            </button>
          ))}
        </div>
        {own && (
          <div className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr]">
            <input className="field h-9 text-[13px]" value={ownName} onChange={(e) => setOwnName(e.target.value)} aria-label="File name" placeholder="Dockerfile, nginx.conf…" />
            <textarea data-autofocus className="field code min-h-24 text-[12.5px]" value={ownText} onChange={(e) => setOwnText(e.target.value)} aria-label="File contents" placeholder="Paste a Dockerfile, docker-compose.yml, Kubernetes manifest, nginx.conf or sshd_config" />
          </div>
        )}

        <ol className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="Stages">
          {STAGES.map((s, i) => (
            <li key={s.t}>
              <button onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined} className={`w-full rounded-[6px] border px-2 py-2 text-left ${step === i ? "border-[var(--accent)] bg-[var(--sel)]" : "border-line hover:border-faint"}`}>
                <span className="typed flex items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: lit[i] ? "var(--accent)" : "var(--ok)" }} aria-hidden />
                  {i + 1}
                </span>
                <span className="typed block text-[13.5px] font-bold">{s.t}</span>
                <span className="sr-only">{lit[i] ? ", needs attention" : ", fine"}</span>
              </button>
            </li>
          ))}
        </ol>

        <section className="mt-4 min-h-[17rem]" aria-live="polite">
          <h3 className="typed text-[1.02rem] font-bold">
            {step + 1}. {STAGES[step].q}
          </h3>

          {!text.trim() ? (
            <p className="mt-3 text-sm text-muted">Paste a config file above to follow it through.</p>
          ) : (
            <>
              {step === 0 && (
                <div className="mt-2 space-y-3 text-[14px]">
                  <p className="text-muted">Redline looks at the file name first (Dockerfile, compose.yaml, sshd_config), then at the contents: FROM and RUN lines, apiVersion and kind, server blocks. Source code, docs and lock files are turned away rather than guessed at.</p>
                  {run.kind ? (
                    <p>
                      <span className="typed font-bold">{name.split("/").pop()}</span> reads as <span className="circled hand text-[20px] text-[var(--accent)]">{KIND_NAME[run.kind]}</span>
                    </p>
                  ) : (
                    <p className="text-[var(--med)]">Not a file type Redline reads. On the desk you can say which type it is.</p>
                  )}
                </div>
              )}

              {step === 1 && (
                <div className="mt-2 space-y-3 text-[14px]">
                  <p className="text-muted">Each format has its own reader: Dockerfile instructions with line continuations and build stages, YAML documents, nginx blocks and directives, sshd keywords. A file that can't be read is reported, never silently passed.</p>
                  {run.before.errors.length ? (
                    <ul className="list-disc pl-5 text-[var(--crit)]">
                      {run.before.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[var(--ok)]">
                      Read cleanly: {lines.length} line{lines.length === 1 ? "" : "s"}.
                    </p>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="mt-2 space-y-3 text-[14px]">
                  <p className="text-muted">Every rule works on the parsed file, so each mark lands on the exact line it is about, worst first.</p>
                  <div className="typed flex flex-wrap gap-3 text-[13px]">
                    {SEVERITIES.map((s) => (
                      <span key={s} style={{ color: SEV_COLOR[s] }}>
                        {run.before.findings.filter((x) => x.severity === s).length} {s}
                      </span>
                    ))}
                  </div>
                  {run.order.length ? (
                    <ul tabIndex={0} aria-label="Problems, worst first" className="code max-h-56 space-y-1 overflow-y-auto rounded-[6px] border border-line bg-[var(--editor)] px-3 py-2 text-[12.5px]">
                      {run.order.map((x, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="w-10 shrink-0 text-right text-faint">L{x.line}</span>
                          <span style={{ color: SEV_COLOR[x.severity] }}>{x.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[var(--ok)]">Nothing to mark. A clean sheet.</p>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="mt-2 space-y-3 text-[14px]">
                  {f && rule ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="btn h-7 px-2 text-[12px]" disabled={focus === 0} onClick={() => setFocus((n) => n - 1)} aria-label="Previous problem">
                          ←
                        </button>
                        <span className="typed text-[12.5px] text-muted">
                          {Math.min(focus, run.order.length - 1) + 1} of {run.order.length}
                        </span>
                        <button className="btn h-7 px-2 text-[12px]" disabled={focus >= run.order.length - 1} onClick={() => setFocus((n) => n + 1)} aria-label="Next problem">
                          →
                        </button>
                        <span className="typed text-[12.5px]" style={{ color: SEV_COLOR[f.severity] }}>
                          {f.severity} · {rule.id} · line {f.line}
                        </span>
                      </div>
                      <p className="typed font-bold">{rule.title}</p>
                      <p className="code rounded-[6px] border border-line bg-[var(--editor)] px-3 py-2 text-[12.5px]">{lines[f.line - 1] ?? ""}</p>
                      <p>
                        <span className="hand text-[19px] text-[var(--accent)]">why it matters </span>
                        <span className="text-muted">{rule.why}</span>
                      </p>
                      <p>
                        <span className="hand text-[19px] text-[var(--accent)]">what to do </span>
                        <span className="text-muted">{rule.fix}</span> {rule.autofix && <span className="typed text-[12px] text-[var(--ok)]">Redline can fix this for you.</span>}
                      </p>
                      {rule.refs.length > 0 && (
                        <p className="text-[13px] text-muted">
                          Read more:{" "}
                          {rule.refs.map((r, i) => (
                            <span key={r.url}>
                              {i > 0 && ", "}
                              <a className="underline underline-offset-2 hover:text-ink" href={r.url} target="_blank" rel="noreferrer">
                                {r.label}
                              </a>
                            </span>
                          ))}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-[var(--ok)]">No problems, so nothing to explain.</p>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="mt-2 space-y-3 text-[14px]">
                  <p className="text-muted">Safe fixes are written as edits to specific lines. Redline applies them, checks the result again (one fix can reveal another, up to three rounds), and throws away any round that would leave the file unreadable.</p>
                  {run.after.fixed.length ? (
                    <>
                      <p className="typed text-[13px]">
                        {run.after.fixed.length} fix{run.after.fixed.length === 1 ? "" : "es"} applied, {changed} line{changed === 1 ? "" : "s"} changed, {run.after.report.findings.length} left for a person to decide.
                      </p>
                      <pre tabIndex={0} aria-label="The fixes as a diff" className="code max-h-60 overflow-auto rounded-[6px] border border-line bg-[var(--editor)] px-3 py-2 text-[12.5px] leading-[1.7]">
                        {run.diff.map((d, i) => (
                          <div key={i} className={d.kind === "add" ? "bg-[var(--add)] text-[var(--add-ink)]" : d.kind === "del" ? "text-faint line-through decoration-[var(--accent)]" : "text-muted"}>
                            {d.kind === "add" ? "+ " : d.kind === "del" ? "- " : "  "}
                            {d.text || " "}
                          </div>
                        ))}
                      </pre>
                    </>
                  ) : (
                    <p className="text-muted">{run.before.findings.length ? "None of these can be fixed safely without a person deciding, so Redline only marks them." : "Nothing to fix."}</p>
                  )}
                </div>
              )}

              {step === 5 && (
                <div className="mt-2 space-y-3 text-[14px]">
                  <p className="text-muted">
                    100, minus {WEIGHT.critical} per critical, {WEIGHT.high} per high, {WEIGHT.medium} per medium and {WEIGHT.low} per low problem. Any critical caps the grade at D: one is enough to lose the host.
                  </p>
                  <div className="flex flex-wrap items-center gap-8 pt-2">
                    {[
                      ["As written", run.before],
                      ["After the fixes", run.after.report],
                    ].map(([label, r]) => {
                      const rep = r as typeof run.before;
                      return (
                        <div key={label as string} className="text-center">
                          <div className="stamp relative inline-block px-4 text-[30px]" style={{ color: gradeTone(rep.grade) }} role="img" aria-label={`${label}: grade ${rep.grade}, ${rep.score} out of 100`}>
                            {rep.grade}
                          </div>
                          <p className="typed mt-2 text-[12.5px] text-muted">
                            {label as string} · {rep.score}/100
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            ← Back
          </button>
          {step < STAGES.length - 1 && (
            <button className="btn btn-accent" onClick={() => setStep((s) => s + 1)}>
              Next: {STAGES[step + 1].t} →
            </button>
          )}
          <span className="flex-1" />
          <button className="btn btn-accent" disabled={!text.trim()} onClick={() => onOpen({ sample: own ? undefined : `sample:${pick}`, name, text })}>
            Put it on the desk →
          </button>
        </div>
      </div>
    </div>
  );
}
