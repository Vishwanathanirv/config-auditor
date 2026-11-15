/**
 * Runs every labelled fixture and sample and writes apps/web/public/evaluation.json:
 * matches against the labels per rule, false alarms on hardened configs, whether each
 * automatic fix removes its problem and leaves a valid file, and speed.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { audit, fix, KIND_NAME, RULES, SAMPLES, type Kind } from "../packages/core/src";
import { FIXTURES } from "../packages/core/test/fixtures";

const perRule = Object.fromEntries(RULES.map((r) => [r.id, { tp: 0, fp: 0, fn: 0 }]));
const files: { name: string; kind: string; expected: number; found: number; ok: boolean }[] = [];
let cleanFiles = 0;
let cleanAlarms = 0;

for (const f of FIXTURES) {
  const r = audit(f.file, f.text);
  const want = [...f.expect];
  const got = r.findings.map((x) => x.rule);
  for (const g of got) {
    const i = want.indexOf(g);
    if (i >= 0) {
      perRule[g].tp++;
      want.splice(i, 1);
    } else perRule[g].fp++;
  }
  for (const w of want) perRule[w].fn++;
  if (!f.expect.length) {
    cleanFiles++;
    cleanAlarms += got.length;
  }
  files.push({ name: f.name, kind: KIND_NAME[r.kind as Kind], expected: f.expect.length, found: got.length, ok: !want.length && got.length === f.expect.length });
}

// Fixes: each fixable finding must be gone after fixing, and the file must still parse.
let fixable = 0;
let fixedOk = 0;
let validAfter = 0;
let inputs = 0;
for (const f of [...FIXTURES.map((x) => ({ name: x.file, text: x.text })), ...SAMPLES]) {
  const before = audit(f.name, f.text);
  const fx = fix(f.name, f.text);
  inputs++;
  if (!fx.report.errors.length) validAfter++;
  for (const b of before.findings.filter((x) => x.edits?.length)) {
    fixable++;
    if (!fx.report.findings.some((a) => a.rule === b.rule && a.edits?.length)) fixedOk++;
  }
}

// Speed: audit every sample many times.
const runs = 200;
const t0 = performance.now();
for (let i = 0; i < runs; i++) for (const s of SAMPLES) audit(s.name, s.text);
const perFileMs = (performance.now() - t0) / (runs * SAMPLES.length);

const sum = (k: "tp" | "fp" | "fn") => Object.values(perRule).reduce((s, r) => s + r[k], 0);
const report = {
  generatedAt: new Date().toISOString(),
  rules: RULES.length,
  autofixRules: RULES.filter((r) => r.autofix).length,
  fixtures: FIXTURES.length,
  labelled: FIXTURES.reduce((s, f) => s + f.expect.length, 0),
  found: { tp: sum("tp"), fp: sum("fp"), fn: sum("fn") },
  clean: { files: cleanFiles, alarms: cleanAlarms },
  fixes: { fixable, removed: fixedOk, inputs, validAfter },
  perFileMs: Math.round(perFileMs * 100) / 100,
  perRule,
  files,
};
writeFileSync(path.join(import.meta.dirname, "../apps/web/public/evaluation.json"), JSON.stringify(report, null, 1));
console.log(`Rules ${report.rules} · fixtures ${report.fixtures} · labelled ${report.labelled} · TP ${report.found.tp} FP ${report.found.fp} FN ${report.found.fn}`);
console.log(`Clean configs: ${cleanFiles} files, ${cleanAlarms} false alarms · fixes ${fixedOk}/${fixable} removed, ${validAfter}/${inputs} valid after · ${report.perFileMs} ms per file`);
