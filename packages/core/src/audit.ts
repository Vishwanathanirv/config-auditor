import { COMPOSE_RULES, checkCompose } from "./compose";
import { checkDockerfile, DOCKERFILE_RULES } from "./dockerfile";
import { applyEdits } from "./edits";
import { checkKubernetes, KUBERNETES_RULES } from "./kubernetes";
import { checkNginx, NGINX_RULES } from "./nginx";
import { checkSshd, looksLikeSshd, SSHD_RULES } from "./sshd";
import { SEVERITY_RANK, type FileReport, type Finding, type Kind, type Rule, type Severity } from "./types";
import { get, isMap, Yaml } from "./yamlkit";

export const RULES: Rule[] = [...DOCKERFILE_RULES, ...COMPOSE_RULES, ...KUBERNETES_RULES, ...NGINX_RULES, ...SSHD_RULES];
export const RULE = Object.fromEntries(RULES.map((r) => [r.id, r])) as Record<string, Rule>;

export const KIND_NAME: Record<Kind, string> = { dockerfile: "Dockerfile", compose: "Docker Compose", kubernetes: "Kubernetes", nginx: "nginx", sshd: "SSH server" };

/** Works out what a file is from its name, falling back to its contents. */
export function detect(name: string, text: string): Kind | null {
  const base = name.split(/[\\/]/).pop()!.toLowerCase();
  if (/(^|\.)dockerfile$|^dockerfile(\.|-|$)|\.dockerfile$|^containerfile$/.test(base)) return "dockerfile";
  if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(base)) return "compose";
  if (/sshd_config|sshd.*\.conf$/.test(base)) return "sshd";
  if (/nginx|\.conf$/.test(base) && /\b(server|http|location|upstream)\s*[^;]*\{/.test(text)) return "nginx";
  if (/\.ya?ml$/.test(base) || /^\s*(apiVersion|services|kind):/m.test(text)) {
    if (/^apiVersion:/m.test(text) && /^kind:/m.test(text)) return "kubernetes";
    if (/^services:/m.test(text)) return "compose";
  }
  if (/^\s*FROM\s+\S+/im.test(text) && /^\s*(RUN|CMD|COPY|ENTRYPOINT)\s/im.test(text)) return "dockerfile";
  if (/\b(server|http)\s*\{/.test(text) && /;\s*$/m.test(text)) return "nginx";
  if (looksLikeSshd(text)) return "sshd";
  return null;
}

const WEIGHT: Record<Severity, number> = { critical: 30, high: 12, medium: 5, low: 1 };

/** 100 minus a weight per finding. Any critical caps the grade at D: one is enough to lose the host. */
export function grade(findings: Finding[]): { score: number; grade: FileReport["grade"] } {
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + WEIGHT[f.severity], 0));
  const critical = findings.some((f) => f.severity === "critical");
  const g = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade: critical && "ABC".includes(g) ? "D" : g };
}

export function audit(name: string, text: string, forceKind?: Kind): FileReport {
  const kind = forceKind ?? detect(name, text);
  let findings: Finding[] = [];
  const errors: string[] = [];
  if (kind === "dockerfile") findings = checkDockerfile(text);
  else if (kind === "nginx") {
    const r = checkNginx(text);
    findings = r.findings;
    errors.push(...r.errors);
  } else if (kind === "sshd") findings = checkSshd(text);
  else if (kind === "compose" || kind === "kubernetes") {
    const y = new Yaml(text);
    errors.push(...y.errors);
    if (!errors.length) findings = kind === "compose" ? checkCompose(y) : checkKubernetes(y);
    if (kind === "compose" && !y.docs.some((d) => isMap(get(d.contents, "services")))) errors.push("No `services:` found, so this doesn't look like a compose file.");
  }
  findings.sort((a, b) => a.line - b.line || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return { name, kind, findings, errors, ...grade(findings) };
}

/**
 * Applies fixes and checks the result again, up to three rounds, because one fix can reveal
 * another (adding a header to a server can make a location that overrides headers lose it).
 * Only rules in `only` are fixed when given.
 */
export function fix(name: string, text: string, only?: Set<string>): { text: string; fixed: string[]; report: FileReport } {
  let cur = text;
  const fixed: string[] = [];
  let report = audit(name, cur);
  for (let round = 0; round < 3; round++) {
    const todo = report.findings.filter((f) => f.edits?.length && (!only || only.has(f.rule)));
    if (!todo.length) break;
    const r = applyEdits(cur, todo);
    if (r.text === cur) break;
    cur = r.text;
    fixed.push(...r.applied);
    report = audit(name, cur, report.kind ?? undefined);
    if (report.errors.length) break;
  }
  return { text: cur, fixed, report };
}
