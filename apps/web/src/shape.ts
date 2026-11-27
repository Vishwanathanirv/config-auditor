import type { Kind } from "@redline/core";

export type WorkFile = { id: string; name: string; text: string; own: boolean; note?: string; kind?: Kind; edited?: boolean };

/** Largest single file Redline opens or keeps (characters). */
export const MAX_FILE = 1_000_000;
/** Total size of your own files kept in this browser, under the usual 5 MB storage quota. */
export const MAX_TOTAL = 4_000_000;

/** Whatever was stored, keep only well-formed files; anything else is dropped, never thrown on. */
export function sanitizeFiles(x: unknown): WorkFile[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && typeof (f as Record<string, unknown>).name === "string" && typeof (f as Record<string, unknown>).text === "string")
    .map((f) => ({
      id: typeof f.id === "string" ? f.id : `own:${String(f.name)}`,
      name: f.name as string,
      text: (f.text as string).slice(0, MAX_FILE),
      own: true,
      ...(typeof f.kind === "string" ? { kind: f.kind as Kind } : {}),
    }));
}

export function sanitizeEdits(x: unknown): Record<string, string> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(x)) if (typeof v === "string" && k.startsWith("sample:")) out[k] = v;
  return out;
}

/** Config files are text; a NUL byte means a binary file was dropped by mistake. */
export const isBinary = (text: string) => text.includes("\u0000");
