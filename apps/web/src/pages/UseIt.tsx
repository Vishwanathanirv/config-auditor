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
      - uses: Vishwanathanirv/config-auditor@main
        with:
          path: .
          fail-on: high
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: redline.sarif`;

const CLI = `# Check a whole repository (folders are searched, node_modules skipped)
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
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="mt-1 text-[14.5px] leading-relaxed text-muted">{children}</div>
      </div>
      <pre className="printout typed overflow-x-auto py-3 text-[13px] [&]:px-12">{code}</pre>
    </section>
  );
}

export function UseIt() {
  return (
    <div className="max-w-6xl">
      <h1 className="text-[2.2rem] font-bold leading-[1.05] tracking-[-0.02em]">Put it where configs change</h1>
      <p className="mt-3 max-w-2xl text-[1.02rem] leading-relaxed text-muted">The checks on the desk are the same code as the command line, the GitHub Action and the API, so a problem you see here is the one your pipeline will stop.</p>
      <div className="mt-8 space-y-10">
        <Step title="On every pull request" code={ACTION}>
          The GitHub Action checks the repository and uploads the results to GitHub code scanning, so each problem appears on the line that caused it in the pull request. The build fails on anything high or worse; change <code className="font-type">fail-on</code> to adjust.
        </Step>
        <Step title="From the command line" code={CLI}>
          One file, no install: <code className="font-type">redline.cjs</code> from the repository's <code className="font-type">action</code> folder runs on Node 20 or newer. <code className="font-type">--diff</code> prints a patch you can read before applying with <code className="font-type">git apply</code>.
        </Step>
        <Step title="Before each commit" code={HOOK}>
          A pre-commit hook checks only the files you are committing, so it takes milliseconds.
        </Step>
        <Step title="As a service" code={API}>
          Run it with Docker (<code className="font-type">docker run -p 8080:8080 redline</code>) to get this site and the API. It keeps nothing: each request is checked and forgotten.
        </Step>
      </div>
    </div>
  );
}
