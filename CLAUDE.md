# Redline

Security review for Dockerfiles, Docker Compose, Kubernetes, nginx and sshd_config. TypeScript monorepo: `packages/core` (parsers, 60 rules, autofix, grading, SARIF), `packages/cli` (single-file CLI, built to `action/redline.cjs` and `apps/web/public/redline.cjs`), `apps/api` (Fastify 5), `apps/web` (Vite + React 19 + Tailwind 4, static, runs every check in the browser).

## Commands
- `npm run dev` (web :5173, API :8080) · `npm run build`
- `npm run lint && npm run typecheck && npm test` before every commit
- `npm run test:e2e` (Playwright + axe) · `npm run evaluate` · `npm run bench`

## Rules
- One dark theme, IBM Plex Sans and Plex Mono, signal red accent. No italics, no intro modal, no "How it works" or "Try it", no handwriting or stamp styling.
- Every finding has a line, a severity, why, fix and a source reference.
- Fixes are line edits that keep comments and layout; the fixed file is re-audited.
- Files stay in the browser (localStorage). The API stores nothing and is rate limited (120/min).
- Benchmark numbers come only from `npm run evaluate` and `npm run bench`.
- No personal details or repo links in code, UI or metadata.
