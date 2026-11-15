import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { audit, detect, diffLines, fix, KIND_NAME, RULE, unifiedDiff, type FileReport, type Finding, type Kind } from "@redline/core";
import { PenCircle, Tick } from "../ink";
import { addFile, download, findFile, isPencil, removeFile, SAMPLE_FILES, useOwnFiles, type DeskFile } from "../lib";

const LH = 24;
const barAt = (i: number) => i % 6 < 3;
const KINDS = Object.keys(KIND_NAME) as Kind[];

function useReport(f: DeskFile | undefined) {
  return useMemo(() => (f ? audit(f.name, f.text, f.kind) : null), [f]);
}

/* ───────────── The tray of files on the left */

function GradeMark({ r }: { r: FileReport | null }) {
  if (!r?.kind) return <span className="hand w-6 text-center text-lg text-faint">?</span>;
  const tone = r.grade === "A" || r.grade === "B" ? "var(--ink-blue)" : r.grade === "C" ? "var(--pencil)" : "var(--pen)";
  return (
    <span className="hand relative grid h-7 w-8 place-items-center text-[22px] font-bold leading-none" style={{ color: tone }}>
      {r.grade}
      <PenCircle className="-inset-x-1 -inset-y-0.5 h-[calc(100%+4px)] w-[calc(100%+8px)]" color={tone} animate={false} />
    </span>
  );
}

function TrayItem({ f, active, onPick }: { f: DeskFile; active: boolean; onPick: () => void }) {
  const r = useReport(f);
  return (
    <li className="w-60 shrink-0 lg:w-auto">
      <button onClick={onPick} aria-current={active ? "true" : undefined} className={`group flex w-full items-center gap-3 rounded-[3px] px-2.5 py-2 text-left ${active ? "bg-paper text-paper-ink shadow-[var(--shadow)]" : "hover:bg-desk-2"}`}>
        <GradeMark r={r} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-type text-[14px]">{f.name}</span>
          <span className={`block truncate text-[12.5px] ${active ? "text-paper-faint" : "text-faint"}`}>
            {r?.kind ? `${KIND_NAME[r.kind]}, ${r.findings.length ? `${r.findings.length} marked` : "nothing marked"}` : "Not a file Redline reads"}
          </span>
        </span>
      </button>
    </li>
  );
}

function Tray({ activeId, onPick, onAdd }: { activeId?: string; onPick: (id: string) => void; onAdd: () => void }) {
  const own = useOwnFiles();
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <h2 className="text-[13px] font-semibold text-muted">Example: a small online shop</h2>
      <ul className="mt-2 flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
        {SAMPLE_FILES.map((f) => (
          <TrayItem key={f.id} f={f} active={f.id === activeId} onPick={() => onPick(f.id)} />
        ))}
      </ul>
      <h2 className="mt-6 text-[13px] font-semibold text-muted">Your files</h2>
      {own.length ? (
        <ul className="mt-2 flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
          {own.map((f) => (
            <TrayItem key={f.id} f={f} active={f.id === activeId} onPick={() => onPick(f.id)} />
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[13px] leading-snug text-faint">Paste a file or drop one anywhere on the desk. It stays in this browser and is never uploaded.</p>
      )}
      <button className="desk-btn mt-3 w-full justify-center sm:w-auto lg:w-full" onClick={onAdd}>
        Add a file
      </button>
    </aside>
  );
}

/* ───────────── The hanging tag */

function InspectionTag({ r }: { r: FileReport }) {
  const n = (s: Finding["severity"]) => r.findings.filter((f) => f.severity === s).length;
  const counts = (["critical", "high", "medium", "low"] as const).filter((s) => n(s)).map((s) => `${n(s)} ${s}`);
  const tone = r.grade === "A" || r.grade === "B" ? "var(--ink-blue)" : "var(--pen)";
  return (
    <div className="pointer-events-none absolute -top-3 right-3 z-10 w-[176px] origin-top-left rotate-[3deg] sm:right-10 sm:w-[200px]" aria-label={`Grade ${r.grade}, score ${r.score} out of 100`}>
      {/* the string */}
      <svg className="absolute -left-6 -top-3 h-12 w-12" viewBox="0 0 48 48" aria-hidden>
        <path d="M4 4c10 2 16 14 18 34" fill="none" stroke="#8a7a5a" strokeWidth={1.6} />
      </svg>
      <div className="tag py-3 pl-10 pr-4">
        <div className="text-[12px] leading-tight opacity-80">Inspected by Redline</div>
        <div className="mt-1 flex items-end gap-3">
          <span className="hand relative inline-grid h-14 w-14 place-items-center text-[46px] font-bold leading-none" style={{ color: tone }}>
            {r.grade}
            <PenCircle className="-inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)]" color={tone} />
          </span>
          <span className="pb-1 text-[13px] leading-tight">
            <span className="block font-semibold">{r.score} of 100</span>
            <span className="block opacity-80">{r.findings.length ? `${r.findings.length} marked` : "Passed"}</span>
          </span>
        </div>
        {counts.length > 0 && <div className="mt-2 text-[12px] leading-snug">{counts.join(", ")}</div>}
      </div>
    </div>
  );
}

/* ───────────── Margin notes */

function NoteBody({ f, n, open, accepted, onToggleFix }: { f: Finding; n: number; open: boolean; accepted: boolean; onToggleFix: () => void }) {
  const rule = RULE[f.rule];
  const pencil = isPencil(f.severity);
  return (
    <div>
      <div className="hand text-[21px] font-semibold leading-[1.05]" style={{ color: pencil ? "var(--pencil)" : "var(--pen)" }}>
        <span className="mr-1.5">{n}.</span>
        {rule.title}
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-[13.5px] leading-snug text-paper-ink">
          <p className="font-medium">
            <Code text={f.message} />
          </p>
          <p>
            <Code text={rule.why} />
          </p>
          <p>
            <span className="font-semibold">Fix: </span>
            <Code text={rule.fix} />
          </p>
          <p className="text-[12.5px] text-paper-faint">
            {rule.refs.map((x, i) => (
              <span key={x.url}>
                {i > 0 && ", "}
                <a href={x.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-paper-ink" onClick={(e) => e.stopPropagation()}>
                  {x.label}
                </a>
              </span>
            ))}
          </p>
        </div>
      )}
      <div className="mt-0.5 flex items-center gap-3">
        <span className="font-type text-[11.5px] text-paper-faint">
          {f.rule}, {f.severity}
        </span>
        {f.edits?.length ? (
          <label className="inline-flex cursor-pointer items-center gap-1 text-blue" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" className="sr-only" checked={accepted} onChange={onToggleFix} />
            <Tick on={accepted} />
            <span className="hand text-[17px] leading-none">{accepted ? "fix this" : "leave it"}</span>
          </label>
        ) : (
          <span className="text-[12px] italic text-paper-faint">needs a person</span>
        )}
      </div>
    </div>
  );
}

/** Inline code spans from backticks, in the typewriter face. */
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

/* ───────────── The marked-up printout */

function MarkedUp({ file, r, accepted, toggle }: { file: DeskFile; r: FileReport; accepted: Set<string>; toggle: (rule: string) => void }) {
  const lines = file.text.replace(/\r?\n$/, "").split(/\r?\n/);
  const [open, setOpen] = useState<number | null>(null);
  const noteRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [tops, setTops] = useState<number[]>([]);
  const byLine = new Map<number, Finding[]>();
  r.findings.forEach((f) => {
    for (let l = f.line; l <= (f.endLine ?? f.line); l++) byLine.set(l, [...(byLine.get(l) ?? []), f]);
  });

  // Stack notes down the margin: each starts at its line, or just below the previous note.
  useLayoutEffect(() => {
    let bottom = 0;
    const t = r.findings.map((f, i) => {
      const want = (f.line - 1) * LH;
      const top = Math.max(want, bottom);
      bottom = top + (noteRefs.current[i]?.offsetHeight ?? 60) + 10;
      return top;
    });
    setTops(t);
  }, [r, open, accepted]);

  const notesBottom = tops.length ? tops[tops.length - 1] + (noteRefs.current[tops.length - 1]?.offsetHeight ?? 60) + 24 : 0;
  const height = Math.max(lines.length * LH + 24, notesBottom);

  return (
    <>
    <div className="relative grid grid-cols-[2.6rem_minmax(0,1fr)] lg:grid-cols-[2.6rem_minmax(0,1fr)_2.25rem_18rem]" style={{ minHeight: height }}>
      <div className="typed select-none pt-0 text-right text-[12px] text-paper-faint" aria-hidden>
        {lines.map((_, i) => {
          const fs = byLine.get(i + 1);
          const strong = fs?.some((f) => f.line === i + 1 && !isPencil(f.severity));
          return (
            <div key={i} className={`relative pr-2 ${barAt(i) ? "bg-[var(--paper-bar)]" : ""}`}>
              {i + 1}
              {strong && <PenCircle className="right-0 top-0.5 h-5 w-8" />}
            </div>
          );
        })}
        {height > lines.length * LH && <div className="bars" style={{ height: height - lines.length * LH, ["--bar-offset" as string]: `${-(lines.length % 6) * LH}px` }} />}
      </div>
      <div className="overflow-x-auto">
        <div className="typed min-w-max">
          {lines.map((l, i) => {
            const fs = byLine.get(i + 1);
            const pencilOnly = fs?.every((f) => isPencil(f.severity));
            return (
              <div key={i} className={`pl-2 pr-6 ${barAt(i) ? "bg-[var(--paper-bar)]" : ""}`}>
                {fs ? <span className={pencilOnly ? "wavy-pencil" : "wavy-pen"}>{l || " "}</span> : l || " "}
                {/* On small screens the note numbers follow the line; the notes are listed below. */}
                {fs?.some((f) => f.line === i + 1) && (
                  <span className="hand ml-3 text-[16px] font-bold lg:hidden" style={{ color: pencilOnly ? "var(--pencil)" : "var(--pen)" }}>
                    {fs.filter((f) => f.line === i + 1).map((f) => r.findings.indexOf(f) + 1).join(",")}
                  </span>
                )}
              </div>
            );
          })}
          {height > lines.length * LH && <div className="bars" style={{ height: height - lines.length * LH, ["--bar-offset" as string]: `${-(lines.length % 6) * LH}px` }} />}
        </div>
      </div>
      {/* The note numbers, written beside the line they belong to. */}
      <div className="relative hidden lg:block" aria-hidden>
        {[...byLine.entries()]
          .filter(([l]) => r.findings.some((f) => f.line === l))
          .map(([l]) => {
            const fs = r.findings.filter((f) => f.line === l);
            return (
              <span key={l} className="hand absolute left-0 text-[17px] font-bold leading-[24px]" style={{ top: (l - 1) * LH, color: fs.every((f) => isPencil(f.severity)) ? "var(--pencil)" : "var(--pen)" }}>
                {fs.map((f) => r.findings.indexOf(f) + 1).join(",")}
              </span>
            );
          })}
      </div>
      <div className="relative hidden lg:block">
        {r.findings.map((f, i) => (
          <div
            key={i}
            ref={(el) => {
              noteRefs.current[i] = el;
            }}
            className={`absolute left-0 right-1 cursor-pointer rounded-[3px] px-2 py-1 ${open === i ? "bg-white/70 shadow-[var(--shadow)]" : "hover:bg-white/40"}`}
            style={{ top: tops[i] ?? (f.line - 1) * LH }}
            onClick={() => setOpen(open === i ? null : i)}
            role="button"
            tabIndex={0}
            aria-expanded={open === i}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(open === i ? null : i))}
          >
            <NoteBody f={f} n={i + 1} open={open === i} accepted={accepted.has(f.rule)} onToggleFix={() => toggle(f.rule)} />
          </div>
        ))}
      </div>
    </div>
    {r.findings.length > 0 && (
      <ol className="mt-6 space-y-4 border-t border-dashed border-[var(--paper-faint)] px-1 pt-5 lg:hidden">
        {r.findings.map((f, i) => (
          <li key={i}>
            <NoteBody f={f} n={i + 1} open accepted={accepted.has(f.rule)} onToggleFix={() => toggle(f.rule)} />
          </li>
        ))}
      </ol>
    )}
    </>
  );
}

/* ───────────── The corrected copy */

function Corrected({ before, after }: { before: string; after: string }) {
  const d = diffLines(before, after);
  return (
    <div className="grid grid-cols-[2.6rem_minmax(0,1fr)]">
      <div className="typed select-none text-right text-[12px] text-paper-faint" aria-hidden>
        {d.map((l, i) => (
          <div key={i} className={`pr-2 ${barAt(i) ? "bg-[var(--paper-bar)]" : ""}`}>
            {l.kind === "add" ? <span className="hand text-[18px] font-bold text-blue">+</span> : l.kind === "del" ? <span className="hand text-[18px] font-bold text-pen">−</span> : l.b}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="typed min-w-max">
          {d.map((l, i) => (
            <div key={i} className={`pl-2 pr-6 ${l.kind === "add" ? "ins" : barAt(i) ? "bg-[var(--paper-bar)]" : ""}`}>
              {l.kind === "del" ? <span className="del">{l.text || " "}</span> : l.text || " "}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Adding your own file */

function BlankSheet({ onDone, onCancel }: { onDone: (f: DeskFile) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const guess = text.trim() ? detect(name || "file", text) : null;
  const ok = text.trim() && (kind || guess);
  return (
    <form
      className="printout py-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const k = kind || guess;
        const fallback = k === "dockerfile" ? "Dockerfile" : k === "nginx" ? "nginx.conf" : k === "sshd" ? "sshd_config" : k === "compose" ? "compose.yaml" : "manifest.yaml";
        onDone(addFile(name.trim() || fallback, text, kind || undefined));
      }}
    >
      <div className="px-4">
        <h2 className="hand text-[30px] font-semibold leading-none text-blue">A fresh sheet</h2>
        <p className="mt-2 max-w-xl text-sm text-paper-faint">Paste a Dockerfile, a compose file, Kubernetes YAML, an nginx config or an sshd_config. It's checked in your browser and saved only here.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
          <label className="block text-sm font-semibold">
            File name
            <input className="field mt-1 font-type" placeholder="Dockerfile, nginx.conf, deploy.yaml…" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">
            Type
            <select className="field mt-1" value={kind} onChange={(e) => setKind(e.target.value as Kind | "")}>
              <option value="">{guess ? `Looks like ${KIND_NAME[guess]}` : "Work it out"}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_NAME[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm font-semibold">
          Contents
          <textarea className="field typed mt-1 h-[22rem] resize-y whitespace-pre" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={"FROM node:22-alpine\n…"} />
        </label>
        {text.trim() && !kind && !guess && <p className="mt-2 text-sm text-pen">Redline can't tell what this is. Give it a file name like nginx.conf, or pick the type.</p>}
        <div className="mt-4 flex gap-2">
          <button className="desk-btn primary" disabled={!ok}>
            Inspect it
          </button>
          <button type="button" className="desk-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

/* ───────────── The desk */

export function Desk() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  useOwnFiles();
  const adding = params.get("add") === "1";
  const file = findFile(params.get("file")) ?? (adding ? undefined : SAMPLE_FILES[0]);
  const r = useReport(file);
  const [view, setView] = useState<"marked" | "corrected">("marked");
  const [rejected, setRejected] = useState<Record<string, Set<string>>>({});
  const [dropping, setDropping] = useState(false);
  const [copied, setCopied] = useState(false);

  const fixable = useMemo(() => new Set(r?.findings.filter((f) => f.edits?.length).map((f) => f.rule)), [r]);
  const accepted = useMemo(() => new Set([...fixable].filter((x) => !rejected[file?.id ?? ""]?.has(x))), [fixable, rejected, file]);
  const corrected = useMemo(() => (file && r?.kind ? fix(file.name, file.text, accepted) : null), [file, r, accepted]);

  const pick = (id: string) => {
    setView("marked");
    setParams({ file: id });
  };
  const toggle = (rule: string) =>
    setRejected((m) => {
      const s = new Set(m[file!.id] ?? []);
      if (s.has(rule)) s.delete(rule);
      else s.add(rule);
      return { ...m, [file!.id]: s };
    });

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    let last: DeskFile | undefined;
    for (const f of [...e.dataTransfer.files].slice(0, 20)) {
      if (f.size > 1_000_000) continue;
      last = addFile(f.name, await f.text());
    }
    if (last) pick(last.id);
  };

  let sheet: ReactNode;
  if (adding || !file) sheet = <BlankSheet onDone={(f) => pick(f.id)} onCancel={() => navigate("/")} />;
  else if (!r?.kind)
    sheet = (
      <div className="printout px-14 py-10">
        <p className="hand text-[26px] text-pen">Not something Redline reads.</p>
        <p className="mt-2 max-w-lg text-sm text-paper-faint">Redline reads Dockerfiles, Docker Compose, Kubernetes YAML, nginx configs and sshd_config. Remove this file and add it again with the type picked.</p>
      </div>
    );
  else
    sheet = (
      <>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-type text-[1.35rem] font-bold">{file.name}</h1>
            <p className="text-sm text-muted">
              {KIND_NAME[r.kind]}
              {file.note ? `, ${file.note.toLowerCase()}` : ""}. {r.findings.length ? `${r.findings.length} problems marked, ${fixable.size ? `${r.findings.filter((f) => f.edits?.length).length} with a written fix` : "none with an automatic fix"}.` : "Nothing to mark."}
            </p>
          </div>
          <div className="flex rounded-[4px] border border-line p-0.5 text-sm" role="tablist" aria-label="View">
            {(
              [
                ["marked", "Marked up"],
                ["corrected", "Corrected copy"],
              ] as const
            ).map(([v, t]) => (
              <button key={v} role="tab" aria-selected={view === v} className={`rounded-[3px] px-3 py-1 font-semibold ${view === v ? "bg-paper text-paper-ink shadow-[var(--shadow)]" : "text-muted hover:text-ink"}`} onClick={() => setView(v)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="printout pb-6 pt-6">
          <InspectionTag r={view === "corrected" && corrected ? corrected.report : r} />
          <div className="typed mb-5 min-h-[7.5rem] px-2 text-[12.5px] leading-[20px] text-paper-faint sm:min-h-[6.75rem]">
            <div>{view === "marked" ? "Inspection of" : "Corrected copy of"} {file.name}</div>
            <div>{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
            <div>{file.text.replace(/\r?\n$/, "").split(/\r?\n/).length} lines, {KIND_NAME[r.kind]}</div>
            {view === "corrected" && corrected && (
              <div className="text-blue">
                {(() => {
                  const d = diffLines(file.text, corrected.text);
                  const add = d.filter((l) => l.kind === "add").length;
                  const del = d.filter((l) => l.kind === "del").length;
                  return add + del ? `${add} line${add === 1 ? "" : "s"} written in, ${del} taken out` : "No changes";
                })()}
              </div>
            )}
          </div>
          {r.errors.length > 0 && (
            <div className="mx-2 mb-3 rounded-[3px] border border-pen/40 bg-[var(--pen-soft)] px-3 py-2 text-sm text-pen">
              Couldn't read all of this file: {r.errors.join(" ")}
            </div>
          )}
          {view === "marked" ? <MarkedUp key={file.id} file={file} r={r} accepted={accepted} toggle={toggle} /> : <Corrected before={file.text} after={corrected!.text} />}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {view === "marked" ? (
            <button className="desk-btn primary" onClick={() => setView("corrected")} disabled={!accepted.size}>
              {accepted.size ? `See the corrected copy` : "Nothing selected to fix"}
            </button>
          ) : (
            <>
              <button className="desk-btn primary" onClick={() => download(file.name, corrected!.text)}>
                Download the fixed file
              </button>
              <button
                className="desk-btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(unifiedDiff(file.name, file.text, corrected!.text));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    /* clipboard blocked */
                  }
                }}
              >
                {copied ? "Patch copied" : "Copy as a patch"}
              </button>
              <button className="desk-btn" onClick={() => setView("marked")}>
                Back to the marked-up copy
              </button>
            </>
          )}
          {file.own && (
            <button
              className="ml-auto text-sm text-muted underline underline-offset-4 hover:text-ink"
              onClick={() => {
                removeFile(file.id);
                setParams({});
              }}
            >
              Remove from the desk
            </button>
          )}
        </div>
        {view === "corrected" && corrected && (
          <p className="mt-3 max-w-2xl text-sm text-muted">
            Blue lines are written in, struck lines are taken out. {corrected.report.findings.length ? `${corrected.report.findings.length} problem${corrected.report.findings.length === 1 ? "" : "s"} still need a person: the fix depends on things only you know, like which version to pin.` : "Nothing left to fix."} Fixes that change behaviour (a read-only filesystem, a non-root user) are worth a test run before you ship.
          </p>
        )}
      </>
    );

  return (
    <div
      className="relative grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={onDrop}
    >
      <Tray activeId={file?.id} onPick={pick} onAdd={() => setParams({ add: "1" })} />
      <section className="min-w-0">{sheet}</section>
      {dropping && (
        <div className="pointer-events-none absolute -inset-3 grid place-items-center rounded-md border-2 border-dashed border-blue bg-[var(--ink-blue-soft)]">
          <p className="hand text-3xl text-blue">Drop files to inspect them</p>
        </div>
      )}
    </div>
  );
}
