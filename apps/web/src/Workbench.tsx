import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { audit, detect, diffLines, fix, KIND_NAME, RULE, SEVERITY_RANK, unifiedDiff, type FileReport, type Kind, type Severity } from "@redline/core";
import { highlight, TOK_COLOR } from "./highlight";
import { addFile, download, findFile, removeFile, resetSample, saveText, SEV_CLASS, SEV_COLOR, useFiles, type WorkFile } from "./lib";
import { Bench } from "./pages/Bench";
import { Rulebook } from "./pages/Rulebook";
import { UseIt } from "./pages/UseIt";

/*
 * The review console. The editor shows the file with flagged lines underlined and numbered in
 * the gutter; annotations sit beside their line on wide screens, and every finding is listed
 * below with why it matters, what to do and its source. Fix preview shows the autofixes as a
 * diff before they are applied.
 */

const LH = 24;
const PAD = 16;
const VIEWS = { "/rules": "Rules", "/bench": "Benchmark", "/use": "CLI, Action, API" } as const;
type ViewPath = keyof typeof VIEWS;

function Code({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="mono rounded-[3px] bg-panel-2 px-1 text-[0.92em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}

const plain = (s: string) => s.replace(/`/g, "");
const fixableRules = (r: FileReport) => [...new Set(r.findings.filter((f) => f.edits?.length).map((f) => f.rule))];
const SEV_SHORT: Record<Severity, string> = { critical: "crit", high: "high", medium: "med", low: "low" };
const gradeTone = (g: string) => (g <= "B" ? "var(--ok)" : g === "C" ? "var(--med)" : "var(--crit)");

function Sev({ s }: { s: Severity }) {
  return (
    <span className="sev shrink-0" style={{ color: SEV_COLOR[s] }} aria-label={s}>
      {SEV_SHORT[s]}
    </span>
  );
}

/** Findings numbered in reading order. */
function numbered(report: FileReport) {
  return [...report.findings].sort((a, b) => a.line - b.line || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).map((f, i) => ({ ...f, n: i + 1 }));
}
type Note = ReturnType<typeof numbered>[number];

/* ───────────── The annotated editor */

function Editor({
  file,
  report,
  notes,
  text,
  onChange,
  jump,
  onCursor,
  onApply,
  onRead,
}: {
  file: WorkFile;
  report: FileReport;
  notes: Note[];
  text: string;
  onChange: (t: string) => void;
  jump: { line: number; n: number } | null;
  onCursor: (line: number, col: number) => void;
  onApply: (rules: string[], label: string) => void;
  onRead: (n: number) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const lines = text.split("\n");
  const byLine = useMemo(() => {
    const m = new Map<number, Note[]>();
    for (const f of notes) for (let l = f.line; l <= (f.endLine ?? f.line); l++) m.set(l, [...(m.get(l) ?? []), f]);
    return m;
  }, [notes]);
  const starts = useMemo(() => {
    const m = new Map<number, Note[]>();
    for (const f of notes) m.set(f.line, [...(m.get(f.line) ?? []), f]);
    return m;
  }, [notes]);

  // Annotations sit beside their line, pushed down when the one above runs long. Heights are
  // measured after drawing, so long ones never overlap.
  const side = useRef<HTMLElement>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const entries = [...starts.entries()];
  useLayoutEffect(() => {
    const el = side.current;
    if (!el) return;
    const measure = () => setHeights([...el.querySelectorAll<HTMLElement>("[data-note]")].map((n) => n.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [notes]);
  let bottom = 0;
  const placed = entries.map(([line, fs], k) => {
    const top = Math.max(PAD + (line - 1) * LH, bottom + 6);
    bottom = top + (heights[k] ?? 20 * fs.length);
    return { line, fs, top };
  });

  useEffect(() => {
    if (!jump || !area.current) return;
    const el = area.current;
    const start = lines.slice(0, jump.line - 1).reduce((n, l) => n + l.length + 1, 0);
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, start + (lines[jump.line - 1]?.length ?? 0));
    document.getElementById(`L${jump.line}`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    onCursor(jump.line, 1);
  }, [jump]);

  useEffect(() => {
    if (menu === null) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const down = (e: MouseEvent) => !(e.target as HTMLElement).closest("[data-menu]") && setMenu(null);
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down);
    };
  }, [menu]);

  const cursor = () => {
    const el = area.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    onCursor(before.split("\n").length, before.length - before.lastIndexOf("\n"));
  };

  return (
    <div className="relative grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="relative flex min-w-0 bg-editor">
        {/* Gutter: line numbers, and a numbered marker on each flagged line. */}
        <div className="gutter mono relative z-10 shrink-0 select-none pb-10 pl-1.5 pr-2 text-right text-[12px] text-faint sm:pl-2.5" style={{ paddingTop: PAD }}>
          {lines.map((_, i) => {
            const fs = starts.get(i + 1);
            return (
              <div key={i} className="flex items-center justify-end gap-1.5" style={{ height: LH }}>
                {fs ? (
                  <button
                    data-menu
                    className="marker hover:brightness-110"
                    style={{ background: SEV_COLOR[fs[0].severity] }}
                    onClick={() => setMenu(menu === i + 1 ? null : i + 1)}
                    aria-expanded={menu === i + 1}
                    aria-label={`Findings on line ${i + 1}: ${fs.map((f) => RULE[f.rule].title).join(", ")}`}
                  >
                    {fs[0].n}
                    {fs.length > 1 ? "+" : ""}
                  </button>
                ) : null}
                <span aria-hidden className="w-6">
                  {i + 1}
                </span>
              </div>
            );
          })}
        </div>

        {/* A highlighted copy underneath, the real textarea on top. */}
        <div className="scroll-y min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative w-max min-w-full">
            <div className="code pointer-events-none pb-10 pl-3 pr-8" style={{ paddingTop: PAD, lineHeight: `${LH}px` }} aria-hidden>
              {lines.map((l, i) => {
                const fs = byLine.get(i + 1);
                const toks = highlight(l, report.kind);
                return (
                  <div key={i} id={`L${i + 1}`} style={{ height: LH, background: fs ? "var(--sel)" : undefined, boxShadow: fs ? `inset 2px 0 0 ${SEV_COLOR[fs[0].severity]}` : undefined }}>
                    <span className={fs ? SEV_CLASS[fs[0].severity] : undefined}>
                      {toks.map((t, k) => (
                        <span key={k} style={t.c ? { color: TOK_COLOR[t.c] } : undefined}>
                          {t.t}
                        </span>
                      ))}
                      {!l && " "}
                    </span>
                  </div>
                );
              })}
            </div>
            <textarea
              ref={area}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onSelect={cursor}
              onKeyUp={cursor}
              onClick={cursor}
              onKeyDown={(e) => {
                if (e.key === "Tab" && !e.shiftKey) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const s = el.selectionStart;
                  onChange(`${el.value.slice(0, s)}  ${el.value.slice(el.selectionEnd)}`);
                  requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              wrap="off"
              aria-label={`Contents of ${file.name}`}
              aria-describedby="findings"
              className="code absolute inset-0 resize-none overflow-hidden bg-transparent pb-10 pl-3 pr-8 text-transparent caret-[var(--accent)] outline-none selection:bg-[var(--accent-soft)] selection:text-transparent"
              style={{ paddingTop: PAD, lineHeight: `${LH}px` }}
            />
          </div>
        </div>
      </div>

      {/* Annotations beside their lines (wide screens; the list below carries them on phones). */}
      <aside ref={side} className="relative hidden border-l border-line bg-surface lg:block" style={{ minHeight: bottom + 24 }} aria-label="Annotations">
        {placed.map(({ line, fs, top }) => (
          <button key={line} data-note className="absolute left-3 right-3 rounded-[4px] text-left text-[12.5px] leading-[20px] hover:bg-panel-2" style={{ top }} onClick={() => onRead(fs[0].n)}>
            {fs.map((f, k) => (
              <span key={k} className="flex gap-2">
                <span className="mono shrink-0 font-semibold" style={{ color: SEV_COLOR[f.severity] }}>
                  {f.n}
                </span>
                <span className="min-w-0 text-muted">
                  <span className="text-ink">{RULE[f.rule].title}</span>
                  <span className="sr-only">, {f.severity}</span>
                </span>
              </span>
            ))}
          </button>
        ))}
      </aside>

      {/* Actions for one line. */}
      {menu !== null && starts.get(menu) && (
        <div className="card pop absolute left-12 z-30 w-[min(26rem,calc(100%-3.5rem))] p-3 sm:left-16" style={{ top: PAD + menu * LH + 4 }} role="menu" aria-label={`Findings on line ${menu}`} data-menu>
          <div className="eyebrow mb-2">Line {menu}</div>
          {starts.get(menu)!.map((f) => {
            const n = report.findings.filter((x) => x.rule === f.rule && x.edits?.length).length;
            return (
              <div key={f.n} className="mb-3 last:mb-0">
                <div className="flex items-start gap-2">
                  <Sev s={f.severity} />
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">{RULE[f.rule].title}</div>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted">
                      <Code text={RULE[f.rule].why} />
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 pl-[3.1rem]">
                  {f.edits?.length ? (
                    <button
                      role="menuitem"
                      className="btn btn-accent btn-sm"
                      onClick={() => {
                        setMenu(null);
                        onApply([f.rule], RULE[f.rule].title);
                      }}
                    >
                      Fix: {RULE[f.rule].title}
                      {n > 1 ? ` (all ${n})` : ""}
                    </button>
                  ) : (
                    <span className="text-[12.5px] text-muted">Manual fix</span>
                  )}
                  <button
                    role="menuitem"
                    className="text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
                    onClick={() => {
                      setMenu(null);
                      onRead(f.n);
                    }}
                  >
                    Details for #{f.n}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────── Findings list */

function Findings({
  files,
  active,
  notes,
  open,
  setOpen,
  onJump,
  onApply,
  scope,
  setScope,
}: {
  files: { f: WorkFile; r: FileReport }[];
  active: WorkFile;
  notes: Note[];
  open: string | null;
  setOpen: (k: string | null) => void;
  onJump: (id: string, line: number) => void;
  onApply: (rules: string[], label: string) => void;
  scope: "file" | "all";
  setScope: (s: "file" | "all") => void;
}) {
  const list =
    scope === "file"
      ? notes.map((n) => ({ ...n, file: active, key: `${active.id}:${n.n}` }))
      : files.flatMap((x) => numbered(x.r).map((n) => ({ ...n, file: x.f, key: `${x.f.id}:${n.n}` }))).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.file.name.localeCompare(b.file.name) || a.n - b.n);
  return (
    <section id="findings" aria-label="Findings" className="border-t border-line px-4 pb-8 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-[15px] font-semibold">Findings</h2>
        <div className="flex rounded-[6px] border border-line p-0.5 text-[12.5px]" role="group" aria-label="Which findings">
          {(
            [
              ["file", "This file"],
              ["all", "All files"],
            ] as const
          ).map(([k, t]) => (
            <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k} className={`rounded-[4px] px-2.5 py-1 ${scope === k ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}>
              {t}
            </button>
          ))}
        </div>
        <span className="mono text-[12.5px] text-muted">{list.length ? `${list.length} finding${list.length === 1 ? "" : "s"}` : "No findings"}</span>
      </div>
      {list.length === 0 && <p className="mt-4 text-[14px] text-muted">Nothing to fix here. Edit the file and it is checked again as you type.</p>}
      <ol className="mt-3 divide-y divide-line">
        {list.map((p) => {
          const rule = RULE[p.rule];
          const isOpen = open === p.key;
          return (
            <li key={p.key} id={`note-${p.key}`}>
              <button
                className={`flex w-full items-start gap-3 px-2 py-2.5 text-left hover:bg-[var(--sel)] ${isOpen ? "bg-[var(--sel)]" : ""}`}
                aria-expanded={isOpen}
                onClick={() => {
                  setOpen(isOpen ? null : p.key);
                  onJump(p.file.id, p.line);
                }}
              >
                <span className="mono mt-0.5 w-6 shrink-0 text-right text-[12px] text-faint">{p.n}</span>
                <Sev s={p.severity} />
                <span className="min-w-0 flex-1 text-[14px] leading-snug">
                  <span className="font-semibold">{rule.title}</span> <span className="text-muted">{plain(p.message)}</span>
                  <span className="mono mt-0.5 block text-[11.5px] text-faint">
                    {p.file.name.split("/").pop()}:{p.line} · {p.rule}
                    {p.edits?.length ? <span className="ml-2 text-ok">autofix</span> : null}
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="pop mb-3 ml-[3.25rem] mr-2 mt-1 max-w-3xl rounded-[8px] border border-line bg-panel px-4 py-3 text-[14px] leading-relaxed">
                  <p>
                    <span className="eyebrow mr-2">Why it matters</span>
                    <Code text={rule.why} />
                  </p>
                  <p className="mt-2">
                    <span className="eyebrow mr-2">What to do</span>
                    <Code text={rule.fix} />
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {p.edits?.length && p.file.id === active.id ? (
                      <button className="btn btn-accent btn-sm" onClick={() => onApply([p.rule], rule.title)}>
                        Fix it
                      </button>
                    ) : null}
                    <span className="text-[13px] text-muted">
                      {rule.refs.map((x, k) => (
                        <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                          {k ? ", " : "Source: "}
                          {x.label}
                        </a>
                      ))}
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ───────────── Fix preview: the autofixes as a diff */

function Preview({ file, report, text, onApplied }: { file: WorkFile; report: FileReport; text: string; onApplied: (next: string, label: string) => void }) {
  const rules = fixableRules(report);
  const [off, setOff] = useState<Set<string>>(new Set());
  const on = new Set(rules.filter((r) => !off.has(r)));
  const result = useMemo(() => fix(file.name, text, on, report.kind ?? undefined), [file.name, text, [...on].join()]);
  const d = useMemo(() => diffLines(text, result.text), [text, result.text]);
  const [copied, setCopied] = useState(false);
  if (!rules.length)
    return (
      <p className="px-6 py-10 text-[14px] text-muted">
        No automatic fixes for this file. {report.findings.length ? "Each finding below says what to change by hand." : ""}
      </p>
    );
  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="code min-w-0 overflow-x-auto bg-editor pb-8" style={{ paddingTop: PAD, lineHeight: `${LH}px` }} aria-label="Diff of the fixed file" role="region">
        {d.map((l, i) => (
          <div key={i} className="flex" style={{ minHeight: LH, background: l.kind === "add" ? "var(--add)" : l.kind === "del" ? "var(--del)" : undefined }}>
            <span className={`w-8 shrink-0 select-none text-center ${l.kind === "add" ? "text-[var(--add-ink)]" : "text-[var(--del-ink)]"}`} aria-hidden>
              {l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}
            </span>
            <span className={`pl-2 pr-6 ${l.kind === "add" ? "text-[var(--add-ink)]" : l.kind === "del" ? "text-[var(--del-ink)]" : ""}`}>
              <span className="sr-only">{l.kind === "add" ? "Added: " : l.kind === "del" ? "Removed: " : ""}</span>
              {l.text || " "}
            </span>
          </div>
        ))}
      </div>
      <aside className="border-t border-line bg-surface p-4 lg:border-l lg:border-t-0" aria-label="Choose the fixes">
        <div className="eyebrow">Fixes to apply</div>
        <ul className="mt-3 space-y-2">
          {rules.map((r) => (
            <li key={r}>
              <label className="flex cursor-pointer items-start gap-2 text-[13.5px] leading-snug">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  checked={!off.has(r)}
                  onChange={() =>
                    setOff((s) => {
                      const n = new Set(s);
                      if (n.has(r)) n.delete(r);
                      else n.add(r);
                      return n;
                    })
                  }
                />
                <span>
                  {RULE[r].title} <span className="mono text-[11px] text-faint">{r}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mono mt-4 text-[13px]">
          <span style={{ color: gradeTone(report.grade) }}>{report.grade}</span> → <span style={{ color: gradeTone(result.report.grade) }}>{result.report.grade}</span>
          <span className="text-muted"> · {result.report.findings.length ? `${result.report.findings.length} left to fix by hand` : "nothing left"}</span>
        </p>
        <div className="mt-4 flex flex-col items-stretch gap-2">
          <button className="btn btn-accent" disabled={result.text === text} onClick={() => onApplied(result.text, `${on.size} fix${on.size === 1 ? "" : "es"}`)}>
            Apply to the file
          </button>
          <button className="btn" onClick={() => download(file.name, result.text)}>
            Download fixed file
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(unifiedDiff(file.name, text, result.text));
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              } catch {
                /* clipboard blocked */
              }
            }}
          >
            {copied ? "Patch copied" : "Copy as patch"}
          </button>
        </div>
      </aside>
    </div>
  );
}

/* ───────────── The console */

export function Workbench() {
  const files = useFiles();
  const [params] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const view = (loc.pathname in VIEWS ? loc.pathname : null) as ViewPath | null;
  const activeId = view ? null : (params.get("file") ?? files[0]?.id);
  const active = findFile(activeId ?? null);

  const [mode, setMode] = useState<"annotated" | "preview">("annotated");
  const [scope, setScope] = useState<"file" | "all">("file");
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [jump, setJump] = useState<{ line: number; n: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: { id: string; text: string } } | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const upload = useRef<HTMLInputElement>(null);

  const reports = useMemo(() => files.map((f) => ({ f, r: audit(f.name, f.text, f.kind) })), [files]);
  const report = active ? (reports.find((x) => x.f.id === active.id)?.r ?? null) : null;
  const notes = useMemo(() => (report ? numbered(report) : []), [report]);

  const open = (id: string) => {
    if (id.startsWith("/")) navigate(id);
    else navigate(`/?file=${encodeURIComponent(id)}`);
  };
  const jumpTo = (id: string, line: number) => {
    if (id !== activeId) open(id);
    setMode("annotated");
    setTimeout(() => setJump({ line, n: Date.now() }), 30);
  };
  const readNote = (n: number) => {
    if (!active) return;
    setScope("file");
    setOpenNote(`${active.id}:${n}`);
    setTimeout(() => document.getElementById(`note-${active.id}:${n}`)?.scrollIntoView({ block: "center" }), 30);
  };

  const apply = useCallback(
    (rules: string[], label: string) => {
      if (!active) return;
      const before = active.text;
      const r = fix(active.name, before, new Set(rules), report?.kind ?? undefined);
      if (r.text === before) return;
      saveText(active.id, r.text);
      const fixed = report ? report.findings.length - r.report.findings.length : 0;
      setToast({ text: `Fixed ${label}${fixed > 0 ? `: ${fixed} finding${fixed === 1 ? "" : "s"} resolved` : ""}.`, undo: { id: active.id, text: before } });
    },
    [active, report],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ".") {
        e.preventDefault();
        if (report) apply(fixableRules(report), "every finding with an autofix");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [apply, report]);

  async function addFrom(list: FileList | File[]) {
    let last: WorkFile | undefined;
    const tooBig: string[] = [];
    const all = [...list];
    for (const f of all.slice(0, 20)) {
      if (f.size >= 1_000_000) tooBig.push(f.name);
      else last = addFile(f.name, await f.text());
    }
    setSkipped([...tooBig.map((n) => `${n} (over 1 MB)`), ...all.slice(20).map((f) => `${f.name} (over 20 files)`)]);
    if (last) open(last.id);
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDropping(false);
    await addFrom(e.dataTransfer.files);
  }

  const total = reports.reduce((n, x) => n + x.r.findings.length, 0);
  const fixable = report ? report.findings.filter((f) => f.edits?.length).length : 0;
  const counts = report ? (["critical", "high", "medium", "low"] as Severity[]).map((s) => [s, report.findings.filter((f) => f.severity === s).length] as const).filter(([, n]) => n) : [];

  return (
    <div
      className="min-h-dvh pb-10"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={onDrop}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-panel focus:p-2">
        Skip to the file
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[84rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <a href="/" onClick={(e) => (e.preventDefault(), open(files[0].id))} className="flex items-center gap-2" aria-label="Redline, back to the first file">
            <span className="h-3.5 w-1.5 rounded-[1px] bg-accent" aria-hidden />
            <span className="mono text-[17px] font-semibold tracking-[-0.01em]">redline</span>
          </a>
          <span className="hidden text-[13px] text-muted md:inline">Security review for Dockerfiles, Compose, Kubernetes, nginx and sshd</span>
          <nav className="ml-auto flex flex-wrap items-center gap-4 text-[13px]" aria-label="Sections">
            <button onClick={() => open(files[0].id)} aria-current={!view ? "page" : undefined} className={`tab py-1 ${!view ? "" : "text-muted hover:text-ink"}`}>
              Files
            </button>
            {(Object.keys(VIEWS) as ViewPath[]).map((to) => (
              <button key={to} onClick={() => open(to)} aria-current={view === to ? "page" : undefined} className={`tab py-1 ${view === to ? "" : "text-muted hover:text-ink"}`}>
                {VIEWS[to]}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[84rem] px-2 pt-4 sm:px-6">
        {!view && (
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            <div className="flex items-center gap-1" role="tablist" aria-label="Files">
              {reports.map(({ f, r }) => {
                const on = f.id === activeId;
                return (
                  <button key={f.id} role="tab" aria-selected={on} onClick={() => open(f.id)} className={`mono flex h-8 shrink-0 items-center gap-2 rounded-[6px] border px-2.5 text-[12.5px] ${on ? "border-line-strong border-[var(--line-strong)] bg-panel-2 text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                    {f.name.split("/").pop()}
                    {f.edited && <span className="text-[11px] text-faint">edited</span>}
                    {r.kind && (
                      <span className="font-semibold" style={{ color: gradeTone(r.grade) }} aria-label={`grade ${r.grade}`}>
                        {r.grade}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {newName !== null ? (
              <form
                className="flex shrink-0 items-center px-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newName.trim();
                  if (!name) return;
                  const f = addFile(name, "");
                  setNewName(null);
                  open(f.id);
                }}
              >
                <input autoFocus className="field mono h-8 w-48 text-[12.5px]" placeholder="Dockerfile, nginx.conf…" value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => !newName.trim() && setNewName(null)} aria-label="New file name" />
              </form>
            ) : (
              <button className="h-8 shrink-0 rounded-[6px] px-2.5 text-[12.5px] text-muted hover:bg-panel-2 hover:text-ink" onClick={() => setNewName("")} aria-label="New file">
                + New file
              </button>
            )}
            <button className="h-8 shrink-0 rounded-[6px] px-2.5 text-[12.5px] text-muted hover:bg-panel-2 hover:text-ink" onClick={() => upload.current?.click()} aria-label="Open files from your computer" title="Files stay in this browser">
              Open files…
            </button>
            <input ref={upload} type="file" multiple className="hidden" onChange={async (e) => (await addFrom(e.target.files ?? []), (e.target.value = ""))} />
          </div>
        )}
        {skipped.length > 0 && (
          <p className="mb-2 flex flex-wrap items-center gap-2 rounded-[6px] border border-[var(--med)] px-3 py-2 text-[13px] text-[var(--med)]" role="alert">
            Not opened: {skipped.join(", ")}.
            <button className="ml-auto text-muted underline underline-offset-2 hover:text-ink" onClick={() => setSkipped([])}>
              Dismiss
            </button>
          </p>
        )}

        <main id="main" className="surface relative overflow-hidden">
          {view ? (
            <div className="doc">{view === "/rules" ? <Rulebook /> : view === "/bench" ? <Bench /> : <UseIt />}</div>
          ) : active && report ? (
            <>
              {/* Summary: what the file is, what was found, the grade. */}
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line px-4 py-4 sm:px-6">
                <div className="min-w-0">
                  <div className="mono truncate text-[14px] font-semibold">{active.own ? active.name : `example/${active.name}`}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                    {report.kind ? (
                      <span>{KIND_NAME[report.kind]}</span>
                    ) : (
                      <span className="text-[var(--med)]">
                        Type not recognised.{" "}
                        <select
                          className="field ml-1 inline h-7 w-auto text-[12.5px]"
                          value=""
                          onChange={(e) => {
                            const k = e.target.value as Kind;
                            removeFile(active.id);
                            open(addFile(active.name, active.text, k).id);
                          }}
                          aria-label="File type"
                        >
                          <option value="">Choose type</option>
                          {(Object.keys(KIND_NAME) as Kind[]).map((k) => (
                            <option key={k} value={k}>
                              {KIND_NAME[k]}
                            </option>
                          ))}
                        </select>
                      </span>
                    )}
                    <span className="mono">
                      {report.findings.length} finding{report.findings.length === 1 ? "" : "s"} · {fixable} autofix
                    </span>
                    {counts.map(([s, n]) => (
                      <span key={s} className="mono" style={{ color: SEV_COLOR[s] }}>
                        {n} {SEV_SHORT[s]}
                      </span>
                    ))}
                    {!active.own && <span className="rounded-[4px] border border-line px-1.5 text-[11px] uppercase tracking-[0.08em] text-faint">Example</span>}
                    {active.own ? (
                      <button
                        className="text-muted underline underline-offset-2 hover:text-ink"
                        onClick={() => {
                          removeFile(active.id);
                          open(files[0].id);
                        }}
                        aria-label={`Delete ${active.name}`}
                      >
                        Delete
                      </button>
                    ) : (
                      active.edited && (
                        <button className="text-muted underline underline-offset-2 hover:text-ink" onClick={() => resetSample(active.id)}>
                          Restore original
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-5">
                  {fixable > 0 && (
                    <button className="btn btn-accent" onClick={() => apply(fixableRules(report), "every finding with an autofix")} title="Ctrl .">
                      Fix all {fixable} <span className="kbd hidden border-[rgba(0,0,0,0.25)] text-[var(--accent-ink)] sm:inline-grid">Ctrl .</span>
                    </button>
                  )}
                  {report.kind && (
                    <div className="text-right" role="img" aria-label={`Grade ${report.grade} (${report.score}/100)`}>
                      <div className="mono text-[28px] font-semibold leading-none" style={{ color: gradeTone(report.grade) }}>
                        {report.grade}
                      </div>
                      <div className="mono mt-1 text-[11px] text-muted">{report.score}/100</div>
                    </div>
                  )}
                </div>
                <span className="sr-only" aria-live="polite">
                  Grade {report.grade} ({report.score}/100)
                </span>
              </div>

              {report.errors.length > 0 && (
                <p className="border-b border-line bg-[var(--del)] px-6 py-2 text-[13px] text-[var(--del-ink)]" role="alert">
                  Part of this file could not be parsed: {report.errors[0]}
                </p>
              )}

              <div className="flex gap-4 border-b border-line px-4 text-[13px] sm:px-6" role="tablist" aria-label="View">
                {(
                  [
                    ["annotated", "Annotated"],
                    ["preview", "Fix preview"],
                  ] as const
                ).map(([k, t]) => (
                  <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`tab py-2.5 ${mode === k ? "font-medium" : "text-muted hover:text-ink"}`}>
                    {t}
                    {k === "preview" && fixable > 0 ? <span className="mono ml-1.5 text-[11px] text-faint">{fixable}</span> : null}
                  </button>
                ))}
              </div>

              {mode === "annotated" ? (
                <Editor key={active.id} file={active} report={report} notes={notes} text={active.text} onChange={(t) => saveText(active.id, t)} jump={jump} onCursor={(line, col) => setCursor({ line, col })} onApply={apply} onRead={readNote} />
              ) : (
                <Preview
                  key={active.id}
                  file={active}
                  report={report}
                  text={active.text}
                  onApplied={(next, label) => {
                    const before = active.text;
                    saveText(active.id, next);
                    setMode("annotated");
                    setToast({ text: `Applied ${label}.`, undo: { id: active.id, text: before } });
                  }}
                />
              )}

              <Findings files={reports} active={active} notes={notes} open={openNote} setOpen={setOpenNote} onJump={jumpTo} onApply={apply} scope={scope} setScope={setScope} />

              <footer className="mono flex flex-wrap gap-x-4 border-t border-line bg-surface px-4 py-2 text-[11.5px] text-faint sm:px-6">
                <span>
                  Ln {cursor.line}, Col {cursor.col}
                </span>
                <span>{report.kind ? KIND_NAME[report.kind] : (detect(active.name, active.text) ?? "unknown type")}</span>
                <span>
                  {total} findings across {files.length} files
                </span>
                <span className="flex-1" />
                <span>Checked in your browser. Nothing is uploaded.</span>
              </footer>
            </>
          ) : (
            <div className="grid place-items-center px-8 py-24 text-center">
              <p className="text-[15px] text-muted">That file is not open.</p>
              <button className="btn mt-4" onClick={() => open(files[0].id)}>
                Open the example Dockerfile
              </button>
            </div>
          )}
        </main>
        {!view && <p className="mt-4 text-center text-[12px] text-faint">Drop config files anywhere on this page to check them.</p>}
      </div>

      {toast && (
        <div className="toast pop fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-4 px-4 py-3" role="status">
          <span className="text-[13.5px] leading-tight">{toast.text}</span>
          {toast.undo && (
            <button
              className="text-[13px] font-semibold text-accent underline-offset-2 hover:underline"
              onClick={() => {
                saveText(toast.undo!.id, toast.undo!.text);
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[rgba(11,13,16,0.8)]">
          <p className="rounded-[10px] border-2 border-dashed border-accent px-8 py-6 text-[16px] font-medium">Drop to check these files</p>
        </div>
      )}
    </div>
  );
}
