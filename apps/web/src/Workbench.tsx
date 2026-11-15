import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { audit, detect, diffLines, fix, KIND_NAME, RULE, SEVERITY_RANK, unifiedDiff, type FileReport, type Finding, type Kind } from "@redline/core";
import { highlight, TOK_COLOR } from "./highlight";
import { addFile, download, findFile, removeFile, resetSample, saveText, SEV_CLASS, SEV_COLOR, useFiles, type DeskFile } from "./lib";
import { Bench } from "./pages/Bench";
import { Rulebook } from "./pages/Rulebook";
import { UseIt } from "./pages/UseIt";

const LH = 22;
const VIEWS = { "/rules": "Rulebook", "/bench": "Test bench", "/use": "Use it" } as const;
type ViewPath = keyof typeof VIEWS;

function Code({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="rounded bg-panel-2 px-1 font-mono text-[0.92em]">
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

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const I = {
  files: "M4 4h6l2 2h8v13H4zM4 9h16",
  rules: "M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h4",
  bench: "M9 3v6L4 19h16L15 9V3M8 3h8",
  use: "M8 6 3 12l5 6M16 6l5 6-5 6",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.2h5.2c0-.9.4-1.7 1-2.2A6 6 0 0 0 12 3z",
  theme: "M12 3a9 9 0 1 0 9 9A7 7 0 0 1 12 3z",
};

/* ───────────── Editor */

type QuickFix = { line: number; findings: Finding[]; top: number };

function CodeEditor({
  file,
  report,
  text,
  onChange,
  jump,
  onCursor,
  onApply,
}: {
  file: DeskFile;
  report: FileReport;
  text: string;
  onChange: (t: string) => void;
  jump: { line: number; n: number } | null;
  onCursor: (line: number, col: number) => void;
  onApply: (rules: string[], label: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [quick, setQuick] = useState<QuickFix | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const lines = text.split("\n");
  const byLine = useMemo(() => {
    const m = new Map<number, Finding[]>();
    for (const f of report.findings) for (let l = f.line; l <= (f.endLine ?? f.line); l++) m.set(l, [...(m.get(l) ?? []), f]);
    for (const v of m.values()) v.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    return m;
  }, [report]);

  // Jump to a line from the problems list: scroll it into view and put the cursor there.
  useEffect(() => {
    if (!jump || !area.current || !scroller.current) return;
    const el = area.current;
    const start = lines.slice(0, jump.line - 1).reduce((n, l) => n + l.length + 1, 0);
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, start + (lines[jump.line - 1]?.length ?? 0));
    scroller.current.scrollTo({ top: Math.max(0, (jump.line - 6) * LH), behavior: "smooth" });
    onCursor(jump.line, 1);
  }, [jump]);

  // Escape or a click elsewhere closes the quick-fix menu.
  useEffect(() => {
    if (!quick) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setQuick(null);
    const down = (e: MouseEvent) => !(e.target as HTMLElement).closest("[data-quick]") && setQuick(null);
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down);
    };
  }, [quick]);

  const cursor = () => {
    const el = area.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const line = before.split("\n").length;
    onCursor(line, before.length - before.lastIndexOf("\n"));
  };

  return (
    <div ref={scroller} className="scroll-y relative h-full overflow-x-auto bg-editor" onScroll={(e) => quick && Math.abs(e.currentTarget.scrollTop - quick.top) > LH * 3 && setQuick(null)}>
      <div className="relative flex min-h-full w-max min-w-full">
        {/* Gutter: line numbers, a dot per problem, a lightbulb when there's a fix. */}
        <div className="code sticky left-0 z-10 select-none bg-editor pb-24 pl-2 pt-2 text-right text-faint">
          {lines.map((_, i) => {
            const fs = byLine.get(i + 1)?.filter((f) => f.line === i + 1);
            const fixable = fs?.filter((f) => f.edits?.length);
            return (
              <div key={i} className="flex h-[22px] items-center justify-end gap-1">
                {fixable?.length ? (
                  <button
                    data-quick
                    className="pointer-events-auto grid h-[18px] w-[18px] place-items-center rounded text-med hover:bg-panel-2"
                    onClick={() => setQuick(quick?.line === i + 1 ? null : { line: i + 1, findings: fs!, top: scroller.current?.scrollTop ?? 0 })}
                    aria-label={`Quick fixes for line ${i + 1}`}
                    title="Quick fix"
                  >
                    <Icon d={I.bulb} className="h-[14px] w-[14px]" />
                  </button>
                ) : (
                  <span aria-hidden className="w-[18px]" />
                )}
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: fs?.length ? SEV_COLOR[fs[0].severity] : "transparent" }} />
                <span aria-hidden className={`w-8 pr-3 ${hover === i + 1 ? "text-ink" : ""}`}>{i + 1}</span>
              </div>
            );
          })}
        </div>

        {/* Text: a highlighted copy underneath, the real textarea on top, kept in step. */}
        <div className="relative min-w-0 flex-1">
          <div className="code pointer-events-none pb-24 pl-1 pt-2" aria-hidden>
            {lines.map((l, i) => {
              const fs = byLine.get(i + 1);
              const first = fs?.find((f) => f.line === i + 1);
              const toks = highlight(l, report.kind);
              return (
                <div key={i} className={`h-[22px] pr-10 ${fs ? "bg-[var(--sel)]" : ""}`}>
                  <span className={fs ? SEV_CLASS[fs[0].severity] : undefined}>
                    {toks.map((t, k) => (
                      <span key={k} style={t.c ? { color: TOK_COLOR[t.c] } : undefined}>
                        {t.t}
                      </span>
                    ))}
                    {!l && " "}
                  </span>
                  {first && (
                    <span className="ml-6 font-sans text-[12px] italic" style={{ color: SEV_COLOR[first.severity], opacity: 0.85 }}>
                      {plain(first.message)}
                      {(fs!.filter((f) => f.line === i + 1).length ?? 1) > 1 ? `  (+${fs!.filter((f) => f.line === i + 1).length - 1} more)` : ""}
                    </span>
                  )}
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
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover(Math.floor((e.clientY - r.top - 8) / LH) + 1);
            }}
            onMouseLeave={() => setHover(null)}
            onKeyDown={(e) => {
              // Tab inserts two spaces instead of leaving the editor.
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                const el = e.currentTarget;
                const s = el.selectionStart;
                const next = `${el.value.slice(0, s)}  ${el.value.slice(el.selectionEnd)}`;
                onChange(next);
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            wrap="off"
            aria-label={`Contents of ${file.name}`}
            className="code absolute inset-0 resize-none overflow-hidden bg-transparent pb-24 pl-1 pr-10 pt-2 text-transparent caret-[var(--ink)] outline-none selection:bg-[var(--accent-soft)] selection:text-transparent"
          />
          {/* What's wrong on the line under the pointer. */}
          {hover && byLine.get(hover) && !quick && (
            <div className="pop pointer-events-none absolute left-10 z-20 w-[min(30rem,80vw)] rounded-[10px] border border-line bg-panel p-3 font-sans shadow-[var(--shadow)]" style={{ top: 8 + hover * LH + 4 }}>
              {byLine.get(hover)!.map((f, k) => (
                <div key={k} className={k ? "mt-2 border-t border-line pt-2" : ""}>
                  <div className="text-[13px] font-semibold" style={{ color: SEV_COLOR[f.severity] }}>
                    {RULE[f.rule].title} <span className="font-mono text-[11px] font-normal text-faint">{f.rule}, {f.severity}</span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
                    <Code text={RULE[f.rule].why} />
                  </p>
                </div>
              ))}
            </div>
          )}
          {quick && (
            <div className="pop absolute left-1 z-30 w-[min(24rem,80vw)] rounded-[10px] border border-line bg-panel p-1.5 font-sans shadow-[var(--shadow)]" style={{ top: 8 + quick.line * LH + 2 }} role="menu" aria-label="Quick fixes" data-quick>
              {quick.findings.map((f) => {
                const n = report.findings.filter((x) => x.rule === f.rule && x.edits?.length).length;
                return (
                  <button
                    key={f.rule + f.message}
                    role="menuitem"
                    disabled={!f.edits?.length}
                    className="flex w-full items-start gap-2 rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-panel-2 disabled:opacity-50"
                    onClick={() => {
                      setQuick(null);
                      onApply([f.rule], RULE[f.rule].title);
                    }}
                  >
                    <Icon d={I.bulb} className="mt-0.5 h-4 w-4 shrink-0 text-med" />
                    <span>
                      <span className="font-medium">{f.edits?.length ? `Fix: ${RULE[f.rule].title}` : RULE[f.rule].title}</span>
                      <span className="block text-[12px] text-muted">{f.edits?.length ? (n > 1 ? `Fixes all ${n} in this file` : "Edits this file; you can undo") : "Needs a person: see the problem for what to do"}</span>
                    </span>
                  </button>
                );
              })}
              {report.findings.some((f) => f.edits?.length) && (
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-[7px] border-t border-line px-2.5 py-2 text-left text-[13px] font-medium hover:bg-panel-2"
                  onClick={() => {
                    setQuick(null);
                    onApply([...new Set(report.findings.filter((f) => f.edits?.length).map((f) => f.rule))], "every problem with a fix");
                  }}
                >
                  Fix everything that can be fixed <span className="kbd ml-auto">Ctrl .</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Bottom panel */

function Problems({ files, activeId, onJump, scope, setScope }: { files: { f: DeskFile; r: FileReport }[]; activeId?: string; onJump: (id: string, line: number) => void; scope: "file" | "all"; setScope: (s: "file" | "all") => void }) {
  const list = (scope === "file" ? files.filter((x) => x.f.id === activeId) : files).flatMap((x) => x.r.findings.map((f) => ({ ...f, file: x.f })));
  list.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.file.name.localeCompare(b.file.name) || a.line - b.line);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex gap-0.5 rounded-[7px] bg-panel-2 p-0.5 text-[12px]">
          {(
            [
              ["file", "This file"],
              ["all", "Whole project"],
            ] as const
          ).map(([k, t]) => (
            <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k} className={`rounded-[5px] px-2 py-0.5 font-medium ${scope === k ? "bg-editor shadow-[var(--shadow)]" : "text-muted"}`}>
              {t}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-muted">{list.length ? `${list.length} problem${list.length === 1 ? "" : "s"}` : "No problems"}</span>
      </div>
      <ul className="pb-2">
        {list.map((p, i) => {
          const key = `${p.file.id}:${p.line}:${p.rule}:${i}`;
          const rule = RULE[p.rule];
          return (
            <li key={key}>
              <button
                className={`flex w-full flex-wrap items-start gap-x-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-panel-2 ${open === key ? "bg-panel-2" : ""}`}
                onClick={() => {
                  setOpen(open === key ? null : key);
                  onJump(p.file.id, p.line);
                }}
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_COLOR[p.severity] }} aria-label={p.severity} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{rule.title}</span> <span className="text-muted">{plain(p.message)}</span>
                  {open === key && (
                    <span className="mt-1.5 block space-y-1.5 text-[12.5px] leading-relaxed text-muted">
                      <span className="block">
                        <Code text={rule.why} />
                      </span>
                      <span className="block">
                        <span className="font-semibold text-ink">Fix: </span>
                        <Code text={rule.fix} />
                      </span>
                      <span className="block">
                        {rule.refs.map((x, k) => (
                          <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink" onClick={(e) => e.stopPropagation()}>
                            {k ? ", " : ""}
                            {x.label}
                          </a>
                        ))}
                      </span>
                    </span>
                  )}
                </span>
                <span className="w-full shrink-0 pl-[1.125rem] font-mono text-[11.5px] text-faint sm:w-auto sm:pl-0">
                  {p.rule} {p.file.name.split("/").pop()}:{p.line}
                  {p.edits?.length ? <span className="ml-1.5 text-ok">fixable</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FixPreview({ file, report, text, onApplied }: { file: DeskFile; report: FileReport; text: string; onApplied: (next: string, label: string) => void }) {
  const rules = [...new Set(report.findings.filter((f) => f.edits?.length).map((f) => f.rule))];
  const [off, setOff] = useState<Set<string>>(new Set());
  const on = new Set(rules.filter((r) => !off.has(r)));
  const result = useMemo(() => fix(file.name, text, on), [file.name, text, [...on].join()]);
  const d = useMemo(() => diffLines(text, result.text), [text, result.text]);
  const [copied, setCopied] = useState(false);
  if (!rules.length) return <p className="px-3 py-3 text-[13px] text-muted">Nothing in this file can be fixed automatically. {report.findings.length ? "The remaining problems need a person; open them in Problems to see what to do." : ""}</p>;
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <div className="text-[12px] font-semibold text-muted">Fixes to apply</div>
        <ul className="mt-1.5 space-y-1">
          {rules.map((r) => (
            <li key={r}>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
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
                  {RULE[r].title} <span className="font-mono text-[11px] text-faint">{r}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-1.5">
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
        <p className="mt-2 text-[12px] text-muted">
          Grade {report.grade} becomes {result.report.grade}. {result.report.findings.length ? `${result.report.findings.length} left for a person.` : "Nothing left."}
        </p>
      </div>
      <div className="code overflow-x-auto rounded-[8px] border border-line bg-editor py-1.5 text-[12.5px]">
        {d.map((l, i) => (
          <div key={i} className="flex" style={{ background: l.kind === "add" ? "var(--add)" : l.kind === "del" ? "var(--del)" : undefined }}>
            <span className="w-8 shrink-0 select-none pr-2 text-right text-faint">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : l.b}</span>
            <span className={l.kind === "add" ? "text-[var(--add-ink)]" : l.kind === "del" ? "text-crit line-through decoration-1" : ""}>{l.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── The workbench */

const sessionTabs = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem("redline-tabs") ?? "null") ?? [];
  } catch {
    return [];
  }
};

export function Workbench() {
  const files = useFiles();
  const [params] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const view = (loc.pathname in VIEWS ? loc.pathname : null) as ViewPath | null;
  const activeId = view ? null : (params.get("file") ?? files[0]?.id);
  const active = findFile(activeId ?? null);

  const [tabs, setTabs] = useState<string[]>(() => {
    const t = sessionTabs();
    return t.length ? t : [files[0]?.id].filter(Boolean) as string[];
  });
  const [panel, setPanel] = useState<"problems" | "fixes" | null>("problems");
  const [scope, setScope] = useState<"file" | "all">("file");
  const [side, setSide] = useState(true);
  const [mobileFiles, setMobileFiles] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [jump, setJump] = useState<{ line: number; n: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: { id: string; text: string } } | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const upload = useRef<HTMLInputElement>(null);

  const tabKey = view ?? activeId ?? "";
  useEffect(() => {
    if (!tabKey) return;
    setTabs((t) => (t.includes(tabKey) ? t : [...t, tabKey]));
  }, [tabKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem("redline-tabs", JSON.stringify(tabs));
    } catch {
      /* ignore */
    }
  }, [tabs]);

  const reports = useMemo(() => files.map((f) => ({ f, r: audit(f.name, f.text, f.kind) })), [files]);
  const report = active ? (reports.find((x) => x.f.id === active.id)?.r ?? null) : null;

  const open = (id: string) => {
    if (id.startsWith("/")) navigate(id);
    else navigate(`/?file=${encodeURIComponent(id)}`);
    setMobileFiles(false);
  };
  const close = (key: string) => {
    const i = tabs.indexOf(key);
    const next = tabs.filter((t) => t !== key);
    setTabs(next);
    if (key === tabKey) {
      const to = next[Math.min(i, next.length - 1)];
      if (to) open(to);
      else navigate("/rules");
    }
  };
  const jumpTo = (id: string, line: number) => {
    if (id !== activeId) open(id);
    setTimeout(() => setJump({ line, n: Date.now() }), 30);
  };

  const apply = useCallback(
    (rules: string[], label: string) => {
      if (!active) return;
      const before = active.text;
      const r = fix(active.name, before, new Set(rules));
      if (r.text === before) return;
      saveText(active.id, r.text);
      const fixed = report ? report.findings.length - r.report.findings.length : 0;
      setToast({ text: `Fixed ${label}${fixed > 0 ? `: ${fixed} problem${fixed === 1 ? "" : "s"} gone` : ""}.`, undo: { id: active.id, text: before } });
    },
    [active, report],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ".") {
        e.preventDefault();
        if (report) apply([...new Set(report.findings.filter((f) => f.edits?.length).map((f) => f.rule))], "every problem with a fix");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPanel((p) => (p ? null : "problems"));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSide((s) => !s);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [apply, report]);

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDropping(false);
    let last: DeskFile | undefined;
    for (const f of [...e.dataTransfer.files].slice(0, 20)) if (f.size < 1_000_000) last = addFile(f.name, await f.text());
    if (last) open(last.id);
  }

  const counts = (r: FileReport | null) => (r ? (["critical", "high", "medium", "low"] as const).map((s) => r.findings.filter((f) => f.severity === s).length) : [0, 0, 0, 0]);
  const [crit, high, med, low] = counts(report);
  const total = reports.reduce((n, x) => n + x.r.findings.length, 0);

  // Explorer tree: folders from the paths.
  const groups = useMemo(() => {
    const m = new Map<string, DeskFile[]>();
    for (const f of files) {
      const dir = f.own ? "Your files" : f.name.includes("/") ? `shop/${f.name.slice(0, f.name.lastIndexOf("/"))}` : "shop";
      m.set(dir, [...(m.get(dir) ?? []), f]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "Your files" ? 1 : b[0] === "Your files" ? -1 : a[0].localeCompare(b[0])));
  }, [files]);

  const explorer: ReactNode = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="text-[11.5px] font-semibold text-muted">Explorer</span>
        <span className="flex gap-0.5">
          <button className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-panel-2 hover:text-ink" onClick={() => setNewName("")} title="New file" aria-label="New file">
            <Icon d="M12 5v14M5 12h14" className="h-4 w-4" />
          </button>
          <button className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-panel-2 hover:text-ink" onClick={() => upload.current?.click()} title="Open files from your computer" aria-label="Open files from your computer">
            <Icon d="M12 16V4M7 9l5-5 5 5M4 20h16" className="h-4 w-4" />
          </button>
        </span>
        <input
          ref={upload}
          type="file"
          multiple
          className="hidden"
          onChange={async (e) => {
            let last: DeskFile | undefined;
            for (const f of [...(e.target.files ?? [])].slice(0, 20)) if (f.size < 1_000_000) last = addFile(f.name, await f.text());
            e.target.value = "";
            if (last) open(last.id);
          }}
        />
      </div>
      <div className="scroll-y min-h-0 flex-1 pb-3">
        {groups.map(([dir, list]) => (
          <div key={dir} className="mt-1">
            <div className="flex items-center gap-1.5 px-3 py-0.5 text-[12.5px] text-muted">
              <Icon d="M3 7h6l2 2h10v10H3z" className="h-3.5 w-3.5" />
              {dir}
            </div>
            {list.map((f) => {
              const r = reports.find((x) => x.f.id === f.id)!.r;
              const worst = r.findings.reduce<Finding["severity"] | null>((w, x) => (!w || SEVERITY_RANK[x.severity] > SEVERITY_RANK[w] ? x.severity : w), null);
              return (
                <div key={f.id} className={`group flex items-center gap-2 py-0.5 pl-7 pr-2 text-[13px] ${f.id === activeId ? "bg-[var(--accent-soft)] text-ink" : "text-ink hover:bg-panel-2"}`}>
                  <button className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left" onClick={() => open(f.id)} aria-current={f.id === activeId ? "page" : undefined}>
                    <span className="truncate">{f.name.split("/").pop()}</span>
                    {f.edited && <span className="h-1.5 w-1.5 rounded-full bg-muted" title="Edited" />}
                  </button>
                  {r.findings.length > 0 && (
                    <span className="font-mono text-[11px]" style={{ color: worst ? SEV_COLOR[worst] : undefined }}>
                      {r.findings.length}
                    </span>
                  )}
                  {f.own ? (
                    <button
                      className={`${f.id === activeId ? "block" : "hidden"} text-faint hover:text-crit group-hover:block`}
                      onClick={() => {
                        removeFile(f.id);
                        setTabs((t) => t.filter((x) => x !== f.id));
                        if (f.id === activeId) open(files[0].id);
                      }} aria-label={`Delete ${f.name}`} title="Delete">
                      ✕
                    </button>
                  ) : (
                    f.edited && (
                      <button className="hidden text-[11px] text-faint hover:text-ink group-hover:block" onClick={() => resetSample(f.id)} title="Undo your edits to this example">
                        reset
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {newName !== null && (
          <form
            className="mt-2 px-3"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              const f = addFile(name, "");
              setNewName(null);
              open(f.id);
            }}
          >
            <input autoFocus className="field h-7 text-[13px]" placeholder="Dockerfile, nginx.conf, deploy.yaml" value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => !newName.trim() && setNewName(null)} aria-label="New file name" />
          </form>
        )}
        <p className="mt-4 px-3 text-[11.5px] leading-snug text-faint">Drop files anywhere to check them. They stay in this browser.</p>
      </div>
    </div>
  );

  return (
    <div
      className="grid h-dvh grid-cols-1 grid-rows-[minmax(0,1fr)_auto]"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={onDrop}
    >
      <div className="flex min-h-0">
        {/* Activity bar */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2" aria-label="Views">
          <img src="/favicon.svg" alt="Redline" className="mb-2 h-7 w-7" />
          {(
            [
              [null, "Files", I.files],
              ["/rules", "Rulebook", I.rules],
              ["/bench", "Test bench", I.bench],
              ["/use", "Use it", I.use],
            ] as const
          ).map(([to, t, d]) => {
            const on = to ? view === to : !view && side;
            return (
              <button
                key={t}
                title={t}
                aria-label={t}
                aria-pressed={on}
                className={`relative grid h-10 w-10 place-items-center rounded-[8px] ${on ? "text-ink" : "text-faint hover:text-ink"}`}
                onClick={() => {
                  if (!to) {
                    if (view) open(tabs.find((x) => !x.startsWith("/")) ?? files[0].id);
                    else if (window.innerWidth < 768) setMobileFiles(!mobileFiles);
                    else setSide(!side);
                  } else open(to);
                }}
              >
                {on && <span className="absolute left-0 top-2 h-6 w-0.5 rounded-full bg-accent" />}
                <Icon d={d} className="h-5 w-5" />
              </button>
            );
          })}
          <span className="flex-1" />
          <ThemeButton />
        </nav>

        {/* Side panel */}
        {side && !view && <aside className="hidden w-60 shrink-0 border-r border-line bg-panel md:block">{explorer}</aside>}
        {mobileFiles && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setMobileFiles(false)} />
            <aside className="pop absolute inset-y-0 left-12 w-64 border-r border-line bg-panel shadow-[var(--shadow)]">{explorer}</aside>
          </div>
        )}

        {/* Editor area */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel" role="tablist" aria-label="Open files">
            {tabs.map((k) => {
              const f = k.startsWith("/") ? null : findFile(k);
              if (!k.startsWith("/") && !f) return null;
              const r = f ? reports.find((x) => x.f.id === f.id)?.r : null;
              const on = k === tabKey;
              return (
                <div key={k} className={`group flex shrink-0 items-center gap-2 border-r border-line pl-3 pr-1.5 text-[13px] ${on ? "bg-editor text-ink" : "text-muted hover:text-ink"}`}>
                  <button role="tab" aria-selected={on} onClick={() => open(k)} className="flex items-center gap-2 py-2">
                    {f ? f.name.split("/").pop() : VIEWS[k as ViewPath]}
                    {r && r.kind && (
                      <span className="rounded px-1 font-mono text-[10.5px] font-bold" style={{ color: r.grade <= "B" ? "var(--ok)" : r.grade === "C" ? "var(--med)" : "var(--crit)", background: "var(--panel-2)" }} title={`Grade ${r.grade}`}>
                        {r.grade}
                      </span>
                    )}
                  </button>
                  <button className={`grid h-5 w-5 place-items-center rounded text-faint hover:bg-panel-2 hover:text-ink ${on ? "" : "opacity-0 group-hover:opacity-100"}`} onClick={() => close(k)} aria-label={`Close ${f ? f.name : VIEWS[k as ViewPath]}`}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {view ? (
            <div className="scroll-y min-h-0 flex-1 bg-editor">
              <div className="doc">{view === "/rules" ? <Rulebook /> : view === "/bench" ? <Bench /> : <UseIt />}</div>
            </div>
          ) : active && report ? (
            <>
              <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-line bg-editor px-3 text-[12.5px] text-muted">
                <span>{active.own ? "Your files" : "shop"}</span>
                {active.name.split("/").map((p, i, a) => (
                  <span key={i} className={i === a.length - 1 ? "text-ink" : ""}>
                    <span className="mx-1 text-faint">/</span>
                    {p}
                  </span>
                ))}
                <span className="flex-1" />
                {!report.kind && (
                  <span className="text-med">
                    Not a file Redline reads. Type:{" "}
                    <select
                      className="ml-1 rounded border border-line bg-editor px-1"
                      value=""
                      onChange={(e) => {
                        const k = e.target.value as Kind;
                        removeFile(active.id);
                        open(addFile(active.name, active.text, k).id);
                      }}
                      aria-label="File type"
                    >
                      <option value="">pick one</option>
                      {(Object.keys(KIND_NAME) as Kind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_NAME[k]}
                        </option>
                      ))}
                    </select>
                  </span>
                )}
                {report.errors.length > 0 && <span className="text-crit">Can't read part of this file: {report.errors[0]}</span>}
              </div>
              <div className="min-h-0 flex-1">
                <CodeEditor key={active.id} file={active} report={report} text={active.text} onChange={(t) => saveText(active.id, t)} jump={jump} onCursor={(line, col) => setCursor({ line, col })} onApply={apply} />
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center bg-editor p-8 text-center text-muted">
              <div>
                <p className="text-[15px]">No file open.</p>
                <button className="btn mt-3" onClick={() => open(files[0].id)}>
                  Open the example Dockerfile
                </button>
              </div>
            </div>
          )}

          {/* Bottom panel */}
          {panel && !view && active && report && (
            <section className="flex h-[min(40vh,20rem)] shrink-0 flex-col border-t border-line bg-panel" aria-label="Panel">
              <div className="flex items-center gap-1 px-2 pt-1" role="tablist">
                {(
                  [
                    ["problems", `Problems ${report.findings.length}`],
                    ["fixes", "Fix preview"],
                  ] as const
                ).map(([k, t]) => (
                  <button key={k} role="tab" aria-selected={panel === k} onClick={() => setPanel(k)} className={`border-b-2 px-2.5 py-1.5 text-[12.5px] font-medium ${panel === k ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                    {t}
                  </button>
                ))}
                <span className="flex-1" />
                <button className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-panel-2 hover:text-ink" onClick={() => setPanel(null)} aria-label="Close the panel" title="Close (Ctrl J)">
                  ×
                </button>
              </div>
              <div className="scroll-y min-h-0 flex-1">{panel === "problems" ? <Problems files={reports} activeId={active.id} onJump={jumpTo} scope={scope} setScope={setScope} /> : <FixPreview key={active.id} file={active} report={report} text={active.text} onApplied={(next, label) => {
                const before = active.text;
                saveText(active.id, next);
                setToast({ text: `Applied ${label}.`, undo: { id: active.id, text: before } });
              }} />}</div>
            </section>
          )}
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex h-7 items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-line bg-panel px-3 text-[12px] text-muted">
        <span className="font-semibold text-ink">Redline</span>
        {report && active && !view ? (
          <>
            <button className="hover:text-ink" onClick={() => setPanel(panel ? null : "problems")} title="Problems (Ctrl J)">
              <span style={{ color: crit + high ? "var(--crit)" : undefined }}>● {crit + high}</span> <span style={{ color: med ? "var(--med)" : undefined }}>● {med}</span> <span style={{ color: low ? "var(--low)" : undefined }}>● {low}</span>
            </button>
            <span>
              Grade <span className="font-semibold text-ink">{report.kind ? report.grade : "–"}</span> ({report.score}/100)
            </span>
            {report.findings.some((f) => f.edits?.length) && (
              <button className="font-medium text-accent hover:underline" onClick={() => apply([...new Set(report.findings.filter((f) => f.edits?.length).map((f) => f.rule))], "every problem with a fix")}>
                Fix all (Ctrl .)
              </button>
            )}
            <span className="flex-1" />
            <span>
              Ln {cursor.line}, Col {cursor.col}
            </span>
            <span>{report.kind ? KIND_NAME[report.kind] : detect(active.name, active.text) ?? "Unknown"}</span>
          </>
        ) : (
          <>
            <span>{total} problems across {files.length} files</span>
            <span className="flex-1" />
          </>
        )}
        <a href="https://github.com/Vishwanathanirv/config-auditor" className="hover:text-ink">
          Source
        </a>
      </footer>

      {toast && (
        <div className="pop fixed bottom-10 right-4 z-50 flex items-center gap-3 rounded-[10px] border border-line bg-panel px-3.5 py-2.5 text-[13px] shadow-[var(--shadow)]" role="status">
          {toast.text}
          {toast.undo && (
            <button
              className="font-semibold text-accent hover:underline"
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
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[var(--accent-soft)]">
          <p className="rounded-[12px] border-2 border-dashed border-accent bg-panel px-6 py-4 text-[15px] font-semibold text-accent">Drop config files to check them</p>
        </div>
      )}
    </div>
  );
}

function ThemeButton() {
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
    <button className="grid h-10 w-10 place-items-center rounded-[8px] text-faint hover:text-ink" onClick={() => setT(t === "system" ? "dark" : t === "dark" ? "light" : "system")} title={`Theme: ${t}`} aria-label={`Theme: ${t}. Change theme`}>
      <Icon d={I.theme} className="h-5 w-5" />
    </button>
  );
}
