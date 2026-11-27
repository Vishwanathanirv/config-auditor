# Redline · Security review for config files

Redline reviews the config files that decide how secure a server is (**Dockerfiles, Docker Compose, Kubernetes manifests, nginx and sshd_config**). Every problem is underlined on its line and numbered in the gutter, with its severity, why it matters and how to fix it, plus a grade from A to F. It all updates as you type. For 37 of the 60 rules Redline writes the fix too, so you get a corrected file or a patch you can apply with `git apply`.

**Live demo: [redline-config-auditor.vercel.app](https://redline-config-auditor.vercel.app)**

It runs in the browser (nothing is uploaded), on the command line, as a GitHub Action that puts findings on pull requests, and as an API.

![A Dockerfile reviewed by Redline: flagged lines numbered in the gutter, annotations beside them, and the grade](docs/screenshots/editor.png)

## Why

Most breaches of small companies don't need clever exploits. They need a database port left open, a container running as root, a `.git` folder served by nginx, or a password written in a compose file. These mistakes live in config files that few people review line by line. Redline is that review: it explains each problem in words a busy developer understands and writes the fix, so the fix actually happens.

Some of the checks catch traps that experienced people still fall into:

- **sshd uses the first value it reads.** "Hardening" lines added at the bottom of `sshd_config` do nothing if the same setting appears earlier, or in an `Include`d file like Ubuntu's `50-cloud-init.conf`. Redline marks the line that really wins.
- **`PasswordAuthentication no` isn't enough** with `UsePAM yes`: keyboard-interactive login still asks for passwords.
- **nginx `alias` off-by-slash:** `location /static` with `alias /var/www/static/;` lets `/static../` read the folder above.
- **nginx `add_header` inheritance:** one `add_header` in a location silently drops every security header set on the server.
- **Docker bypasses ufw:** `"5432:5432"` in compose opens the database to the internet even with a firewall on. Redline rewrites it to `127.0.0.1:5432:5432`.

![The actions for one line, with its fix](docs/screenshots/quick-fix.png)

## Fixing

Three ways, all with undo:

- Click a **numbered marker** in the gutter to see that line's findings and fix them from there. **Fix all**, next to the grade, fixes everything that has an autofix (or press Ctrl .).
- Open **Fix preview** to see the fixes as a diff. Untick the ones you don't want, then apply them, download the fixed file, or copy them as a patch.
- Or just edit the file: it is checked again on every key press.

The **Findings** list under the file shows this file or all files; click one to jump to its line and read why it matters, with its source. On a phone the annotations beside the code are hidden and this list carries them. Your files and edits stay in your browser. Fixes are written as small line edits, so your comments and layout stay as they were, and several fixes to the same Kubernetes container are merged into one `securityContext` block.

![Fix preview](docs/screenshots/fix-preview.png)

![On a phone](docs/screenshots/mobile.png)

## Results

From `npm run evaluate` (the same files run as unit tests on every push):

| | |
| --- | --- |
| Labelled problems found | **72 of 72**, with no extra findings |
| False alarms on hardened configs | **0** across 6 configs built from Mozilla's nginx and OpenSSH guides and the Kubernetes "restricted" profile |
| Automatic fixes that remove their problem | **72 of 72**, checked by inspecting the fixed file again |
| Files still valid after fixing | **30 of 30** (YAML and nginx parsed again) |
| Time per file | **about 0.3 ms** |

**What this does and doesn't prove.** The 25 test files were written by hand and labelled with the problems they contain. Every rule is covered, but it is a small set: real configs with unusual layouts can still trip a rule or slip past one. The rules are pattern-based and don't know your context (a monitoring agent may really need host access), which is why each automatic fix can be unticked.

![The benchmark page](docs/screenshots/bench.png)

### On other projects' test files

The files above were written alongside the rules. `npm run bench` also runs Redline over
190 labelled test cases written by other projects: [KICS](https://github.com/Checkmarx/kics)
(Apache-2.0) for Dockerfile, Compose and Kubernetes, and [gixy-ng](https://pypi.org/project/gixy-ng/)
(MPL-2.0) for nginx. Only checks that mean the same thing as a Redline rule are counted. The rules
were tuned on a fixed 60% of the files; this table is the other 40%, which were not used for tuning:

| File type | Positive files | Negative files | Precision | Recall | False positives |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dockerfile | 6 | 5 | 100.0% | 83.3% | 0 |
| Docker Compose | 6 | 3 | 100.0% | 100.0% | 0 |
| Kubernetes | 14 | 11 | 100.0% | 100.0% | 0 |
| nginx | 18 | 16 | 88.2% | 83.3% | 2 |
| **All** | 44 | 35 | **95.2%** | **90.9%** | 2 |

Before tuning, the same held-out files scored 93.1% precision and 61.4% recall (nginx recall was
22.2%: Redline ignored config fragments without a `server` block). No public labelled suite for
`sshd_config` was found, so sshd isn't in this benchmark. Sources, scoring, the split and the
labels Redline deliberately disagrees with are in [bench/README.md](bench/README.md); full
numbers in [bench/RESULTS.md](bench/RESULTS.md).

## Engine

```mermaid
flowchart LR
  F[File] --> D{Detect type<br/>by name, then content}
  D --> DF[Dockerfile parser<br/>continuations, heredocs, stages]
  D --> Y[YAML with line numbers<br/>compose / Kubernetes]
  D --> N[nginx tokenizer<br/>blocks and inheritance]
  D --> S[sshd parser<br/>first value wins, Match blocks]
  DF & Y & N & S --> R[60 rules<br/>each finding has a line and optional edits]
  R --> G[Grade A to F]
  R --> E[Apply chosen edits<br/>merge, skip overlaps, re-check up to 3 rounds]
  E --> O[Corrected file / unified diff / SARIF]
```

- **Parsers that keep line numbers.** Each file type has its own parser, so findings point at the exact line. nginx is parsed into a tree so rules can follow how headers are inherited; sshd is parsed the way sshd reads it (first value wins, `Match` blocks apply only to some users).
- **Fixes are line edits, not reformatting.** A fix replaces or inserts lines at the right indentation. Edits that create the same block are merged; an edit that would overwrite a line another fix already changed is skipped. After applying, the file is inspected again, up to three rounds, because one fix can reveal another.
- **Grades.** Every finding costs points by severity (critical 30, high 12, medium 5, low 1). Any critical caps the grade at D, because one is enough to lose the machine.
- **SARIF 2.1.0** output with `security-severity` scores, so GitHub code scanning shows each finding on its line in the pull request.

## Run it

Requires Node 22.13+.

```bash
npm install
npm run dev          # web on :5173, API on :8080
npm test             # 98 unit and API tests
npm run test:e2e     # 18 browser tests (Playwright), including axe accessibility checks
npm run evaluate     # rebuild the test bench report
npm run bench        # precision and recall on KICS and gixy test files
```

### Command line

`action/redline.cjs` is a single file with no dependencies (Node 20+):

```bash
node action/redline.cjs .                        # check a whole repository
node action/redline.cjs infra/ --fail-on critical
node action/redline.cjs Dockerfile --diff        # show fixes as a patch
node action/redline.cjs Dockerfile k8s/ --fix    # apply them in place
node action/redline.cjs . --format sarif --output redline.sarif
```

Exit code 1 when anything at or above `--fail-on` (default `high`) is found, 2 on a usage error.

### In CI

The hosted site serves the same single-file CLI at `/redline.cjs`, with its SHA-256 at `/redline.cjs.sha256`, so any pipeline can fetch it. The site's **CLI, Action, API** page shows this workflow with the download pinned to the current release (`echo "<sha256>  redline.cjs" | sha256sum -c`), so a changed file stops the build instead of running:

```yaml
permissions:
  contents: read
  security-events: write
jobs:
  redline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Get Redline
        run: curl -fsSL -o redline.cjs https://redline-config-auditor.vercel.app/redline.cjs
      - name: Write the report
        run: node redline.cjs . --format sarif --output redline.sarif --fail-on never
      - name: Check
        run: node redline.cjs . --fail-on high
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: redline.sarif
```

This repository's own CI runs Redline on its own Dockerfile.

### API and Docker

```bash
docker build -t redline .
docker run -p 8080:8080 redline
```

| Endpoint | What it does |
| --- | --- |
| `POST /api/audit` | `{ "files": [{ "name", "text", "kind?" }], "format?": "json" \| "sarif" }` |
| `POST /api/fix` | `{ "name", "text", "rules?": ["DF002"] }` returns the corrected text, a patch, and before/after reports |
| `GET /api/rules` | Every rule with its explanation, fix and references |
| `GET /api/health` | Health check |

Nothing sent to the API is stored.

### Live demo on Vercel

Import the repository into Vercel. `vercel.json` builds the static site, which runs every check in the browser. No keys are needed.

## Limits

- **Rules:** 60 in total. 37 have an automatic fix; 23 report only. By type (rules, with fix): Dockerfile 14 (6), Compose 8 (3), Kubernetes 15 (7), nginx 11 (10), sshd 12 (11).
- **Not covered:** runtime state, images and their contents, Terraform, CloudFormation, Helm charts, and anything outside the five file types.
- **Not a clean bill of health:** an A grade means none of the 60 rules fired, not that the config is secure.
- One file at a time: Redline doesn't follow `Include` in nginx or sshd, and doesn't connect a compose file to the Dockerfile it builds.
- Kubernetes checks read plain manifests. Helm templates need `helm template` first; Kustomize needs `kustomize build`.
- Some problems need a person: Redline won't guess which version to pin or how much memory a pod needs, so those findings come without a fix.
- Fixes that change behaviour (a non-root user, a read-only filesystem) should be tested before shipping.
- sshd has no public labelled test suite, so it is covered only by this repository's own tests.

The threat model and what is not defended are in [SECURITY.md](SECURITY.md).

## Why TypeScript

Redline parses untrusted files, so its parsers are plain text-to-data functions with no execution or file access. TypeScript lets the same rule code run in the browser, the CLI, the API and the Action, and the CLI ships as one dependency-free file. Memory safety comes from the runtime; correctness comes from the typed rule tables and the tests. The cost is Node as a requirement.

## Measured

Developer laptop (Windows 11), Node v24.21.0, 2026-11-27. Times differ on other machines.

`npm run timing` (`scripts/timing.ts`): time for one `audit()` call, 50 runs after 5 warm-up runs. **Synthetic inputs:** each built-in sample repeated N times (YAML as separate documents), so they are not real-world files.

| Input | Size | Lines | p50 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Dockerfile x1 | 0.4 KB | 20 | 0.17 ms | 0.34 ms |
| Dockerfile x100 | 42.6 KB | 1,901 | 6.67 ms | 10.23 ms |
| Compose x1 | 0.6 KB | 34 | 1.93 ms | 4.03 ms |
| Compose x100 | 60.3 KB | 3,400 | 108.33 ms | 272.05 ms |
| Kubernetes x1 | 1.0 KB | 56 | 2.12 ms | 6.23 ms |
| Kubernetes x100 | 103.0 KB | 5,600 | 252.24 ms | 384.05 ms |
| nginx x1 | 1.0 KB | 45 | 0.46 ms | 12.17 ms |
| nginx x100 | 96.7 KB | 4,401 | 24.52 ms | 90.70 ms |
| sshd x1 | 0.4 KB | 16 | 0.10 ms | 0.25 ms |
| sshd x100 | 36.1 KB | 1,501 | 2.93 ms | 4.70 ms |

The command also prints the x10 rows and findings per rule over the 25 labelled fixtures: 72 findings, and all 60 rules fire at least once. Accuracy numbers are under Results (`npm run evaluate`, `npm run bench`). Not measured: memory use, and time near the API's 500,000-character cap.

## Tech stack

TypeScript · yaml · Fastify 5 · zod · React 19 · Vite 6 · Tailwind CSS 4 · Vitest · Playwright · esbuild · Docker · GitHub Actions

## Licence

MIT
