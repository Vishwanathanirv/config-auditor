import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { applyEdits, audit, detect, fix, RULES, SAMPLES, toSarif, unifiedDiff } from "../src";
import { parseNginx } from "../src/nginx";
import { FIXTURES } from "./fixtures";

describe("labelled fixtures", () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const r = audit(f.file, f.text);
      expect(r.errors).toEqual([]);
      expect(r.findings.map((x) => x.rule).sort()).toEqual([...f.expect].sort());
    });
  }

  it("covers every rule at least once", () => {
    const hit = new Set(FIXTURES.flatMap((f) => f.expect));
    expect(RULES.filter((r) => !hit.has(r.id)).map((r) => r.id)).toEqual([]);
  });
});

describe("fixes", () => {
  for (const f of [...FIXTURES.map((x) => ({ name: x.file, text: x.text, label: x.name })), ...SAMPLES.map((s) => ({ ...s, label: s.name }))]) {
    it(`fixing "${f.label}" leaves a valid file with those problems gone`, () => {
      const before = audit(f.name, f.text);
      const fixable = new Set(before.findings.filter((x) => x.edits?.length).map((x) => x.rule));
      const r = fix(f.name, f.text);
      expect(r.report.errors).toEqual([]);
      if (before.kind === "compose" || before.kind === "kubernetes") expect(() => parse(r.text.split(/^---$/m)[0])).not.toThrow();
      if (before.kind === "nginx") expect(parseNginx(r.text).errors).toEqual([]);
      for (const left of r.report.findings) expect(fixable.has(left.rule) && left.edits?.length, `${left.rule} still there: ${left.message}`).toBeFalsy();
      expect(r.report.score).toBeGreaterThanOrEqual(before.score);
    });
  }

  it("merges several securityContext fields into one block", () => {
    const k8s = SAMPLES.find((s) => s.name.endsWith(".yaml"))!;
    const out = fix(k8s.name, k8s.text).text;
    expect(out.match(/securityContext:/g)).toHaveLength(1);
    const doc = parse(out.split(/^---$/m)[0]);
    expect(doc.spec.template.spec.containers[0].securityContext).toEqual({ runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } });
    expect(doc.spec.template.spec.automountServiceAccountToken).toBe(false);
  });

  it("removes the earlier sshd line so the hardening at the bottom takes effect", () => {
    const s = FIXTURES.find((f) => f.name.startsWith("Hardening appended"))!;
    const out = fix(s.file, s.text).text;
    expect(out).not.toMatch(/PasswordAuthentication yes/);
    expect(out).toMatch(/PasswordAuthentication no/);
  });

  it("skips a fix that would overwrite a line another fix already changed", () => {
    const r = applyEdits("a\nb\nc", [
      { rule: "X1", severity: "low", line: 2, message: "", edits: [{ start: 2, end: 3, lines: ["B1"] }] },
      { rule: "X2", severity: "low", line: 2, message: "", edits: [{ start: 2, end: 3, lines: ["B2"] }] },
    ]);
    expect(r.text).toBe("a\nB1\nc");
    expect(r.skipped).toEqual(["X2"]);
  });

  it("keeps Windows line endings", () => {
    const text = "FROM alpine:3.20\r\nMAINTAINER me\r\nUSER 1\r\nCMD [\"x\"]\r\n";
    expect(fix("Dockerfile", text).text).toBe('FROM alpine:3.20\r\nLABEL maintainer="me"\r\nUSER 1\r\nCMD ["x"]\r\n');
  });

  it("writes a patch that git can apply", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "redline-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    for (const s of SAMPLES) {
      const p = path.join(dir, s.name);
      execFileSync("mkdir", ["-p", path.dirname(p)]);
      writeFileSync(p, s.text);
      const patch = unifiedDiff(s.name, s.text, fix(s.name, s.text).text);
      writeFileSync(path.join(dir, "fix.patch"), patch);
      execFileSync("git", ["apply", "--check", "fix.patch"], { cwd: dir });
    }
  });
});

describe("detection and reports", () => {
  it("recognises files by name and by content", () => {
    expect(detect("Dockerfile.prod", "")).toBe("dockerfile");
    expect(detect("api.Dockerfile", "")).toBe("dockerfile");
    expect(detect("compose.yaml", "services:\n  a: {}")).toBe("compose");
    expect(detect("whatever.yaml", "apiVersion: v1\nkind: Pod\n")).toBe("kubernetes");
    expect(detect("default", "server {\n listen 80;\n}")).toBe("nginx");
    expect(detect("config", "PermitRootLogin no\n")).toBe("sshd");
    expect(detect("notes.txt", "hello")).toBeNull();
  });

  it("reports broken files instead of passing them", () => {
    expect(audit("x.yaml", "apiVersion: v1\nkind: Pod\nspec: [\n").errors.length).toBeGreaterThan(0);
    expect(audit("x.conf", "server {\n listen 80;\n").errors[0]).toMatch(/never closed/);
  });

  it("grades a critical finding no better than D", () => {
    const r = audit("docker-compose.yml", "services:\n  a:\n    image: x:1\n    privileged: true\n");
    expect(r.score).toBe(70);
    expect(r.grade).toBe("D");
  });

  it("produces SARIF that GitHub code scanning accepts", () => {
    const reports = SAMPLES.map((s) => audit(s.name, s.text));
    const sarif = toSarif(reports);
    const run = sarif.runs[0];
    expect(run.results.length).toBe(reports.reduce((n, r) => n + r.findings.length, 0));
    const ids = new Set(run.tool.driver.rules.map((r) => r.id));
    for (const res of run.results) {
      expect(ids.has(res.ruleId)).toBe(true);
      expect(res.locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
    }
  });
});
