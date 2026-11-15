import type { Edit, Finding } from "./types";

export const indentOf = (line: string) => line.match(/^\s*/)![0];

/** Replace one line, keeping its indentation. */
export const replaceLine = (line: number, text: string, lines: string[]): Edit => ({ start: line, end: line + 1, lines: [indentOf(lines[line - 1] ?? "") + text.trimStart()] });
export const deleteLines = (start: number, end = start): Edit => ({ start, end: end + 1, lines: [] });
export const insertBefore = (line: number, text: string[]): Edit => ({ start: line, end: line, lines: text });
export const insertAfter = (line: number, text: string[]): Edit => ({ start: line + 1, end: line + 1, lines: text });

/**
 * Applies the edits of the chosen findings. Overlapping replacements are skipped (the first one
 * wins), insertions that share a merge key are combined, and everything is applied bottom-up so
 * line numbers stay valid.
 */
export function applyEdits(text: string, findings: Finding[]): { text: string; applied: string[]; skipped: string[] } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const applied: string[] = [];
  const skipped: string[] = [];
  const taken: [number, number][] = [];
  const merged = new Map<string, Edit>();
  const plain: Edit[] = [];

  for (const f of findings) {
    if (!f.edits?.length) continue;
    const replaces = f.edits.filter((e) => e.end > e.start && !e.merge);
    if (replaces.some((e) => taken.some(([s, t]) => e.start < t && e.end > s))) {
      skipped.push(f.rule);
      continue;
    }
    for (const e of replaces) taken.push([e.start, e.end]);
    for (const e of f.edits) {
      if (e.merge) {
        const m = merged.get(e.merge.key);
        if (m) {
          for (const l of e.lines) if (!m.lines.includes(l)) m.lines.push(l);
        } else merged.set(e.merge.key, { ...e, lines: [...e.lines] });
      } else plain.push(e);
    }
    applied.push(f.rule);
  }

  const all = [...plain, ...[...merged.values()].map((m) => ({ start: m.start, end: m.end, lines: [...m.merge!.header, ...m.lines] }))].map((e, i) => ({ ...e, i }));
  // Bottom-up. At the same position: replacements before insertions so both land; then the
  // shallower insertion first, so a deeper block (a container's securityContext) ends up above
  // a shallower one (a pod-level field) that starts after it; otherwise in the order given.
  const depth = (e: Edit) => indentOf(e.lines[0] ?? "").length;
  all.sort((a, b) => b.start - a.start || b.end - a.end || depth(a) - depth(b) || b.i - a.i);
  for (const e of all) lines.splice(e.start - 1, e.end - e.start, ...e.lines);
  return { text: lines.join(eol), applied, skipped };
}
