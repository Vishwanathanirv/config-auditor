import type { Kind } from "@redline/core";

export type Tok = { t: string; c?: "key" | "str" | "num" | "com" };

/**
 * Just enough highlighting to read config files comfortably: comments, strings, numbers and
 * the leading keyword of each line (YAML keys, Dockerfile instructions, nginx and sshd
 * directives). It is per line, so it stays fast while you type.
 */
export function highlight(line: string, kind: Kind | null): Tok[] {
  const out: Tok[] = [];
  let rest = line;
  const lead = rest.match(/^\s*/)![0];
  if (lead) out.push({ t: lead });
  rest = rest.slice(lead.length);
  if (rest.startsWith("#")) return [...out, { t: rest, c: "com" }];

  // The leading keyword.
  let m: RegExpMatchArray | null = null;
  if (kind === "compose" || kind === "kubernetes") m = rest.match(/^(-\s+)?([\w.\-/"']+)(\s*:)(?=\s|$)/);
  else if (kind === "dockerfile") m = rest.match(/^()([A-Za-z]+)(?=\s|$)()/);
  else if (kind === "nginx" || kind === "sshd") m = rest.match(/^()([A-Za-z_][\w-]*)(?=\s|;|$)()/);
  if (m) {
    if (m[1]) out.push({ t: m[1] });
    out.push({ t: m[2], c: "key" });
    if (m[3]) out.push({ t: m[3] });
    rest = rest.slice(m[0].length);
  }

  // Strings, numbers and trailing comments in the rest.
  const re = /("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\s#.*$)|(\b\d+(?:\.\d+)*\b)/g;
  let at = 0;
  for (const x of rest.matchAll(re)) {
    if (x.index! > at) out.push({ t: rest.slice(at, x.index) });
    out.push({ t: x[0], c: x[1] ? "str" : x[2] ? "com" : "num" });
    at = x.index! + x[0].length;
  }
  if (at < rest.length) out.push({ t: rest.slice(at) });
  return out;
}

export const TOK_COLOR: Record<NonNullable<Tok["c"]>, string> = { key: "var(--tok-key)", str: "var(--tok-str)", num: "var(--tok-num)", com: "var(--tok-com)" };
