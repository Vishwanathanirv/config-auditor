import { useSyncExternalStore } from "react";
import { SAMPLES, type Kind, type Severity } from "@redline/core";
import { MAX_FILE, MAX_TOTAL, sanitizeEdits, sanitizeFiles, type WorkFile } from "./shape";

export type { WorkFile } from "./shape";
export { MAX_FILE } from "./shape";

function load(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const FILES = "redline-files-v1";
const EDITS = "redline-edits-v1";

/** Your own files, and your edits to the examples, live in this browser only. */
let own: WorkFile[] = sanitizeFiles(load(FILES));
let edits: Record<string, string> = sanitizeEdits(load(EDITS));
let version = 0;
let saveFailed = false;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

// Writes are batched: typing saves once it pauses, and anything pending is flushed when the
// page is hidden. A failed write (storage full or blocked) is reported, not swallowed.
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  let failed = false;
  for (const key of dirty) {
    try {
      localStorage.setItem(key, JSON.stringify(key === FILES ? own : edits));
    } catch {
      failed = true;
    }
  }
  dirty.clear();
  if (failed !== saveFailed) {
    saveFailed = failed;
    changed();
  }
}
function persist(key: string, now = false) {
  dirty.add(key);
  if (now) return flush();
  if (!timer) timer = setTimeout(flush, 400);
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

/** True when the last save to this browser failed, so changes would be lost on reload. */
export const lastSaveFailed = () => saveFailed;

const SAMPLE_BASE: WorkFile[] = SAMPLES.map((s) => ({ id: `sample:${s.name}`, name: s.name, text: s.text, own: false, note: s.note }));

/** Every file in the workspace: the example project (with your edits), then yours. */
export function allFiles(): WorkFile[] {
  return [...SAMPLE_BASE.map((f) => (edits[f.id] !== undefined ? { ...f, text: edits[f.id], edited: true } : f)), ...own];
}
export const useFiles = () => {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
  );
  return allFiles();
};
export const findFile = (id: string | null) => allFiles().find((f) => f.id === id);

const ownSize = (except?: string) => own.reduce((n, f) => (f.id === except ? n : n + f.text.length), 0);

/** Saves an edit. Returns false (and changes nothing) when the text is over the size limits. */
export function saveText(id: string, text: string): boolean {
  if (text.length > MAX_FILE) return false;
  if (id.startsWith("sample:")) {
    const base = SAMPLE_BASE.find((f) => f.id === id);
    if (base && base.text === text) {
      const { [id]: _drop, ...rest } = edits;
      void _drop;
      edits = rest;
    } else edits = { ...edits, [id]: text };
    persist(EDITS);
  } else {
    if (ownSize(id) + text.length > MAX_TOTAL) return false;
    own = own.map((f) => (f.id === id ? { ...f, text } : f));
    persist(FILES);
  }
  changed();
  return true;
}
export function resetSample(id: string) {
  const { [id]: _drop, ...rest } = edits;
  void _drop;
  edits = rest;
  persist(EDITS, true);
  changed();
}

/** Adds or replaces one of your files. Returns null when it would not fit. */
export function addFile(name: string, text: string, kind?: Kind): WorkFile | null {
  const existing = own.find((f) => f.name === name);
  if (text.length > MAX_FILE || ownSize(existing?.id) + text.length > MAX_TOTAL) return null;
  const f: WorkFile = { id: existing?.id ?? `own:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, text, own: true, kind };
  own = existing ? own.map((o) => (o.id === f.id ? f : o)) : [...own, f];
  persist(FILES, true);
  changed();
  return f;
}
export function removeFile(id: string) {
  own = own.filter((f) => f.id !== id);
  persist(FILES, true);
  changed();
}

export const SEV_CLASS: Record<Severity, string> = { critical: "sq-crit", high: "sq-high", medium: "sq-med", low: "sq-low" };
export const SEV_COLOR: Record<Severity, string> = { critical: "var(--crit)", high: "var(--high)", medium: "var(--med)", low: "var(--low)" };

export function download(name: string, text: string) {
  // octet-stream, so the browser keeps the exact name instead of adding ".txt".
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.split("/").pop()!;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
