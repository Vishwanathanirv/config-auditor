# Redline · Spec

## Problem
Small-team breaches come from config mistakes (root containers, open database ports, secrets in images, nginx traversal, sshd settings that never apply). Few people review these files line by line, and linters answer with rule ids.

## Core (MVP)
Paste or open a config file, see each problem on its line with why and how to fix, apply the fix.

## Flow
1. Files: example project opens (labelled Example); New file or Open files… (max 20 files, 1 MB each)
2. Annotated: underlined lines, numbered gutter markers, annotations beside lines, grade A–F with score
3. Line menu: findings for that line, Fix (all instances), Details
4. Findings list: this file or all files; why, what to do, source; Fix it
5. Fix preview: diff of autofixes, untick any, Apply, Download, Copy as patch; Undo on every change
6. Rules: all 60, filter by type, search
7. Benchmark: `evaluation.json` and `benchmark.json`
8. CLI, Action, API: pinned-SHA workflow, CLI, pre-commit hook, Docker

## Data
Browser localStorage only:
| Key | Holds |
| --- | --- |
| redline-files-v1 | the user's own files |
| redline-edits-v1 | edits to the example files |

## API (apps/api)
| Route | Body |
| --- | --- |
| POST /api/audit | `{ files: [{ name, text, kind? }], format?: json \| sarif }` |
| POST /api/fix | `{ name, text, rules? }` → fixed text, patch, before/after |
| GET /api/rules · /api/health | |
Limits: 120 requests/min per IP, 5 MB body. Nothing stored.

## States
- Loading: benchmark page shows skeleton lines.
- Empty: no findings → "Nothing to fix here"; unknown file → choose type; missing file → open the example.
- Errors: parse error shown above the editor; files over 1 MB or past 20 listed as not opened; benchmark missing → how to generate it.

## Out of scope
Following `Include`, Helm/Kustomize rendering, guessing versions or resource limits.
