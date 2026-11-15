export type Kind = "dockerfile" | "compose" | "kubernetes" | "nginx" | "sshd";
export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * A change to the file, by line. Lines `start` up to (not including) `end` are replaced by
 * `lines`, so `start === end` is a pure insertion before line `start`. Lines are 1-based.
 *
 * Edits that share a `merge.key` are combined into one insertion with the header written once,
 * so three rules that each add a field to a missing `securityContext:` produce one block.
 */
export type Edit = { start: number; end: number; lines: string[]; merge?: { key: string; header: string[] } };

export type Finding = {
  rule: string;
  severity: Severity;
  line: number;
  endLine?: number;
  /** Specific to this file: what is wrong on this line. */
  message: string;
  /** Present when the fix is safe to apply automatically. */
  edits?: Edit[];
};

export type Rule = {
  id: string;
  kind: Kind;
  title: string;
  severity: Severity;
  /** Plain English: what the setting does and why it is risky. */
  why: string;
  /** What to do about it. */
  fix: string;
  /** Whether Redline can usually fix it for you. */
  autofix: boolean;
  refs: { label: string; url: string }[];
};

export type FileReport = {
  name: string;
  kind: Kind | null;
  findings: Finding[];
  /** Parse problems: a file that can't be read is reported, not silently passed. */
  errors: string[];
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
};
