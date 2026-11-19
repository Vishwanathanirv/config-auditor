import { insertBefore, replaceLine } from "./edits";
import type { Edit, Finding, Rule } from "./types";

export type Instr = { cmd: string; args: string; line: number; endLine: number; stage: number };
export type Stage = { line: number; image: string; alias?: string };

/** The escape character set by a `# escape=` parser directive at the top of the file (default `\`). */
export function escapeChar(lines: string[]): string {
  for (const l of lines) {
    const m = l.match(/^\s*#\s*([a-z]+)\s*=\s*(\S+)\s*$/i);
    if (!m) break; // directives must come before anything else, comments included
    if (m[1].toLowerCase() === "escape" && (m[2] === "`" || m[2] === "\\")) return m[2];
  }
  return "\\";
}

/**
 * Splits a Dockerfile into instructions, joining line continuations (also across the comment
 * and blank lines Docker allows inside them) and keeping heredoc bodies with their instruction.
 */
export function parseDockerfile(text: string): { instrs: Instr[]; stages: Stage[]; lines: string[] } {
  const lines = text.split(/\r?\n/);
  const instrs: Instr[] = [];
  const stages: Stage[] = [];
  const esc = escapeChar(lines);
  const trailing = new RegExp(`${esc === "`" ? "`" : "\\\\"}\\s*$`);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) {
      i++;
      continue;
    }
    const start = i;
    let body = raw;
    let cont = trailing.test(raw);
    while (cont && i + 1 < lines.length) {
      i++;
      const t = lines[i].trim();
      if (!t || t.startsWith("#")) continue;
      body = body.replace(trailing, " ") + t;
      cont = trailing.test(lines[i]);
    }
    const m = body.trim().match(/^(\w+)\s*(.*)$/s);
    if (m) {
      const cmd = m[1].toUpperCase();
      let args = m[2].trim();
      // Heredoc: RUN <<EOF ... EOF. The body is part of the command, so it is checked too.
      const hd = args.match(/<<-?["']?(\w+)["']?/);
      let end = i;
      if (hd) {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== hd[1]) j++;
        end = Math.min(j, lines.length - 1);
        args += "\n" + lines.slice(i + 1, j).join("\n");
        i = end;
      }
      if (cmd === "FROM") {
        const parts = args.split(/\s+/).filter((p) => !p.startsWith("--"));
        stages.push({ line: start + 1, image: parts[0] ?? "", alias: /^as$/i.test(parts[1] ?? "") ? parts[2] : undefined });
      }
      instrs.push({ cmd, args, line: start + 1, endLine: end + 1, stage: Math.max(0, stages.length - 1) });
    }
    i++;
  }
  return { instrs, stages, lines };
}

const SECRET_NAME = /(pass(word|wd)?|secret([_-]?key)?|token|api[_-]?key|private[_-]?key|access[_-]?key|credentials?|auth)$/i;
const ref = (label: string, url: string) => ({ label, url });
const CIS = ref("CIS Docker Benchmark", "https://www.cisecurity.org/benchmark/docker");
const BP = ref("Docker build best practices", "https://docs.docker.com/build/building/best-practices/");

export const DOCKERFILE_RULES: Rule[] = [
  { id: "DF001", kind: "dockerfile", title: "Base image is not pinned", severity: "medium", autofix: false, why: "Without a version tag, `latest` is used. The image can change under you between builds, so a build that worked yesterday can break, or pull in a compromised release, today.", fix: "Pin a version, like `node:22.13-alpine`, or a digest (`@sha256:…`) for fully repeatable builds.", refs: [CIS, BP] },
  { id: "DF002", kind: "dockerfile", title: "Container runs as root", severity: "high", autofix: true, why: "With no `USER`, the app runs as root inside the container. If the app is broken into, the attacker is root, which makes escaping to the host far easier.", fix: "Add `USER` with a non-root user before `CMD`. Official Node images ship a `node` user; otherwise use a numeric id like `10001`.", refs: [CIS, ref("OWASP Docker Security Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html")] },
  { id: "DF003", kind: "dockerfile", title: "Secret baked into the image", severity: "critical", autofix: false, why: "`ENV` and `ARG` values are saved in the image layers and history. Anyone who can pull the image can read them with `docker history` or `docker inspect`.", fix: "Pass secrets at run time (`docker run -e`, Kubernetes Secrets), or use build secrets: `RUN --mount=type=secret,id=npm_token …`.", refs: [ref("Docker build secrets", "https://docs.docker.com/build/building/secrets/"), CIS] },
  { id: "DF004", kind: "dockerfile", title: "ADD used instead of COPY", severity: "low", autofix: true, why: "`ADD` also downloads URLs and unpacks archives, which is surprising. For a remote URL, nothing checks that the file is the one you expect.", fix: "Use `COPY` for local files. For downloads, use `ADD --checksum=sha256:…` or `curl` followed by a checksum check.", refs: [BP] },
  { id: "DF005", kind: "dockerfile", title: "Script piped straight into a shell", severity: "high", autofix: false, why: "`curl … | sh` runs whatever the server sends at build time. If the site or the connection is compromised, so is your image, and nothing records what ran.", fix: "Download the script, check its checksum, then run it. Better still, install from a package manager.", refs: [BP] },
  { id: "DF006", kind: "dockerfile", title: "Package cache left in the image", severity: "low", autofix: true, why: "`apt-get install` without `--no-install-recommends` and without cleaning `/var/lib/apt/lists` makes the image bigger and adds packages you never asked for, each one more to patch.", fix: "Use `apt-get install -y --no-install-recommends …` and end the same `RUN` with `rm -rf /var/lib/apt/lists/*`.", refs: [BP] },
  { id: "DF007", kind: "dockerfile", title: "sudo inside the image", severity: "medium", autofix: false, why: "`sudo` in a container is a sign the image expects to switch to root, and it gives an attacker an easy way back to root.", fix: "Run root steps before `USER`, then drop privileges. Remove the `sudo` package.", refs: [CIS] },
  { id: "DF008", kind: "dockerfile", title: "World-writable permissions", severity: "medium", autofix: false, why: "`chmod 777` lets any process in the container change those files, including replacing your code.", fix: "Give ownership to the app user (`chown`, or `COPY --chown`) and use 755 for directories and 644 for files.", refs: [CIS] },
  { id: "DF009", kind: "dockerfile", title: "SSH port exposed", severity: "medium", autofix: false, why: "Running an SSH server inside a container adds keys to manage and a login service to attack. You can already get a shell with `docker exec` or `kubectl exec`.", fix: "Remove the SSH server and `EXPOSE 22`.", refs: [CIS] },
  { id: "DF010", kind: "dockerfile", title: "Deprecated MAINTAINER", severity: "low", autofix: true, why: "`MAINTAINER` was deprecated in favour of labels.", fix: 'Use `LABEL maintainer="…"`.', refs: [BP] },
  { id: "DF011", kind: "dockerfile", title: "CMD in shell form", severity: "low", autofix: true, why: "In shell form, `/bin/sh` is process 1 and does not pass on stop signals. Your app never hears `SIGTERM`, so it can't shut down cleanly and gets killed after the timeout.", fix: 'Use exec form: `CMD ["node", "server.js"]`.', refs: [BP] },
  { id: "DF012", kind: "dockerfile", title: "TLS checks turned off", severity: "high", autofix: false, why: "Flags like `curl -k`, `--no-check-certificate` or `--trusted-host` skip certificate checks, so anyone on the network path can swap the download.", fix: "Remove the flag. If a corporate proxy is in the way, add its CA certificate to the image instead.", refs: [BP] },
  { id: "DF013", kind: "dockerfile", title: "Private files copied into the image", severity: "high", autofix: false, why: "Keys, `.env` files and registry credentials copied into a layer stay in the image even if a later step deletes them.", fix: "Remove the copy and list these files in `.dockerignore`. Use build secrets for anything the build needs.", refs: [ref("Docker build secrets", "https://docs.docker.com/build/building/secrets/")] },
  { id: "DF014", kind: "dockerfile", title: "Dependencies installed loosely", severity: "low", autofix: true, why: "`npm install` can resolve different versions from build to build, and `pip install` without `--no-cache-dir` keeps a download cache in the image.", fix: "Use `npm ci` with a lockfile, and `pip install --no-cache-dir`.", refs: [BP] },
];

const isVar = (s: string) => s.includes("$");

export function checkDockerfile(text: string): Finding[] {
  const { instrs, stages, lines } = parseDockerfile(text);
  const out: Finding[] = [];
  const add = (rule: string, line: number, message: string, edits?: Edit[], endLine?: number) => out.push({ rule, severity: DOCKERFILE_RULES.find((r) => r.id === rule)!.severity, line, endLine, message, edits });
  const aliases = new Set(stages.map((s) => s.alias?.toLowerCase()).filter(Boolean));

  for (const s of stages) {
    const img = s.image;
    if (!img || img === "scratch" || isVar(img) || aliases.has(img.toLowerCase()) || img.includes("@sha256:")) continue;
    const tag = img.split("/").pop()!.split(":")[1];
    if (!tag) add("DF001", s.line, `\`${img}\` has no tag, so it means \`${img}:latest\`.`);
    else if (tag === "latest") add("DF001", s.line, `\`${img}\` follows whatever \`latest\` is on the day you build.`);
  }

  // DF002: only the final stage runs. A stage built `FROM` an earlier one inherits its USER.
  const last = stages.length - 1;
  if (last >= 0) {
    const finalInstrs = instrs.filter((x) => x.stage === last);
    const users = finalInstrs.filter((x) => x.cmd === "USER");
    let inherited: Instr | undefined;
    for (let st = last, seen = 0; !users.length && seen < stages.length; seen++) {
      const parent = stages.findIndex((p, k) => k < st && p.alias?.toLowerCase() === stages[st].image.toLowerCase());
      if (parent < 0) break;
      inherited = instrs.filter((x) => x.stage === parent && x.cmd === "USER").at(-1);
      if (inherited) break;
      st = parent;
    }
    const lastUser = users.at(-1);
    const effectiveUser = lastUser ?? inherited;
    const isRoot = !effectiveUser || /^(root|0)(:|$)/.test(effectiveUser.args.trim());
    if (isRoot) {
      const run = finalInstrs.find((x) => x.cmd === "CMD" || x.cmd === "ENTRYPOINT");
      const user = /(^|\/)node:/.test(stages[last].image) || stages[last].image === "node" ? "node" : "10001:10001";
      const edits = lastUser ? [replaceLine(lastUser.line, `USER ${user}`, lines)] : run ? [insertBefore(run.line, [`USER ${user}`])] : [{ start: lines.at(-1) === "" ? lines.length : lines.length + 1, end: lines.at(-1) === "" ? lines.length : lines.length + 1, lines: [`USER ${user}`] }];
      add("DF002", lastUser?.line ?? stages[last].line, lastUser ? `\`USER ${lastUser.args}\` is the last user set, so the app runs as root.` : "No `USER` in the final stage, so the app runs as root.", edits);
    }
  }

  for (const x of instrs) {
    const a = x.args;
    if (x.cmd === "ENV" || x.cmd === "ARG") {
      const pairs = x.cmd === "ENV" && !a.includes("=") ? [[a.split(/\s+/)[0], a.split(/\s+/).slice(1).join(" ")]] : [...a.matchAll(/([A-Za-z_][\w]*)=("[^"]*"|'[^']*'|\S+)/g)].map((m) => [m[1], m[2]]);
      for (const [k, v] of pairs) {
        const val = (v ?? "").replace(/^["']|["']$/g, "");
        if (SECRET_NAME.test(k) && val && !isVar(val) && !/^(true|false|yes|no|none|null|0|1)$/i.test(val) && !/_(file|path|url|host|user(name)?)$/i.test(k)) {
          add("DF003", x.line, `\`${k}\` is set to a literal value in an \`${x.cmd}\`. It ships inside every copy of the image.`);
          if (x.cmd === "ARG") out[out.length - 1].severity = "high";
        }
      }
    }
    if (x.cmd === "ADD") {
      const parts = a.split(/\s+/).filter((p) => !p.startsWith("--"));
      const srcs = parts.slice(0, -1);
      const hasChecksum = /--checksum=/.test(a);
      if (srcs.some((p) => /^https?:\/\//.test(p))) {
        if (!hasChecksum) add("DF004", x.line, "Downloads a URL with no checksum, so nothing confirms it's the file you expect.");
      } else if (srcs.length && !srcs.some((p) => /\.(tar|tgz|tar\.(gz|bz2|xz)|txz)$/.test(p))) {
        add("DF004", x.line, "Copies local files with `ADD`; `COPY` does the same with no surprises.", x.line === x.endLine ? [replaceLine(x.line, lines[x.line - 1].trim().replace(/^ADD\b/i, "COPY"), lines)] : undefined);
      }
    }
    if (x.cmd === "RUN") {
      if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(a)) add("DF005", x.line, "Runs a downloaded script without checking it.", undefined, x.endLine);
      if (/\bapt-get\s+(-\S+\s+)*install\b/.test(a)) {
        const noRec = /--no-install-recommends/.test(a);
        const cleaned = /rm -rf \/var\/lib\/apt\/lists/.test(a);
        if (!noRec || !cleaned) {
          const span = lines.slice(x.line - 1, x.endLine);
          const fixed = span.map((l) => (noRec ? l : l.replace(/apt-get(\s+-\S+)*\s+install\b/, (m) => `${m} --no-install-recommends`)));
          if (!cleaned) fixed[fixed.length - 1] = fixed[fixed.length - 1].replace(/\s*$/, " && rm -rf /var/lib/apt/lists/*");
          const what = [!noRec && "pulls in recommended packages", !cleaned && "leaves the apt lists behind"].filter(Boolean).join(" and ");
          add("DF006", x.line, `This install ${what}.`, !hd(lines, x) ? [{ start: x.line, end: x.endLine + 1, lines: fixed }] : undefined, x.endLine);
        }
      }
      if (/(^|&&|\|\||;|\|)\s*sudo\s/.test(a)) add("DF007", x.line, "Uses `sudo` in a build step.", undefined, x.endLine);
      if (/chmod\s+(-R\s+)?0?777\b/.test(a)) add("DF008", x.line, "Makes files writable by everyone.", undefined, x.endLine);
      if (/(curl\b[^|;&]*(\s-k\b|--insecure)|wget\s[^|;&]*--no-check-certificate|--trusted-host|strict-ssl\s+false|GIT_SSL_NO_VERIFY|sslVerify\s+false)/.test(a)) add("DF012", x.line, "Turns off certificate checks for a download.", undefined, x.endLine);
      const loose: string[] = [];
      let fixed = lines.slice(x.line - 1, x.endLine);
      if (/\bnpm\s+install((\s+--?[\w=-]+)*)\s*($|&&|;|\|)/.test(a) && !/\s(-g|--global)\b/.test(a)) {
        loose.push("`npm install` instead of `npm ci`");
        fixed = fixed.map((l) => l.replace(/\bnpm\s+install\b/, "npm ci"));
      }
      if (/\bpip3?\s+install\b/.test(a) && !/--no-cache-dir/.test(a)) {
        loose.push("`pip install` keeps its cache");
        fixed = fixed.map((l) => l.replace(/\b(pip3?\s+install)\b/, "$1 --no-cache-dir"));
      }
      if (loose.length) add("DF014", x.line, `${loose.join("; ")}.`, [{ start: x.line, end: x.endLine + 1, lines: fixed }], x.endLine);
    }
    if (x.cmd === "COPY" || x.cmd === "ADD") {
      const srcs = a.split(/\s+/).filter((p) => !p.startsWith("--")).slice(0, -1);
      const bad = srcs.find((p) => /(^|\/)(id_(rsa|ed25519|ecdsa)|\.env(\.\w+)?|\.npmrc|\.pypirc|\.aws|\.ssh|\.git-credentials|.*\.(pem|key|p12|pfx))$/.test(p) && !/\.env\.example$/.test(p));
      if (bad) add("DF013", x.line, `Copies \`${bad}\` into a layer, where it stays for good.`);
    }
    if (x.cmd === "EXPOSE" && /(^|\s)22(\/tcp)?(\s|$)/.test(a)) add("DF009", x.line, "Exposes port 22.");
    if (x.cmd === "MAINTAINER") add("DF010", x.line, "`MAINTAINER` is deprecated.", [replaceLine(x.line, `LABEL maintainer="${a.replace(/"/g, '\\"')}"`, lines)]);
    if ((x.cmd === "CMD" || x.cmd === "ENTRYPOINT") && !a.startsWith("[")) {
      const simple = !/[&|;$<>*?`"'()\\]/.test(a) && x.line === x.endLine;
      add("DF011", x.line, `\`${x.cmd} ${a}\` runs through \`/bin/sh\`, which swallows stop signals.`, simple ? [replaceLine(x.line, `${x.cmd} ${JSON.stringify(a.split(/\s+/))}`.replace(/","/g, '", "'), lines)] : undefined);
    }
  }
  return out;
}

/** True when the instruction contains a heredoc, which we don't rewrite. */
function hd(lines: string[], x: Instr) {
  return /<<-?["']?\w+/.test(lines[x.line - 1]);
}

