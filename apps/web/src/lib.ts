import { useSyncExternalStore } from "react";
import { SAMPLES, type Kind, type Severity } from "@redline/core";

export type DeskFile = { id: string; name: string; text: string; own: boolean; note?: string; kind?: Kind };

const KEY = "redline-files-v1";
const load = (): DeskFile[] => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DeskFile[]).filter((f) => typeof f.name === "string" && typeof f.text === "string") : [];
  } catch {
    return [];
  }
};

/** Your own files live in this browser only; nothing is uploaded. */
let own: DeskFile[] = load();
const listeners = new Set<() => void>();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(own));
  } catch {
    /* storage full or blocked: the files still work for this visit */
  }
  listeners.forEach((l) => l());
};

export const SAMPLE_FILES: DeskFile[] = SAMPLES.map((s) => ({ id: `sample:${s.name}`, name: s.name, text: s.text, own: false, note: s.note }));

export function useOwnFiles() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => own,
  );
}

export function addFile(name: string, text: string, kind?: Kind): DeskFile {
  const existing = own.find((f) => f.name === name);
  const f: DeskFile = { id: existing?.id ?? `own:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, text, own: true, kind };
  own = existing ? own.map((o) => (o.id === f.id ? f : o)) : [...own, f];
  save();
  return f;
}
export function removeFile(id: string) {
  own = own.filter((f) => f.id !== id);
  save();
}

export function findFile(id: string | null): DeskFile | undefined {
  return SAMPLE_FILES.find((f) => f.id === id) ?? own.find((f) => f.id === id);
}

export const SEV_WORD: Record<Severity, string> = { critical: "critical", high: "high", medium: "medium", low: "low" };
export const isPencil = (s: Severity) => s === "low";

export function download(name: string, text: string) {
  // octet-stream, so the browser keeps the exact name instead of adding ".txt".
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.split("/").pop()!;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
