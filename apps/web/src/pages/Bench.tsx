import { useEffect, useState } from "react";
import { RULE } from "@redline/core";

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

export function Bench() {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/evaluation.json")
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error("No test report yet. Run npm run evaluate."))))
      .then(setR, (e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="text-muted">{error}</p>;
  if (!r) return <p className="text-muted">Loading the test report…</p>;

  const stats = [
    [`${r.found.tp} of ${r.labelled}`, "labelled problems found", `${r.found.fp} extra, ${r.found.fn} missed`],
    [String(r.clean.alarms), "false alarms on hardened configs", `${r.clean.files} configs built from public hardening guides`],
    [`${r.fixes.removed} of ${r.fixes.fixable}`, "automatic fixes remove their problem", "checked by inspecting the fixed file again"],
    [`${r.fixes.validAfter} of ${r.fixes.inputs}`, "files still valid after fixing", "YAML and nginx files parsed again"],
    [`${r.perFileMs} ms`, "to inspect a file", "in the browser, nothing uploaded"],
  ] as const;

  return (
    <div className="max-w-5xl">
      <h1 className="text-[2.2rem] font-bold leading-[1.05] tracking-[-0.02em]">The test bench</h1>
      <p className="mt-3 max-w-3xl text-[1.02rem] leading-relaxed text-muted">
        {r.fixtures} config files were written by hand and labelled with the problems they contain, from wide-open setups to configs that follow Mozilla's and Kubernetes' own hardening guides. Every one of the {r.rules} rules is tested this way. This proves the rules do what they say on these files; it is a small, hand-made set, so real configs with unusual layouts can still trip a rule. If one does, it's a bug worth reporting.
      </p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {stats.map(([v, l, sub]) => (
          <div key={l} className="bg-paper p-4 text-paper-ink">
            <div className="font-type text-2xl font-bold">{v}</div>
            <div className="mt-1 text-sm font-semibold">{l}</div>
            <div className="mt-0.5 text-xs text-paper-faint">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="printout py-4">
          <h2 className="px-2 text-lg font-bold">Every test file</h2>
          <table className="mt-2 w-full text-[14px]">
            <thead className="text-left text-paper-faint">
              <tr>
                <th className="px-2 py-1.5 font-medium">File</th>
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 text-right font-medium">Labelled</th>
                <th className="px-2 py-1.5 text-right font-medium">Found</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {r.files.map((f, i) => (
                <tr key={f.name} className={i % 6 < 3 ? "bg-[var(--paper-bar)]" : ""}>
                  <td className="px-2 py-1">{f.name}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-paper-faint">{f.kind}</td>
                  <td className="px-2 py-1 text-right font-type">{f.expected}</td>
                  <td className="px-2 py-1 text-right font-type">{f.found}</td>
                  <td className="hand px-2 py-1 text-center text-[20px] leading-none" style={{ color: f.ok ? "var(--ink-blue)" : "var(--pen)" }} aria-label={f.ok ? "matches" : "does not match"}>
                    {f.ok ? "✓" : "✗"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2 className="text-lg font-bold">Rules with the most test cases</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(r.perRule)
              .sort((a, b) => b[1].tp - a[1].tp)
              .slice(0, 14)
              .map(([id, s]) => (
                <li key={id} className="flex gap-2">
                  <span className="w-16 shrink-0 font-type text-faint">{id}</span>
                  <span className="flex-1 truncate">{RULE[id]?.title}</span>
                  <span className="font-type">{s.tp}</span>
                </li>
              ))}
          </ul>
          <p className="mt-4 text-xs text-faint">
            Generated {new Date(r.generatedAt).toLocaleString()}. Reproduce with <code className="font-type">npm run evaluate</code>; the same files run as unit tests on every push.
          </p>
        </section>
      </div>
    </div>
  );
}
