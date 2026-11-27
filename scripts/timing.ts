/**
 * `npm run timing`: how long audit() takes on inputs of growing size, and how many findings each
 * rule produces over the repo's own labelled fixtures. Prints only; writes no files.
 * Inputs are SYNTHETIC: each built-in sample repeated N times (YAML joined as separate documents).
 */
import { audit, RULES, SAMPLES } from "../packages/core/src";
import { FIXTURES } from "../packages/core/test/fixtures";

const RUNS = 50;
const REPEATS = [1, 10, 100];
const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];

console.log(`Node ${process.version}, ${RUNS} runs per cell, after 5 warm-up runs`);
console.log("\nfile | size | lines | p50 ms | p99 ms");
for (const s of SAMPLES) {
  const yaml = /\.ya?ml$/i.test(s.name);
  for (const n of REPEATS) {
    const text = Array(n).fill(s.text.trimEnd()).join(yaml ? "\n---\n" : "\n") + "\n";
    for (let i = 0; i < 5; i++) audit(s.name, text);
    const t: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      audit(s.name, text);
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    console.log(`${s.name} x${n} | ${(text.length / 1024).toFixed(1)} KB | ${text.split("\n").length} | ${pct(t, 50).toFixed(2)} | ${pct(t, 99).toFixed(2)}`);
  }
}

const counts = new Map(RULES.map((r) => [r.id, 0]));
for (const f of FIXTURES) for (const x of audit(f.file, f.text).findings) counts.set(x.rule, (counts.get(x.rule) ?? 0) + 1);
const zero = [...counts].filter(([, c]) => !c).map(([id]) => id);
console.log(`\nFindings over ${FIXTURES.length} fixtures: ${[...counts.values()].reduce((a, b) => a + b, 0)} total, ${RULES.length - zero.length} of ${RULES.length} rules fire at least once`);
console.log("rule | findings");
for (const [id, c] of counts) console.log(`${id} | ${c}`);
