import type { ReactNode } from "react";

const ACTION = `name: Config audit
on: [push, pull_request]

permissions:
  contents: read
  security-events: write   # lets findings show up on pull requests

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
          sarif_file: redline.sarif`;

const CLI = `# Get it once: a single file, no install
curl -fsSL -o redline.cjs https://redline-config-auditor.vercel.app/redline.cjs

# Check a whole repository (folders are searched, node_modules skipped)
node redline.cjs .

# Only fail the build on critical problems
node redline.cjs infra/ --fail-on critical

# See the fixes as a patch, or apply them in place
node redline.cjs Dockerfile --diff
node redline.cjs Dockerfile k8s/ --fix

# Machine-readable output
node redline.cjs . --format sarif --output redline.sarif
node redline.cjs . --format json`;

const API = `curl -s https://your-redline.example/api/audit \\
  -H "content-type: application/json" \\
  -d '{"files": [{"name": "Dockerfile", "text": "FROM node\\nCMD node app.js"}]}'

# Get the corrected file and a patch, for the rules you choose
curl -s https://your-redline.example/api/fix \\
  -H "content-type: application/json" \\
  -d '{"name": "Dockerfile", "text": "...", "rules": ["DF002", "DF011"]}'`;

const HOOK = `#!/bin/sh
# Save as .git/hooks/pre-commit and make it executable.
node tools/redline.cjs $(git diff --cached --name-only --diff-filter=ACM) --fail-on high`;

function Step({ title, children, code }: { title: string; children: ReactNode; code: string }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div>
        <h2 className="typed text-[13px] font-bold uppercase tracking-[0.14em]">{title}</h2>
        <div className="mt-1 text-[14.5px] leading-relaxed text-muted">{children}</div>
      </div>
      <pre tabIndex={0} aria-label={`${title}: example`} className="code margin-rule overflow-x-auto border-y border-dashed border-line bg-panel px-4 py-3 text-[13px]">{code}</pre>
    </section>
  );
}

export function UseIt() {
  return (
    <div className="max-w-6xl">
      <div className="typed text-[11px] uppercase tracking-[0.18em] text-muted">Paperwork</div>
      <h1 className="mt-1 text-[1.8rem] font-bold leading-tight">Put it where configs change</h1>
      <p className="mt-3 max-w-2xl text-[1.02rem] leading-relaxed text-muted">The checks on this desk are the same code as the command line, the GitHub Action and the API, so a problem you see here is the one your pipeline will stop.</p>
      <div className="mt-8 space-y-10">
        <Step title="On every pull request" code={ACTION}>
          This workflow checks the repository and uploads the results to GitHub code scanning, so each problem appears on the line that caused it in the pull request. The build fails on anything high or worse; change <code className="font-mono">--fail-on</code> to adjust.
        </Step>
        <Step title="From the command line" code={CLI}>
          One file, no install: <code className="font-mono">redline.cjs</code>, served by this site, runs on Node 20 or newer. <code className="font-mono">--diff</code> prints a patch you can read before applying with <code className="font-mono">git apply</code>.
        </Step>
        <Step title="Before each commit" code={HOOK}>
          A pre-commit hook checks only the files you are committing, so it takes milliseconds.
        </Step>
        <Step title="As a service" code={API}>
          Run it with Docker (<code className="font-mono">docker run -p 8080:8080 redline</code>) to get this site and the API. It keeps nothing: each request is checked and forgotten.
        </Step>
      </div>
    </div>
  );
}
