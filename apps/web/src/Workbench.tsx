import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { audit, detect, diffLines, fix, KIND_NAME, RULE, SEVERITY_RANK, unifiedDiff, type FileReport, type Kind, type Severity } from "@redline/core";
import { highlight, TOK_COLOR } from "./highlight";
import { addFile, download, findFile, removeFile, resetSample, saveText, SEV_CLASS, SEV_COLOR, useFiles, type DeskFile } from "./lib";
import { Bench } from "./pages/Bench";
import { Rulebook } from "./pages/Rulebook";
import { UseIt } from "./pages/UseIt";

/*
 * The inspector's desk. A config file is a typed sheet; Redline marks it up by hand: a
 * circled number in the left margin for each problem, the note in the right margin (or as a
 * footnote on a phone), and the grade stamped at the top. "Proof" shows the fixes as
 * proofreading marks before they are written in.
 */

const LH = 24;
const PAD = 16;
const VIEWS = { "/rules": "Manual", "/bench": "Lab report", "/use": "Paperwork" } as const;
type ViewPath = keyof typeof VIEWS;

function Code({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="typed text-[0.95em]">
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
/** Proofreaders' marks for how bad it is, written next to the note. */
const MARK: Record<Severity, string> = { critical: "!!", high: "!", medium: "?", low: "·" };
const SEV_WORD: Record<Severity, string> = { critical: "critical", high: "high", medium: "medium", low: "low" };
const gradeTone = (g: string) => (g <= "B" ? "var(--ok)" : g === "C" ? "var(--med)" : "var(--crit)");

/** Findings numbered in reading order, like footnotes. */
function numbered(report: FileReport) {
  return [...report.findings].sort((a, b) => a.line - b.line || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).map((f, i) => ({ ...f, n: i + 1 }));
}
type Note = ReturnType<typeof numbered>[number];

/* ───────────── The marked-up sheet */

function Sheet({
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
  file: DeskFile;
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
  const [card, setCard] = useState<number | null>(null);
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

  // Margin notes sit beside their line, pushed down when the one above runs long. Heights are
  // measured after drawing, so long notes never overlap or run off the sheet.
  const margin = useRef<HTMLElement>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const entries = [...starts.entries()];
  useLayoutEffect(() => {
    const el = margin.current;
    if (!el) return;
    const measure = () => setHeights([...el.querySelectorAll<HTMLElement>("[data-note]")].map((n) => n.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [notes]);
  let bottom = 0;
  const placed = entries.map(([line, fs], k) => {
    const top = Math.max(PAD + (line - 1) * LH - 2, bottom + 8);
    bottom = top + (heights[k] ?? 21 * fs.length);
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
    if (card === null) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setCard(null);
    const down = (e: MouseEvent) => !(e.target as HTMLElement).closest("[data-card]") && setCard(null);
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down);
    };
  }, [card]);

  const cursor = () => {
    const el = area.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    onCursor(before.split("\n").length, before.length - before.lastIndexOf("\n"));
  };

  return (
    <div className="relative grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_17.5rem]">
      <div className="relative flex min-w-0">
        {/* Left margin: line numbers, and a circled number for each problem. */}
        <div className="margin-rule typed relative z-10 shrink-0 select-none pb-10 pl-1 pr-2 text-right text-[12px] text-faint sm:pl-3 sm:pr-3" style={{ paddingTop: PAD }}>
          {lines.map((_, i) => {
            const fs = starts.get(i + 1);
            return (
              <div key={i} className="flex items-center justify-end gap-1.5" style={{ height: LH }}>
                {fs ? (
                  <button
                    data-card
                    className="circled hover:bg-[var(--accent-soft)]"
                    style={{ color: SEV_COLOR[fs[0].severity] }}
                    onClick={() => setCard(card === i + 1 ? null : i + 1)}
                    aria-expanded={card === i + 1}
                    aria-label={`Corrections for line ${i + 1}: ${fs.map((f) => RULE[f.rule].title).join(", ")}`}
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

        {/* The typed text: a marked-up copy underneath, the real textarea on top. */}
        <div className="scroll-y min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative w-max min-w-full">
            <div className="code pointer-events-none pb-10 pl-3 pr-8" style={{ paddingTop: PAD, lineHeight: `${LH}px` }} aria-hidden>
              {lines.map((l, i) => {
                const fs = byLine.get(i + 1);
                const toks = highlight(l, report.kind);
                return (
                  <div key={i} id={`L${i + 1}`} style={{ height: LH, background: fs ? "var(--sel)" : undefined }}>
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
              aria-describedby="sheet-notes"
              className="code absolute inset-0 resize-none overflow-hidden bg-transparent pb-10 pl-3 pr-8 text-transparent caret-[var(--accent)] outline-none selection:bg-[var(--accent-soft)] selection:text-transparent"
              style={{ paddingTop: PAD, lineHeight: `${LH}px` }}
            />
          </div>
        </div>
      </div>

      {/* Right margin: the notes, in the inspector's hand. */}
      <aside ref={margin} className="relative hidden border-l border-dashed border-line lg:block" style={{ minHeight: bottom + 24 }} aria-label="Margin notes">
        {placed.map(({ line, fs, top }) => (
          <button key={line} data-note className="hand absolute left-3 right-3 text-left text-[18px] leading-[21px] hover:underline" style={{ top, color: SEV_COLOR[fs[0].severity] }} onClick={() => onRead(fs[0].n)}>
            {fs.map((f, k) => (
              <span key={k} className="block" style={{ color: SEV_COLOR[f.severity] }}>
                <span className="typed mr-1 text-[11px] font-bold no-underline">{f.n}</span>
                {plain(f.message)} <span aria-label={SEV_WORD[f.severity]}>{MARK[f.severity]}</span>
              </span>
            ))}
          </button>
        ))}
      </aside>

      {/* The index card for one line: what's wrong and what can be corrected. */}
      {card !== null && starts.get(card) && (
        <div className="card pop absolute left-12 z-30 w-[min(25rem,calc(100%-3.5rem))] rounded-[3px] p-3 sm:left-16" style={{ top: PAD + card * LH + 4 }} role="menu" aria-label={`Corrections for line ${card}`} data-card>
          <div className="typed mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Line {card}</div>
          {starts.get(card)!.map((f) => {
            const n = report.findings.filter((x) => x.rule === f.rule && x.edits?.length).length;
            return (
              <div key={f.n} className="mb-2.5">
                <div className="flex items-start gap-2">
                  <span className="circled shrink-0" style={{ color: SEV_COLOR[f.severity] }}>
                    {f.n}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">{RULE[f.rule].title}</div>
                    <p className="text-[13px] leading-snug text-muted">
                      <Code text={RULE[f.rule].why} />
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2 pl-8">
                  {f.edits?.length ? (
                    <button
                      role="menuitem"
                      className="btn btn-accent min-h-[1.8rem] text-[12.5px]"
                      onClick={() => {
                        setCard(null);
                        onApply([f.rule], RULE[f.rule].title);
                      }}
                    >
                      Fix: {RULE[f.rule].title}
                      {n > 1 ? ` (all ${n})` : ""}
                    </button>
                  ) : (
                    <span className="hand text-[17px] text-muted">needs a person, see note {f.n}</span>
                  )}
                  <button
                    role="menuitem"
                    className="typed text-[12.5px] underline underline-offset-2 hover:text-[var(--accent)]"
                    onClick={() => {
                      setCard(null);
                      onRead(f.n);
                    }}
                  >
                    Read note {f.n}
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

/* ───────────── The inspector's notes: footnotes under the sheet */

function Notes({
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
  files: { f: DeskFile; r: FileReport }[];
  active: DeskFile;
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
    <section id="sheet-notes" aria-label="Inspector's notes" className="border-t-2 border-dashed border-line px-4 pb-8 pt-5 sm:px-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className="typed text-[13px] font-bold uppercase tracking-[0.16em]">Inspector's notes</h2>
        <div className="typed flex gap-3 text-[12.5px]" role="group" aria-label="Which notes">
          {(
            [
              ["file", "this sheet"],
              ["all", "every sheet"],
            ] as const
          ).map(([k, t]) => (
            <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k} className={`rounded-[50%] px-2 py-0.5 ${scope === k ? "outline-[1.5px] outline outline-[var(--accent)] text-ink" : "text-muted hover:text-ink"}`}>
              {t}
            </button>
          ))}
        </div>
        <span className="hand text-[18px] text-muted">{list.length ? `${list.length} problem${list.length === 1 ? "" : "s"}` : "nothing to report, nice work"}</span>
      </div>
      <ol className="mt-3 space-y-1">
        {list.map((p) => {
          const rule = RULE[p.rule];
          const isOpen = open === p.key;
          return (
            <li key={p.key} id={`note-${p.key}`}>
              <button
                className={`flex w-full items-start gap-3 rounded-[3px] px-2 py-1.5 text-left hover:bg-[var(--sel)] ${isOpen ? "bg-[var(--sel)]" : ""}`}
                aria-expanded={isOpen}
                onClick={() => {
                  setOpen(isOpen ? null : p.key);
                  onJump(p.file.id, p.line);
                }}
              >
                <span className="circled mt-0.5 shrink-0" style={{ color: SEV_COLOR[p.severity] }} aria-label={`Note ${p.n}, ${p.severity}`}>
                  {p.n}
                </span>
                <span className="min-w-0 flex-1 text-[14px] leading-snug">
                  <span className="font-semibold">{rule.title}</span> <span className="text-muted">{plain(p.message)}</span>
                  <span className="typed ml-2 whitespace-nowrap text-[11.5px] text-faint">
                    {p.file.name.split("/").pop()}:{p.line} · {p.rule}
                  </span>
                  {p.edits?.length ? <span className="hand ml-2 text-[17px] text-ok">fixable</span> : null}
                </span>
              </button>
              {isOpen && (
                <div className="card pop mb-3 ml-9 mt-1 max-w-3xl rounded-[3px] px-4 pb-3 pt-2.5 text-[14px] leading-relaxed">
                  <p>
                    <span className="typed text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Why it matters </span>
                    <Code text={rule.why} />
                  </p>
                  <p className="mt-1.5">
                    <span className="typed text-[11px] font-bold uppercase tracking-[0.14em] text-muted">What to do </span>
                    <Code text={rule.fix} />
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {p.edits?.length && p.file.id === active.id ? (
                      <button className="btn btn-accent" onClick={() => onApply([p.rule], rule.title)}>
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

/* ───────────── Proof: the fixes as proofreading marks, before they are written in */

function Proof({ file, report, text, onApplied }: { file: DeskFile; report: FileReport; text: string; onApplied: (next: string, label: string) => void }) {
  const rules = fixableRules(report);
  const [off, setOff] = useState<Set<string>>(new Set());
  const on = new Set(rules.filter((r) => !off.has(r)));
  const result = useMemo(() => fix(file.name, text, on, report.kind ?? undefined), [file.name, text, [...on].join()]);
  const d = useMemo(() => diffLines(text, result.text), [text, result.text]);
  const [copied, setCopied] = useState(false);
  if (!rules.length)
    return (
      <p className="hand px-8 py-10 text-[22px] text-muted">
        Nothing on this sheet can be corrected automatically. {report.findings.length ? "The notes below say what a person needs to do." : ""}
      </p>
    );
  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
      <div className="code min-w-0 overflow-x-auto pb-8 text-[13.5px]" style={{ paddingTop: PAD, lineHeight: `${LH}px` }} aria-label="Proof of the corrected file" role="region">
        {d.map((l, i) => (
          <div key={i} className="flex" style={{ minHeight: LH }}>
            <span className="margin-rule hand w-[3.25rem] shrink-0 select-none pr-3 text-right text-[18px] text-[var(--accent)] sm:w-[4.5rem]" aria-hidden>
              {l.kind === "add" ? "‸" : l.kind === "del" ? "dele" : ""}
            </span>
            <span className={`pl-3 pr-6 ${l.kind === "add" ? "font-bold text-[var(--add-ink)]" : l.kind === "del" ? "text-muted line-through decoration-[var(--accent)] decoration-2" : ""}`}>
              <span className="sr-only">{l.kind === "add" ? "Added: " : l.kind === "del" ? "Removed: " : ""}</span>
              {l.text || " "}
            </span>
          </div>
        ))}
      </div>
      <aside className="border-t border-dashed border-line p-4 lg:border-l lg:border-t-0" aria-label="Choose the fixes">
        <div className="typed text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Fixes to make</div>
        <ul className="mt-2 space-y-1.5">
          {rules.map((r) => (
            <li key={r}>
              <label className="flex cursor-pointer items-start gap-2 text-[14px] leading-snug">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
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
                  {RULE[r].title} <span className="typed text-[11px] text-faint">{r}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="hand mt-3 text-[19px] leading-tight" style={{ color: gradeTone(result.report.grade) }}>
          {report.grade} → {result.report.grade}. {result.report.findings.length ? `${result.report.findings.length} left for a person.` : "Nothing left."}
        </p>
        <div className="mt-3 flex flex-col items-start gap-2">
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

/* ───────────── The desk */

export function Workbench() {
  const files = useFiles();
  const [params] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const view = (loc.pathname in VIEWS ? loc.pathname : null) as ViewPath | null;
  const activeId = view ? null : (params.get("file") ?? files[0]?.id);
  const active = findFile(activeId ?? null);

  const [mode, setMode] = useState<"marked" | "proof">("marked");
  const [scope, setScope] = useState<"file" | "all">("file");
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [jump, setJump] = useState<{ line: number; n: number } | null>(null);
  const [slip, setSlip] = useState<{ text: string; undo?: { id: string; text: string } } | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
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
    setMode("marked");
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
      setSlip({ text: `Fixed ${label}${fixed > 0 ? `: ${fixed} problem${fixed === 1 ? "" : "s"} gone` : ""}.`, undo: { id: active.id, text: before } });
    },
    [active, report],
  );

  useEffect(() => {
    if (!slip) return;
    const t = setTimeout(() => setSlip(null), 8000);
    return () => clearTimeout(t);
  }, [slip]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ".") {
        e.preventDefault();
        if (report) apply(fixableRules(report), "every problem with a fix");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [apply, report]);

  async function addFrom(list: FileList | File[]) {
    let last: DeskFile | undefined;
    for (const f of [...list].slice(0, 20)) if (f.size < 1_000_000) last = addFile(f.name, await f.text());
    if (last) open(last.id);
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDropping(false);
    await addFrom(e.dataTransfer.files);
  }

  const total = reports.reduce((n, x) => n + x.r.findings.length, 0);
  const fixable = report ? report.findings.filter((f) => f.edits?.length).length : 0;

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
      <a href="#sheet" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-[var(--editor)] focus:p-2">
        Skip to the sheet
      </a>
      <div className="mx-auto max-w-[80rem] px-2 sm:px-5">
        {/* The top of the desk: the name, the reference shelf, and the lamp. */}
        <header className="flex flex-wrap items-end gap-x-6 gap-y-2 px-2 pb-3 pt-4">
          <a href="/" onClick={(e) => (e.preventDefault(), open(files[0].id))} className="group relative" aria-label="Redline, back to the first sheet">
            <span className="typed text-[24px] font-bold tracking-[-0.02em]">Redline</span>
            <svg viewBox="0 0 120 12" className="absolute -bottom-1.5 left-0 h-3 w-full text-[var(--accent)]" aria-hidden preserveAspectRatio="none">
              <path d="M2 8 C 30 3, 60 11, 118 4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </a>
          <span className="hand hidden text-[19px] text-muted sm:inline">inspects config files with a red pen</span>
          <nav className="typed ml-auto flex items-center gap-1 text-[13px]" aria-label="Reference">
            {(Object.keys(VIEWS) as ViewPath[]).map((to) => (
              <button key={to} onClick={() => open(to)} aria-current={view === to ? "page" : undefined} className={`rounded-[50%] px-2.5 py-1 ${view === to ? "outline-[1.6px] outline outline-[var(--accent)]" : "text-muted hover:text-ink"}`}>
                {VIEWS[to]}
              </button>
            ))}
            <Lamp />
          </nav>
        </header>

        {/* Folder tabs: one per sheet on the desk. */}
        <div className="flex items-end gap-1 overflow-x-auto px-1 pt-1">
          <div className="flex items-end gap-1" role="tablist" aria-label="Sheets on the desk">
          {reports.map(({ f, r }) => {
            const on = !view && f.id === activeId;
            return (
              <button key={f.id} role="tab" aria-selected={on} onClick={() => open(f.id)} className={`folder typed flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2 text-[13px] ${on ? "font-bold text-ink" : "text-muted hover:text-ink"}`}>
                {f.name.split("/").pop()}
                {f.edited && <span className="hand text-[15px] text-faint">edited</span>}
                {r.kind && (
                  <span className="hand text-[18px] font-bold leading-none" style={{ color: gradeTone(r.grade) }} aria-label={`grade ${r.grade}`}>
                    {r.grade}
                  </span>
                )}
              </button>
            );
          })}
          </div>
          {newName !== null ? (
            <form
              className="folder flex shrink-0 items-center px-2 pb-1 pt-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const name = newName.trim();
                if (!name) return;
                const f = addFile(name, "");
                setNewName(null);
                open(f.id);
              }}
            >
              <input autoFocus className="field h-7 w-44 text-[13px]" placeholder="Dockerfile, nginx.conf…" value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => !newName.trim() && setNewName(null)} aria-label="New file name" />
            </form>
          ) : (
            <button className="hand shrink-0 px-3 pb-1 text-[19px] text-muted hover:text-[var(--accent)]" onClick={() => setNewName("")} aria-label="New file" title="A blank sheet">
              + blank sheet
            </button>
          )}
          <button className="hand shrink-0 px-3 pb-1 text-[19px] text-muted hover:text-[var(--accent)]" onClick={() => upload.current?.click()} aria-label="Open files from your computer" title="Your own files stay in this browser">
            + from your computer
          </button>
          <input ref={upload} type="file" multiple className="hidden" onChange={async (e) => (await addFrom(e.target.files ?? []), (e.target.value = ""))} />
        </div>

        <main id="sheet" className="sheet relative">
          {view ? (
            <div className="doc">{view === "/rules" ? <Rulebook /> : view === "/bench" ? <Bench /> : <UseIt />}</div>
          ) : active && report ? (
            <>
              {/* The form at the top of the sheet. */}
              <div className="flex flex-wrap items-start gap-x-8 gap-y-3 border-b border-line px-4 pb-4 pt-5 sm:px-8">
                <dl className="typed grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">File</dt>
                  <dd className="font-bold">{active.own ? active.name : `shop/${active.name}`}</dd>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">Type</dt>
                  <dd>
                    {report.kind ? (
                      KIND_NAME[report.kind]
                    ) : (
                      <span className="text-[var(--med)]">
                        not one Redline reads,{" "}
                        <select
                          className="field inline h-6 w-auto text-[13px]"
                          value=""
                          onChange={(e) => {
                            const k = e.target.value as Kind;
                            removeFile(active.id);
                            open(addFile(active.name, active.text, k).id);
                          }}
                          aria-label="File type"
                        >
                          <option value="">say which</option>
                          {(Object.keys(KIND_NAME) as Kind[]).map((k) => (
                            <option key={k} value={k}>
                              {KIND_NAME[k]}
                            </option>
                          ))}
                        </select>
                      </span>
                    )}
                  </dd>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">Found</dt>
                  <dd>
                    {report.findings.length} problem{report.findings.length === 1 ? "" : "s"}, {fixable} fixable
                  </dd>
                </dl>
                <div className="flex flex-wrap items-center gap-3 self-center text-[13px]">
                  {active.own ? (
                    <button
                      className="typed text-muted underline underline-offset-2 hover:text-[var(--accent)]"
                      onClick={() => {
                        removeFile(active.id);
                        open(files[0].id);
                      }}
                      aria-label={`Delete ${active.name}`}
                    >
                      throw away this sheet
                    </button>
                  ) : (
                    active.edited && (
                      <button className="typed text-muted underline underline-offset-2 hover:text-ink" onClick={() => resetSample(active.id)}>
                        restore the original
                      </button>
                    )
                  )}
                </div>
                <div className="ml-auto flex items-center gap-5 pr-2">
                  {fixable > 0 && (
                    <button className="hand text-[21px] leading-none text-[var(--accent)] underline decoration-wavy decoration-1 underline-offset-4 hover:decoration-2" onClick={() => apply(fixableRules(report), "every problem with a fix")} title="Ctrl .">
                      fix all {fixable} →
                    </button>
                  )}
                  {report.kind && (
                    <div key={`${report.grade}${report.score}`} className="stamp" style={{ color: gradeTone(report.grade) }} role="img" aria-label={`Grade ${report.grade} (${report.score}/100)`}>
                      <span className="text-[30px] leading-none">{report.grade}</span>
                      <span className="text-[10px] tracking-[0.2em]">{report.score}/100</span>
                    </div>
                  )}
                </div>
                <span className="sr-only" aria-live="polite">
                  Grade {report.grade} ({report.score}/100)
                </span>
              </div>

              {report.errors.length > 0 && <p className="hand border-b border-line px-8 py-2 text-[19px] text-[var(--crit)]">Can't read part of this sheet: {report.errors[0]}</p>}

              {/* Marked up, or the proof of the fixes. */}
              <div className="typed flex gap-1 px-4 pt-3 text-[13px] sm:px-8" role="tablist" aria-label="How to show the sheet">
                {(
                  [
                    ["marked", "Marked up"],
                    ["proof", "Fix preview"],
                  ] as const
                ).map(([k, t]) => (
                  <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`rounded-[50%] px-3 py-1 ${mode === k ? "outline-[1.6px] outline outline-[var(--accent)] font-bold" : "text-muted hover:text-ink"}`}>
                    {t}
                  </button>
                ))}
              </div>

              {mode === "marked" ? (
                <Sheet key={active.id} file={active} report={report} notes={notes} text={active.text} onChange={(t) => saveText(active.id, t)} jump={jump} onCursor={(line, col) => setCursor({ line, col })} onApply={apply} onRead={readNote} />
              ) : (
                <Proof
                  key={active.id}
                  file={active}
                  report={report}
                  text={active.text}
                  onApplied={(next, label) => {
                    const before = active.text;
                    saveText(active.id, next);
                    setMode("marked");
                    setSlip({ text: `Applied ${label}.`, undo: { id: active.id, text: before } });
                  }}
                />
              )}

              <Notes files={reports} active={active} notes={notes} open={openNote} setOpen={setOpenNote} onJump={jumpTo} onApply={apply} scope={scope} setScope={setScope} />

              <footer className="typed flex flex-wrap gap-x-4 border-t border-line px-4 py-2 text-[11.5px] text-faint sm:px-8">
                <span>
                  Ln {cursor.line}, Col {cursor.col}
                </span>
                <span>{report.kind ? KIND_NAME[report.kind] : (detect(active.name, active.text) ?? "unknown type")}</span>
                <span>
                  {total} problems across {files.length} sheets
                </span>
                <span className="flex-1" />
                <span>Checked in your browser; nothing is uploaded.</span>
              </footer>
            </>
          ) : (
            <div className="grid place-items-center px-8 py-24 text-center">
              <p className="hand text-[26px] text-muted">Nothing on the desk.</p>
              <button className="btn mt-4" onClick={() => open(files[0].id)}>
                Open the example Dockerfile
              </button>
            </div>
          )}
        </main>
        <p className="typed mt-4 px-2 text-center text-[11.5px] text-muted">
          Drop config files anywhere on the desk to check them. ·{" "}
          <a href="https://github.com/Vishwanathanirv/config-auditor" className="underline underline-offset-2 hover:text-ink">
            Source
          </a>
        </p>
      </div>

      {slip && (
        <div className="slip pop fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-4 px-4 py-3" role="status">
          <span className="hand text-[19px] leading-tight">{slip.text}</span>
          {slip.undo && (
            <button
              className="typed text-[13px] font-bold underline underline-offset-2"
              onClick={() => {
                saveText(slip.undo!.id, slip.undo!.text);
                setSlip(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[var(--accent-soft)]">
          <p className="sheet hand rotate-[-2deg] px-8 py-5 text-[26px] text-[var(--accent)]">Drop the sheets here to inspect them</p>
        </div>
      )}
    </div>
  );
}

/** The desk lamp: light, dark, or whatever the system says. */
function Lamp() {
  const [t, setT] = useState(() => {
    try {
      return localStorage.getItem("redline-theme") ?? "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("redline-theme", t);
    } catch {
      /* ignore */
    }
  }, [t]);
  return (
    <button className="ml-1 grid h-9 w-9 place-items-center rounded-full text-muted hover:text-ink" onClick={() => setT(t === "system" ? "dark" : t === "dark" ? "light" : "system")} title={`Lamp: ${t}`} aria-label={`Theme: ${t}. Change theme`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 21h8M10 21v-6l-4-5 5-6 5 4-3 3M14 11l4 4" />
        {t !== "dark" && <path d="M19 17.5l1.5 1M17 19.5l.5 1.6M20 15l1.6.2" />}
      </svg>
    </button>
  );
}
