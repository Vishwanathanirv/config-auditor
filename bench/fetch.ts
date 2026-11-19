/**
 * Downloads the public test cases the benchmark runs against and writes them to
 * bench/fixtures. The results are committed, so `npm run bench` works offline; run
 * `npm run bench:fetch` only to refresh them (the versions are pinned in sources.ts).
 *
 * - KICS (Apache-2.0): each query's documentation page carries all of its positive and negative
 *   test files, taken from the query's test folder. We read those pages at a pinned tag.
 * - gixy-ng (MPL-2.0): the nginx plugin tests from the published source package. A file ending
 *   in `_fp.conf` must not be reported; every other file must be.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIXY, GIXY_PLUGINS, KICS, KICS_REF } from "./sources";

const OUT = join(import.meta.dirname, "fixtures");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function get(url: string): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.ok) return r;
    if (i >= 3) throw new Error(`${url}: HTTP ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 1000 * 2 ** i));
  }
}

type Sample = { label: "positive" | "negative"; n: number; type: string; lines: number[]; text: string };

/** Pulls the code samples out of a KICS query page. */
export function parseKicsPage(md: string): Sample[] {
  const out: Sample[] = [];
  const re = /(?:<summary>(Positive|Negative) test num\. (\d+) - (\S+) file<\/summary>\s*)?```\w*([^\n]*)\n([\s\S]*?)```/g;
  for (const m of md.matchAll(re)) {
    let [, label, n, type] = m;
    const attrs = m[4];
    const t = attrs.match(/title="(Positive|Negative) test num\. (\d+) - (\S+) file"/);
    if (t) [, label, n, type] = t;
    if (!label) continue;
    const hl = attrs.match(/hl_lines="([^"]*)"/)?.[1] ?? "";
    out.push({ label: label.toLowerCase() as Sample["label"], n: Number(n), type, lines: hl.split(/\s+/).filter(Boolean).map(Number), text: m[5] });
  }
  return out;
}

async function kics() {
  const manifest: Record<string, unknown>[] = [];
  for (const q of KICS) {
    const url = `https://raw.githubusercontent.com/Checkmarx/kics/${KICS_REF}/docs/queries/${q.platform}-queries/${q.id}.md`;
    const samples = parseKicsPage(await (await get(url)).text());
    if (!samples.length) throw new Error(`No samples found for ${q.name}`);
    const dir = join(OUT, "kics", q.platform, slug(q.name));
    mkdirSync(dir, { recursive: true });
    for (const s of samples) {
      if (s.type !== "dockerfile" && s.type !== "yaml") continue; // JSON copies of YAML tests are skipped
      const file = `${s.label}-${s.n}.${s.type}`;
      writeFileSync(join(dir, file), s.text);
      manifest.push({ source: "kics", query: q.id, queryName: q.name, platform: q.platform, rule: q.rule, file: `kics/${q.platform}/${slug(q.name)}/${file}`, expect: s.label, lines: s.lines });
    }
    console.log(`kics ${q.platform} ${q.name}: ${samples.length} samples`);
  }
  return manifest;
}

async function gixy() {
  const meta = (await (await get(`https://pypi.org/pypi/${GIXY.name}/${GIXY.version}/json`)).json()) as { urls: { packagetype: string; url: string; digests: { sha256: string } }[] };
  const sdist = meta.urls.find((u) => u.packagetype === "sdist")!;
  const buf = Buffer.from(await (await get(sdist.url)).arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), "gixy-"));
  try {
    writeFileSync(join(tmp, "src.tar.gz"), buf);
    execFileSync("tar", ["xzf", "src.tar.gz"], { cwd: tmp });
    const root = join(tmp, readdirSync(tmp).find((d) => d.startsWith("gixy"))!);
    copyFileSync(join(root, "LICENSE"), join(import.meta.dirname, "licenses", "gixy-ng-LICENSE"));
    const manifest: Record<string, unknown>[] = [];
    for (const [plugin, rules] of Object.entries(GIXY_PLUGINS)) {
      const src = join(root, "tests", "plugins", "simply", plugin);
      const dir = join(OUT, "gixy", plugin);
      mkdirSync(dir, { recursive: true });
      for (const f of readdirSync(src).filter((f) => f.endsWith(".conf")).sort()) {
        const text = readFileSync(join(src, f), "utf8");
        writeFileSync(join(dir, f), text);
        manifest.push({ source: "gixy", plugin, rules, file: `gixy/${plugin}/${f}`, expect: f.endsWith("_fp.conf") ? "negative" : "positive" });
      }
      console.log(`gixy ${plugin}: ${readdirSync(dir).length} files`);
    }
    return { manifest, sha256: sdist.digests.sha256 };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(import.meta.dirname, "licenses"), { recursive: true });
writeFileSync(join(import.meta.dirname, "licenses", "KICS-LICENSE"), await (await get(`https://raw.githubusercontent.com/Checkmarx/kics/${KICS_REF}/LICENSE`)).text());
const k = await kics();
const g = await gixy();
writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify({ kics: { ref: KICS_REF, license: "Apache-2.0" }, gixy: { ...GIXY, sha256: g.sha256, license: "MPL-2.0" }, cases: [...k, ...g.manifest] }, null, 1) + "\n",
);
console.log(`${k.length + g.manifest.length} cases written`);
