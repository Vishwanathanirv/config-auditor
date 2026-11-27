# Security

## Scope

Redline reads configuration files (Dockerfile, Docker Compose, Kubernetes, nginx, sshd_config) and reports mistakes. In scope for reports:

- The parsers and rules in `packages/core`, the CLI (`packages/cli`), the GitHub Action (`action.yml`), the API (`apps/api`) and the web app (`apps/web`).
- A crafted input that crashes, hangs, or makes any of them write or execute something it should not.
- An autofix that makes a config less secure than before.

Wrong or missing findings are bugs, not vulnerabilities: open a normal issue.

## Supported versions

`main` only. There are no maintained release branches.

## Reporting

Use GitHub private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Please do not open a public issue for a vulnerability.

This is a hobby project maintained in spare time. There is no response-time guarantee.

## Threat model

**Assets**

- The machine or CI runner that runs the CLI or Action, and the repository contents on it.
- The API host.
- The user's files in the browser (localStorage).
- The integrity of the CLI bundle that pipelines download.

**Attackers**

- Someone who controls a config file Redline reads (a pull request from a fork, a downloaded manifest).
- Someone who sends requests to a public API instance.
- Someone who tampers with the downloaded `redline.cjs`.

**Trust boundaries**

- Config file to parser: all file content is untrusted. Parsers only read text; nothing in a file is executed or fetched.
- Network to API: request bodies are untrusted.
- CI to Redline: the Action runs with the repository checked out and the permissions of the workflow.
- Hosted site to pipeline: the CLI is fetched over HTTPS and can be pinned by SHA-256.

**What Redline defends against**

- Config content causing code execution or network access: the core turns text into findings, with no `eval`, no shell, no network and no `Include` following.
- Oversized input: size caps in the API and CLI (below).
- Silent tampering of the downloaded CLI: the documented workflow checks a SHA-256 before running it.
- Unwanted fixes: fixes are applied only on request (`--fix`, the Fix buttons, or `/api/fix`) and are line edits that are re-audited afterwards.

**What Redline does NOT protect against**

- False negatives. A clean report or an A grade does not mean a config is secure.
- Anything outside the 60 rules. Rules are pattern-based and know nothing about your environment.
- Runtime state: it does not scan running containers, clusters, images, hosts, or dependencies.
- Settings spread across files: includes, Helm and Kustomize output, and compose-to-Dockerfile links are not followed.
- A compromised hosting account, CDN or DNS for the demo site. Pinning the SHA-256 in your pipeline is the mitigation.
- Abuse of a public API by many clients (see limitations).

## Security controls in code

| Control | Where |
| --- | --- |
| Request schema validation (zod): max 50 files, 500,000 characters per file, name length, allowed kinds | `apps/api/src/app.ts` |
| 5 MB body limit, 120 requests per minute per IP | `apps/api/src/app.ts` |
| Security headers via `@fastify/helmet` | `apps/api/src/app.ts` |
| Handlers are stateless: no database, no file writes | `apps/api/src/app.ts` |
| CLI skips files of 1 MB or more and `node_modules`, `.git`, `dist` and similar folders | `packages/cli/src/cli.ts` |
| CLI writes files only with `--fix` or `--output` | `packages/cli/src/cli.ts` |
| Action passes inputs through `env`, not inline in the script, so inputs cannot inject shell | `action.yml` |
| Bounded table size in patch generation | `packages/core/src/diff.ts` |
| Fixes re-audited up to 3 rounds; overlapping edits skipped | `packages/core/src/edits.ts` |
| CI fails if the committed CLI bundle, its SHA-256 or the benchmark output differs from the source | `.github/workflows/ci.yml` |
| Container image runs as `USER node` with production dependencies only | `Dockerfile` |
| Web app runs every check in the browser; files stay in localStorage | `apps/web/src` |

## Known limitations

- The API sets no `trustProxy`: behind a reverse proxy, the rate limit may count the proxy as one client.
- The API has no authentication.
- The Content-Security-Policy header is turned off in the API (`contentSecurityPolicy: false`).
- The CLI follows symlinks when reading files.
- The 500,000-character cap bounds input, but audit time still grows with size and was not measured near the cap. See the timing table in the README.
- Parsing uses the `yaml` library with its defaults; no custom alias or depth limit is set.
- The demo site is static hosting; its availability and integrity are those of the host.

## Dependency hygiene

- Versions are locked in `package-lock.json`; CI installs with `npm ci`.
- The CLI bundle has no runtime dependencies. The API image installs only the API workspace's production dependencies.
- There is no dependency update bot and no scheduled audit job. `npm audit` is run by hand.
