export type DiffLine = { kind: "same" | "add" | "del"; text: string; a?: number; b?: number };

/** Above this many cells the middle of the diff is shown as one replaced block instead. */
const MAX_TABLE = 4_000_000;

/**
 * Line diff by longest common subsequence. The unchanged start and end are matched first, so
 * the table only covers the part that changed (fixes touch a few lines); a very large changed
 * part is shown as a block replacement rather than using quadratic memory.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  // A final newline ends the last line; it doesn't start an empty one.
  const a = before.replace(/\r?\n$/, "").split(/\r?\n/);
  const b = after.replace(/\r?\n$/, "").split(/\r?\n/);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - suf;
  const m = b.length - suf;
  const out: DiffLine[] = [];
  for (let k = 0; k < pre; k++) out.push({ kind: "same", text: a[k], a: k + 1, b: k + 1 });
  const rows = n - pre;
  const cols = m - pre;
  const big = (rows + 1) * (cols + 1) > MAX_TABLE;
  const lcs = big ? [] : Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
  if (!big) for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--) lcs[i][j] = a[pre + i] === b[pre + j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const L = (i: number, j: number) => (big ? 0 : lcs[i - pre][j - pre]);
  let i = pre;
  let j = pre;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (i < n && (j >= m || L(i + 1, j) >= L(i, j + 1))) {
      out.push({ kind: "del", text: a[i], a: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], b: j + 1 });
      j++;
    }
  }
  for (let k = 0; k < suf; k++) out.push({ kind: "same", text: a[n + k], a: n + k + 1, b: m + k + 1 });
  return out;
}

/** A unified diff (`git apply` / `patch -p1` compatible) with three lines of context. */
export function unifiedDiff(name: string, before: string, after: string): string {
  const d = diffLines(before, after);
  const changed = d.flatMap((l, i) => (l.kind === "same" ? [] : [i]));
  if (!changed.length) return "";
  // Group changes whose gap is small enough that their context would overlap.
  const groups: [number, number][] = [];
  for (const i of changed) {
    const g = groups.at(-1);
    if (g && i - g[1] <= 7) g[1] = i;
    else groups.push([i, i]);
  }
  const out = [`--- a/${name}`, `+++ b/${name}`];
  for (const [first, last] of groups) {
    const slice = d.slice(Math.max(0, first - 3), Math.min(d.length, last + 4));
    const aLen = slice.filter((l) => l.kind !== "add").length;
    const bLen = slice.filter((l) => l.kind !== "del").length;
    // Start lines: from the first line in the hunk that exists on that side.
    const before0 = d.slice(0, Math.max(0, first - 3)).filter((l) => l.kind !== "add").length;
    const after0 = d.slice(0, Math.max(0, first - 3)).filter((l) => l.kind !== "del").length;
    out.push(`@@ -${aLen ? before0 + 1 : before0},${aLen} +${bLen ? after0 + 1 : after0},${bLen} @@`);
    for (const l of slice) out.push((l.kind === "same" ? " " : l.kind === "add" ? "+" : "-") + l.text);
  }
  return out.join("\n") + "\n";
}
