import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments, type Document, type Node, type Pair, type YAMLMap } from "yaml";
import type { Edit } from "./types";

/** YAML with line numbers, plus helpers to write fixes as line edits that keep the file's layout. */
export class Yaml {
  readonly lc = new LineCounter();
  readonly docs: Document.Parsed[];
  readonly lines: string[];
  readonly errors: string[] = [];

  constructor(readonly text: string) {
    this.docs = parseAllDocuments(text, { lineCounter: this.lc, keepSourceTokens: true }) as Document.Parsed[];
    this.lines = text.split(/\r?\n/);
    for (const d of this.docs) for (const e of d.errors) this.errors.push(`Line ${this.lc.linePos(e.pos[0]).line}: ${e.message.split("\n")[0]}`);
  }

  line(node: Node | Pair | null | undefined): number {
    const n = node && "key" in node ? (node.key as Node) : node;
    return n?.range ? this.lc.linePos(n.range[0]).line : 1;
  }

  /** The last line that belongs to a node, skipping trailing blank lines and comments. */
  lastLine(node: Node): number {
    let l = this.lc.linePos(Math.max(node.range![0], node.range![1] - 1)).line;
    while (l > 1 && /^\s*(#.*)?$/.test(this.lines[l - 1] ?? "")) l--;
    return l;
  }

  /** The column (as spaces) of the keys in a block map. */
  indent(map: YAMLMap): string {
    const k = map.items[0]?.key as Node | undefined;
    return " ".repeat(k?.range ? this.lc.linePos(k.range[0]).col - 1 : 0);
  }

  isFlow(node: Node | undefined) {
    return !!node && (isMap(node) || isSeq(node)) && (node as YAMLMap).flow === true;
  }

  /**
   * Edits that make `map.<key>.<child>` equal `value`. Creates `key:` if needed; edits that
   * create the same parent share a merge key so they produce one block. Returns undefined when
   * the layout is too unusual to edit safely (flow style, for example).
   */
  ensure(map: YAMLMap, key: string, childLines: string[], at: string): Edit[] | undefined {
    if (map.flow) return undefined;
    const ind = this.indent(map);
    const pair = map.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<Node, Node> | undefined;
    if (!pair) {
      return [{ start: this.lastLine(map) + 1, end: this.lastLine(map) + 1, lines: childLines.map((l) => `${ind}  ${l}`), merge: { key: `${at}.${key}`, header: [`${ind}${key}:`] } }];
    }
    const v = pair.value;
    if (!v || (isScalar(v) && v.value === null)) {
      const l = this.line(pair);
      return [{ start: l, end: l + 1, lines: childLines.map((c) => `${ind}  ${c}`), merge: { key: `${at}.${key}`, header: [`${ind}${key}:`] } }];
    }
    if (!isMap(v) || v.flow) return undefined;
    const ci = this.indent(v);
    return [{ start: this.lastLine(v) + 1, end: this.lastLine(v) + 1, lines: childLines.map((c) => `${ci}${c}`), merge: { key: `${at}.${key}+`, header: [] } }];
  }

  /** Replaces the value on a `key: value` line. */
  setValue(pair: Pair, value: string): Edit | undefined {
    const l = this.line(pair);
    const text = this.lines[l - 1];
    const m = text.match(/^(\s*(?:-\s+)?[^:#]+:\s*)(.*?)(\s+#.*)?$/);
    if (!m) return undefined;
    return { start: l, end: l + 1, lines: [`${m[1]}${value}${m[3] ?? ""}`] };
  }
}

export const get = (node: unknown, ...path: (string | number)[]): unknown => {
  let n = node;
  for (const p of path) {
    if (isMap(n)) n = n.get(p, true);
    else if (isSeq(n) && typeof p === "number") n = n.get(p, true);
    else return undefined;
  }
  return n;
};
export const scalar = (n: unknown): unknown => (isScalar(n) ? n.value : undefined);
export const pairOf = (map: unknown, key: string): Pair<Node, Node> | undefined => (isMap(map) ? (map.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<Node, Node>) : undefined);
export const truthy = (n: unknown) => {
  const v = scalar(n);
  return v === true || v === "true" || v === "yes";
};
export { isMap, isScalar, isSeq };
