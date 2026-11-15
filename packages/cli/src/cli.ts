import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { audit, detect, fix, KIND_NAME, RULE, SEVERITY_RANK, toSarif, unifiedDiff, type FileReport, type Severity } from "@redline/core";

const HELP = `Redline: audits Dockerfiles, Docker Compose, Kubernetes, nginx and sshd configs.

Usage: redline [paths...] [options]

Paths can be files or folders (default: the current folder). Folders are searched for
files Redline understands; node_modules, .git and build folders are skipped.

Options:
  --format <text|json|sarif>   Output format (default: text)
  --output <file>              Write the report to a file instead of the terminal
  --fail-on <severity>         Exit with code 1 if anything this severe or worse is found:
                               low, medium, high (default), critical, or never
  --fix                        Apply the safe automatic fixes to the files in place
  --diff                       Print the fixes as a patch instead of applying them
  -h, --help                   Show this help
`;

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", ".venv", "venv", "target", "coverage"]);

function collect(p: string, out: string[]) {
  const st = statSync(p);
  if (st.isFile()) return void out.push(p);
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) collect(path.join(p, e.name), out);
    } else if (e.isFile()) {
      const f = path.join(p, e.name);
      if (/(dockerfile|containerfile|\.ya?ml$|\.conf$|sshd_config)/i.test(e.name) && statSync(f).size < 1_000_000) out.push(f);
    }
  }
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const SEV_COLOR: Record<Severity, string> = { critical: "1;31", high: "31", medium: "33", low: "2" };

function text(reports: FileReport[]) {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push("", `${c("1", r.name)}  ${c("2", KIND_NAME[r.kind!])}  grade ${c("1", r.grade)} (${r.score}/100)`);
    for (const e of r.errors) lines.push(`  ${c("31", "could not read:")} ${e}`);
    if (!r.findings.length && !r.errors.length) lines.push(`  ${c("32", "no problems found")}`);
    for (const f of r.findings) {
      lines.push(`  ${c("2", `${String(f.line).padStart(4)}`)}  ${c(SEV_COLOR[f.severity], f.severity.padEnd(8))} ${c("1", f.rule)} ${RULE[f.rule].title}${f.edits?.length ? c("36", "  [fixable]") : ""}`);
      lines.push(`        ${f.message.replace(/`/g, "")}`);
    }
  }
  const all = reports.flatMap((r) => r.findings);
  const count = (s: Severity) => all.filter((f) => f.severity === s).length;
  lines.push("", `${reports.length} file${reports.length === 1 ? "" : "s"}, ${all.length} finding${all.length === 1 ? "" : "s"}: ${count("critical")} critical, ${count("high")} high, ${count("medium")} medium, ${count("low")} low. ${all.filter((f) => f.edits?.length).length} can be fixed with --fix.`);
  return lines.join("\n") + "\n";
}

export function main(argv = process.argv.slice(2)): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { format: { type: "string", default: "text" }, output: { type: "string" }, "fail-on": { type: "string", default: "high" }, fix: { type: "boolean" }, diff: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const failOn = values["fail-on"]!;
  if (!["low", "medium", "high", "critical", "never"].includes(failOn)) throw new Error(`--fail-on must be low, medium, high, critical or never, not "${failOn}".`);

  const files: string[] = [];
  for (const p of positionals.length ? positionals : ["."]) collect(p, files);
  const reports: FileReport[] = [];
  const patches: string[] = [];
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    const name = path.relative(process.cwd(), f) || f;
    if (!detect(name, body)) continue;
    let r = audit(name, body);
    if (values.fix || values.diff) {
      const fx = fix(name, body);
      if (fx.text !== body) {
        if (values.diff) patches.push(unifiedDiff(name, body, fx.text));
        else {
          writeFileSync(f, fx.text);
          r = fx.report;
        }
      }
    }
    reports.push(r);
  }

  if (values.diff) {
    process.stdout.write(patches.join(""));
    return 0;
  }
  const out = values.format === "json" ? JSON.stringify(reports.map(({ name, kind, grade, score, errors, findings }) => ({ name, kind, grade, score, errors, findings: findings.map(({ edits, ...f }) => ({ ...f, title: RULE[f.rule].title, fixable: !!edits?.length })) })), null, 2) + "\n" : values.format === "sarif" ? JSON.stringify(toSarif(reports), null, 2) + "\n" : text(reports);
  if (values.output) writeFileSync(values.output, out);
  else process.stdout.write(out);

  if (failOn === "never") return 0;
  const worst = Math.max(0, ...reports.flatMap((r) => r.findings.map((f) => SEVERITY_RANK[f.severity])));
  return worst >= SEVERITY_RANK[failOn as Severity] || reports.some((r) => r.errors.length) ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(`redline: ${(e as Error).message}\n`);
  process.exitCode = 2;
}
