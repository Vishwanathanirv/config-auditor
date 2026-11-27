import { useEffect, useState } from "react";
import { KIND_NAME, RULE, type Kind } from "@redline/core";

type Report = {
  generatedAt: string;
  rules: number;
  autofixRules: number;
  fixtures: number;
  labelled: number;
  found: { tp: number; fp: number; fn: number };
  clean: { files: number; alarms: number };
  fixes: { fixable: number; removed: number; inputs: number; validAfter: number };
  perFileMs: number;
  perRule: Record<string, { tp: number; fp: number; fn: number }>;
  files: { name: string; kind: string; expected: number; found: number; ok: boolean }[];
};
type Tally = { tp: number; fn: number; fp: number; tn: number };
type Benchmark = { sources: { kics: string; gixy: string }; files: number; testFiles: number; test: { by: Record<Kind, Tally>; all: Tally }; baselineTest: { all: Tally } };

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const precision = (t: Tally) => pct(t.tp, t.tp + t.fp);
const recall = (t: Tally) => pct(t.tp, t.tp + t.fn);

/** Pass or fail. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <span className="mono text-[15px] font-semibold leading-none" style={{ color: ok ? "var(--ok)" : "var(--crit)" }}>
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
      <span className="sr-only">{ok ? "matches" : "does not match"}</span>
    </span>
  );
}

const Heading = ({ n, children }: { n: number; children: string }) => (
  <h2 className="mt-12 flex items-baseline gap-3 text-[15px] font-semibold">
    <span className="mono text-[13px] text-accent">{String(n).padStart(2, "0")}</span>
    {children}
  </h2>
);

export function Bench() {
  const [r, setR] = useState<Report | null>(null);
  const [b, setB] = useState<Benchmark | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/evaluation.json")
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error("No test report yet. Run npm run evaluate."))))
      .then(setR, (e: Error) => setError(e.message));
    fetch("/benchmark.json")
      .then((x) => (x.ok ? x.json() : null))
      .then(setB, () => setB(null));
  }, []);
  if (error) return <p className="text-[14px] text-muted" role="alert">{error}</p>;
  if (!r) return <div aria-busy="true" aria-label="Loading the benchmark" className="space-y-3"><div className="h-4 w-40 animate-pulse rounded bg-panel-2" /><div className="h-8 w-3/4 animate-pulse rounded bg-panel-2" /><div className="h-32 animate-pulse rounded bg-panel-2" /></div>;

  const findings = [
    [`Found ${r.found.tp} of ${r.labelled} labelled problems`, `${r.found.fp} extra, ${r.found.fn} missed`, r.found.fp + r.found.fn === 0],
    [`${r.clean.alarms} false alarms on hardened configs`, `${r.clean.files} configs built from Mozilla's nginx and OpenSSH guides and the Kubernetes "restricted" profile`, r.clean.alarms === 0],
    [`${r.fixes.removed} of ${r.fixes.fixable} automatic fixes remove their problem`, "checked by inspecting the fixed file again", r.fixes.removed === r.fixes.fixable],
    [`${r.fixes.validAfter} of ${r.fixes.inputs} files still valid after fixing`, "YAML and nginx files parsed again", r.fixes.validAfter === r.fixes.inputs],
    [`${r.perFileMs} ms to inspect a file`, "in the browser, nothing uploaded", true],
  ] as const;

  return (
    <div className="max-w-4xl">
      <div className="eyebrow">Benchmark · {new Date(r.generatedAt).toLocaleDateString()}</div>
      <h1 className="mt-1 text-[1.7rem] font-semibold leading-tight">Does Redline find what it should, and only that?</h1>
      <p className="mt-3 max-w-3xl text-[1.02rem] leading-relaxed text-muted">Two tests. The first uses test files written by other projects, which Redline's rules were not written against. The second uses Redline's own hand-labelled files, which also run as unit tests on every push.</p>

      {b && (
        <>
          <Heading n={1}>Other projects' test files</Heading>
          <p className="mt-3 max-w-3xl leading-relaxed">
            {b.files} labelled files from KICS {b.sources.kics} (Apache-2.0) and {b.sources.gixy} (MPL-2.0). The rules were tuned on a fixed 60% of them; these are the other {b.testFiles}, held out and not looked at while tuning.
          </p>
          <table className="mono mt-4 w-full max-w-3xl text-[13.5px]">
            <caption className="sr-only">Precision and recall on the held-out files, by file type</caption>
            <thead>
              <tr className="border-b border-[var(--line-strong)] text-left text-[11px] uppercase tracking-[0.12em]">
                <th className="py-1.5 pr-3 font-bold">File type</th>
                <th className="py-1.5 pr-3 text-right font-bold">Files</th>
                <th className="py-1.5 pr-3 text-right font-bold">Precision</th>
                <th className="py-1.5 pr-3 text-right font-bold">Recall</th>
                <th className="py-1.5 text-right font-bold">False alarms</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(b.test.by) as [Kind, Tally][])
                .filter(([, t]) => t.tp + t.fn + t.fp + t.tn)
                .map(([k, t]) => (
                  <tr key={k} className="border-b border-line">
                    <td className="py-1.5 pr-3">{KIND_NAME[k]}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{t.tp + t.fn + t.fp + t.tn}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{precision(t)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{recall(t)}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.fp}</td>
                  </tr>
                ))}
              <tr className="font-bold">
                <td className="py-2 pr-3">All</td>
                <td className="py-2 pr-3 text-right tabular-nums">{b.testFiles}</td>
                <td className="py-2 pr-3 text-right">
                  <span className="mono font-semibold text-accent">{precision(b.test.all)}</span>
                </td>
                <td className="py-2 pr-3 text-right">
                  <span className="mono font-semibold text-accent">{recall(b.test.all)}</span>
                </td>
                <td className="py-2 text-right tabular-nums">{b.test.all.fp}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 max-w-3xl text-[14.5px] font-medium leading-snug text-ink">
            Before tuning, the same held-out files scored {precision(b.baselineTest.all)} precision and {recall(b.baselineTest.all)} recall.
          </p>
          <p className="mt-2 max-w-3xl text-[14px] text-muted">
            Precision: of the files Redline flagged, how many really had the problem. Recall: of the files with the problem, how many Redline flagged. Only checks that mean the same as a Redline rule are counted; no public labelled suite for sshd was found. Reproduce with <code className="mono">npm run bench</code>.
          </p>
        </>
      )}

      <Heading n={b ? 2 : 1}>Redline's own labelled files</Heading>
      <p className="mt-3 max-w-3xl leading-relaxed">
        {r.fixtures} config files, from wide-open setups to configs that follow Mozilla's and Kubernetes' own hardening guides, labelled with the problems they contain. Every one of the {r.rules} rules is covered. It is a small, hand-made set: real configs with unusual layouts can still trip a rule, and if one does, it's a bug worth reporting.
      </p>
      <ul className="mt-4 space-y-2">
        {findings.map(([title, sub, ok]) => (
          <li key={title} className="flex items-baseline gap-3">
            <Mark ok={ok} />
            <span>
              <span className="font-semibold">{title}</span> <span className="text-muted">({sub})</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <table className="w-full text-[14px]">
          <caption className="mono mb-2 text-left text-[11px] font-bold uppercase tracking-[0.14em]">Every test file</caption>
          <thead>
            <tr className="mono border-b border-[var(--line-strong)] text-left text-[11px] uppercase tracking-[0.12em]">
              <th className="py-1.5 pr-2 font-bold">File</th>
              <th className="py-1.5 pr-2 font-bold">Type</th>
              <th className="py-1.5 pr-2 text-right font-bold">Labelled</th>
              <th className="py-1.5 pr-2 text-right font-bold">Found</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {r.files.map((f) => (
              <tr key={f.name} className="border-b border-line">
                <td className="py-1 pr-2">{f.name}</td>
                <td className="whitespace-nowrap py-1 pr-2 text-muted">{f.kind}</td>
                <td className="mono py-1 pr-2 text-right">{f.expected}</td>
                <td className="mono py-1 pr-2 text-right">{f.found}</td>
                <td className="py-1 text-center">
                  <Mark ok={f.ok} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <section>
          <h3 className="mono text-[11px] font-bold uppercase tracking-[0.14em]">Rules with the most test cases</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(r.perRule)
              .sort((a, b) => b[1].tp - a[1].tp)
              .slice(0, 14)
              .map(([id, s]) => (
                <li key={id} className="flex gap-2 border-b border-dotted border-line pb-0.5">
                  <span className="mono w-16 shrink-0 text-muted">{id}</span>
                  <span className="flex-1 truncate">{RULE[id]?.title}</span>
                  <span className="mono">{s.tp}</span>
                </li>
              ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Reproduce with <code className="mono">npm run evaluate</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
