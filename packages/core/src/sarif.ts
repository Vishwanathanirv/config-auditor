import { RULE, RULES } from "./audit";
import type { FileReport, Severity } from "./types";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = { critical: "error", high: "error", medium: "warning", low: "note" };
const SCORE: Record<Severity, string> = { critical: "9.5", high: "8.0", medium: "5.5", low: "2.0" };

/** SARIF 2.1.0, the format GitHub code scanning reads, so findings show up on pull requests. */
export function toSarif(reports: FileReport[], version = "1.0.0") {
  const used = new Set(reports.flatMap((r) => r.findings.map((f) => f.rule)));
  const rules = RULES.filter((r) => used.has(r.id));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Redline",
            version,
            informationUri: "https://github.com/Vishwanathanirv/config-auditor",
            rules: rules.map((r) => ({
              id: r.id,
              name: r.title.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")),
              shortDescription: { text: r.title },
              fullDescription: { text: r.why },
              help: { text: `${r.why}\n\nFix: ${r.fix}`, markdown: `${r.why}\n\n**Fix:** ${r.fix}\n\n${r.refs.map((x) => `- [${x.label}](${x.url})`).join("\n")}` },
              helpUri: r.refs[0]?.url,
              defaultConfiguration: { level: LEVEL[r.severity] },
              properties: { "security-severity": SCORE[r.severity], tags: ["security", r.kind] },
            })),
          },
        },
        results: reports.flatMap((rep) =>
          rep.findings.map((f) => ({
            ruleId: f.rule,
            level: LEVEL[f.severity],
            message: { text: `${f.message.replace(/`/g, "'")} ${RULE[f.rule].fix.replace(/`/g, "'")}` },
            locations: [{ physicalLocation: { artifactLocation: { uri: rep.name.replace(/\\/g, "/").replace(/^\.\//, "") }, region: { startLine: f.line, ...(f.endLine && f.endLine > f.line ? { endLine: f.endLine } : {}) } } }],
            properties: { severity: f.severity },
          })),
        ),
      },
    ],
  };
}
