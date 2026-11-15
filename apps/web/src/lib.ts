import { useSyncExternalStore } from "react";
import { SAMPLES, type Kind, type Severity } from "@redline/core";

export type DeskFile = { id: string; name: string; text: string; own: boolean; note?: string; kind?: Kind; edited?: boolean };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked: changes still work for this visit */
  }
}

const FILES = "redline-files-v1";
const EDITS = "redline-edits-v1";

/** Your own files, and your edits to the examples, live in this browser only. */
let own: DeskFile[] = load<DeskFile[]>(FILES, []).filter((f) => typeof f.name === "string" && typeof f.text === "string");
let edits: Record<string, string> = load(EDITS, {});
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

const SAMPLE_BASE: DeskFile[] = SAMPLES.map((s) => ({ id: `sample:${s.name}`, name: s.name, text: s.text, own: false, note: s.note }));

/** Every file in the workspace: the example project (with your edits), then yours. */
export function allFiles(): DeskFile[] {
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

export function saveText(id: string, text: string) {
  if (id.startsWith("sample:")) {
    const base = SAMPLE_BASE.find((f) => f.id === id);
    if (base && base.text === text) delete edits[id];
    else edits = { ...edits, [id]: text };
    persist(EDITS, edits);
  } else {
    own = own.map((f) => (f.id === id ? { ...f, text } : f));
    persist(FILES, own);
  }
  changed();
}
export function resetSample(id: string) {
  const { [id]: _drop, ...rest } = edits;
  void _drop;
  edits = rest;
  persist(EDITS, edits);
  changed();
}

export function addFile(name: string, text: string, kind?: Kind): DeskFile {
  const existing = own.find((f) => f.name === name);
  const f: DeskFile = { id: existing?.id ?? `own:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, text, own: true, kind };
  own = existing ? own.map((o) => (o.id === f.id ? f : o)) : [...own, f];
  persist(FILES, own);
  changed();
  return f;
}
export function removeFile(id: string) {
  own = own.filter((f) => f.id !== id);
  persist(FILES, own);
  changed();
}

export const SEV_CLASS: Record<Severity, "sq-crit" | "sq-med" | "sq-low"> = { critical: "sq-crit", high: "sq-crit", medium: "sq-med", low: "sq-low" };
export const SEV_COLOR: Record<Severity, string> = { critical: "var(--crit)", high: "var(--crit)", medium: "var(--med)", low: "var(--low)" };

export function download(name: string, text: string) {
  // octet-stream, so the browser keeps the exact name instead of adding ".txt".
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.split("/").pop()!;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
