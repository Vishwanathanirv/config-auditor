export type DiffLine = { kind: "same" | "add" | "del"; text: string; a?: number; b?: number };

/** Line diff by longest common subsequence. Config files are small, so O(n·m) is fine. */
export function diffLines(before: string, after: string): DiffLine[] {
  // A final newline ends the last line; it doesn't start an empty one.
  const a = before.replace(/\r?\n$/, "").split(/\r?\n/);
  const b = after.replace(/\r?\n$/, "").split(/\r?\n/);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ kind: "del", text: a[i], a: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], b: j + 1 });
      j++;
    }
  }
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
