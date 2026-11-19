import { insertAfter, replaceLine } from "./edits";
import type { Edit, Finding, Rule } from "./types";

export type Directive = { name: string; args: string[]; line: number; endLine: number; block?: Directive[]; parent?: Directive };

/** A small tokenizer for nginx config: directives, blocks, quotes and comments. */
export function parseNginx(text: string): { root: Directive[]; errors: string[] } {
  const errors: string[] = [];
  const root: Directive[] = [];
  const stack: { list: Directive[]; owner?: Directive }[] = [{ list: root }];
  let words: { v: string; line: number }[] = [];
  let line = 1;
  let i = 0;
  const flush = (endLine: number, block: boolean) => {
    if (!words.length) {
      if (block) errors.push(`Line ${endLine}: a block with no name.`);
      return undefined;
    }
    const top = stack[stack.length - 1];
    const d: Directive = { name: words[0].v, args: words.slice(1).map((w) => w.v), line: words[0].line, endLine, parent: top.owner };
    top.list.push(d);
    words = [];
    return d;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === ";") {
      flush(line, false);
      i++;
    } else if (c === "{") {
      const d = flush(line, true);
      if (d) {
        d.block = [];
        stack.push({ list: d.block, owner: d });
      }
      i++;
    } else if (c === "}") {
      if (words.length) errors.push(`Line ${line}: missing ";" before "}".`);
      words = [];
      const s = stack.pop();
      if (!s || stack.length === 0) {
        errors.push(`Line ${line}: "}" with no matching "{".`);
        stack.push({ list: root });
      } else if (s.owner) s.owner.endLine = line;
      i++;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let v = "";
      const startLine = line;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\" && j + 1 < text.length) {
          v += text[j + 1];
          j += 2;
          continue;
        }
        if (text[j] === "\n") line++;
        v += text[j++];
      }
      words.push({ v, line: startLine });
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s;{}"'#]/.test(text[j])) j++;
      // `$` followed by `{` is a variable, not a block.
      if (text[j] === "{" && text[j - 1] === "$") {
        const k = text.indexOf("}", j);
        j = k < 0 ? text.length : k + 1;
      }
      words.push({ v: text.slice(i, j), line });
      i = j;
    }
  }
  if (stack.length > 1) errors.push(`A block opened on line ${stack[stack.length - 1].owner?.line} is never closed.`);
  return { root, errors };
}

export function walk(list: Directive[], fn: (d: Directive) => void) {
  for (const d of list) {
    fn(d);
    if (d.block) walk(d.block, fn);
  }
}

const ref = (label: string, url: string) => ({ label, url });
const MOZ = ref("Mozilla server-side TLS guidelines", "https://wiki.mozilla.org/Security/Server_Side_TLS");
const NGX = ref("nginx documentation", "https://nginx.org/en/docs/");
const OWASP_H = ref("OWASP HTTP headers cheat sheet", "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html");

/** Mozilla's "intermediate" cipher list. */
export const MOZILLA_CIPHERS = "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-CHACHA20-POLY1305";

export const NGINX_RULES: Rule[] = [
  { id: "NG001", kind: "nginx", title: "Version number shown to the world", severity: "low", autofix: true, why: "By default nginx prints its exact version on error pages and in the `Server` header, which tells attackers which known bugs to try.", fix: "Set `server_tokens off;` in the `http` block.", refs: [NGX] },
  { id: "NG002", kind: "nginx", title: "Old TLS versions allowed", severity: "high", autofix: true, why: "SSLv3, TLS 1.0 and TLS 1.1 have known attacks (POODLE, BEAST) and are rejected by modern browsers and by PCI DSS.", fix: "`ssl_protocols TLSv1.2 TLSv1.3;`", refs: [MOZ] },
  { id: "NG003", kind: "nginx", title: "Weak ciphers allowed", severity: "high", autofix: true, why: "RC4, DES, 3DES, MD5, export and NULL ciphers can be broken or downgraded to, so an attacker on the network can read the traffic.", fix: "Use Mozilla's intermediate cipher list.", refs: [MOZ] },
  { id: "NG004", kind: "nginx", title: "Directory listing turned on", severity: "medium", autofix: true, why: "`autoindex on` lists every file in the folder, including backups, dumps and files you forgot were there.", fix: "`autoindex off;` and link to the files you mean to share.", refs: [NGX] },
  { id: "NG005", kind: "nginx", title: "No HSTS on an HTTPS site", severity: "medium", autofix: true, why: "Without `Strict-Transport-Security`, a visitor's first request can go over plain HTTP, where someone on the same Wi-Fi can intercept it and keep them off HTTPS.", fix: '`add_header Strict-Transport-Security "max-age=63072000" always;`', refs: [OWASP_H, MOZ] },
  { id: "NG006", kind: "nginx", title: "Plain HTTP serves the site", severity: "medium", autofix: false, why: "The site is also served on port 80 without redirecting, so logins and cookies can travel unencrypted.", fix: "Make the port-80 server only redirect: `return 301 https://$host$request_uri;`", refs: [MOZ] },
  { id: "NG007", kind: "nginx", title: "alias path traversal (off-by-slash)", severity: "high", autofix: true, why: "With `location /static` (no trailing slash) and `alias /var/www/static/;`, a request for `/static../app/.env` resolves to `/var/www/app/.env`. Attackers can read files one folder up.", fix: "End the location with a slash too: `location /static/ {`.", refs: [ref("Orange Tsai, Breaking Parser Logic (Black Hat 2018)", "https://i.blackhat.com/us-18/Wed-August-8/us-18-Orange-Tsai-Breaking-Parser-Logic-Take-Your-Path-Normalization-Off-And-Pop-0days-Out-2.pdf")] },
  { id: "NG008", kind: "nginx", title: "Security headers silently dropped", severity: "medium", autofix: true, why: "nginx only inherits `add_header` from the outer block when the inner block has none of its own. One `add_header` in a location wipes out every security header set on the server for that location.", fix: "Repeat the outer headers inside the block, or move them into a shared file and `include` it in each block.", refs: [ref("nginx add_header", "https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header")] },
  { id: "NG009", kind: "nginx", title: "Basic security headers missing", severity: "low", autofix: true, why: "Without `X-Content-Type-Options: nosniff` browsers may guess file types and run uploads as scripts. Without `X-Frame-Options` (or CSP `frame-ancestors`) other sites can frame yours for clickjacking.", fix: "Add `X-Content-Type-Options nosniff` and `X-Frame-Options DENY` (or `SAMEORIGIN`).", refs: [OWASP_H] },
  { id: "NG010", kind: "nginx", title: "Hidden files can be downloaded", severity: "medium", autofix: true, why: "The server serves files from disk with nothing stopping `/.git/config` or `/.env`. Exposed `.git` folders regularly leak whole source trees and keys.", fix: "Deny dotfiles but keep `/.well-known` working for certificates.", refs: [ref("OWASP: review webserver metafiles", "https://owasp.org/www-project-web-security-testing-guide/")] },
  { id: "NG011", kind: "nginx", title: "Header injection through $uri", severity: "medium", autofix: true, why: "`$uri` is decoded, so `%0d%0a` in the URL becomes a real line break in the redirect. Attackers can add their own headers or cookies to your response (CRLF injection).", fix: "Use `$request_uri`, which keeps the original encoding.", refs: [ref("Detectify: common nginx misconfigurations", "https://blog.detectify.com/industry-insights/common-nginx-misconfigurations-that-leave-your-web-server-ope/")] },
];

const isServer = (d: Directive) => d.name === "server" && d.parent?.name !== "upstream";
const inner = (d: Directive) => d.block ?? [];
const indentFor = (lines: string[], block: Directive) => {
  const child = inner(block).find((c) => c.line > block.line);
  if (child) return lines[child.line - 1].match(/^\s*/)![0];
  return lines[block.line - 1].match(/^\s*/)![0] + "    ";
};
/** Where to put a new directive at the top of a block: after its opening line. */
const openLine = (block: Directive, lines: string[]) => {
  let l = block.line;
  while (l <= lines.length && !lines[l - 1].includes("{")) l++;
  return l;
};
const headers = (list: Directive[]) => list.filter((d) => d.name === "add_header" || d.name === "more_set_headers");
/** The header name a directive sets: `add_header Name value` or `more_set_headers "Name: value"`. */
const headerName = (h: Directive) => (h.name === "more_set_headers" ? (h.args.find((a) => !a.startsWith("-")) ?? "").split(":")[0].trim() : (h.args[0] ?? ""));

/** Where a variable ends up in a header or in the request line sent upstream. */
const SINKS: Record<string, (args: string[]) => string[]> = {
  add_header: (a) => a.slice(1, 2),
  more_set_headers: (a) => a.filter((x) => !x.startsWith("-")),
  proxy_set_header: (a) => a.slice(1, 2),
  proxy_pass: (a) => a.slice(0, 1),
  // `return 301 URL` (or `return URL`) puts URL in the Location header; `return 200 text` is a body.
  return: (a) => (a.length === 2 && /^30[1278]$/.test(a[0]) ? [a[1]] : a.length === 1 && !/^\d+$/.test(a[0]) ? [a[0]] : []),
};

/** Can this regex fragment match a line break? (`.` can't; `\s`, `\W`, `\D` and most negated classes can.) */
const matchesNewline = (re: string) => /\\[sWD]/.test(re) || /\[\^(?![^\]]*(\\n|\\s))[^\]]*\]/.test(re);

const isGroup = (re: string, i: number) => re[i] === "(" && (re[i + 1] !== "?" || re[i + 2] === "<" || re[i + 2] === "P");
function groupBody(re: string, open: number): string {
  let depth = 0;
  for (let j = open; j < re.length; j++) {
    if (re[j] === "\\") j++;
    else if (re[j] === "(") depth++;
    else if (re[j] === ")" && --depth === 0) return re.slice(open + 1, j).replace(/^\?P?<\w+>/, "");
  }
  return re.slice(open + 1);
}
/** Capture groups of a regex in order: number, name and body. */
function groups(re: string): { n: string; name?: string; body: string; at: number }[] {
  const out: { n: string; name?: string; body: string; at: number }[] = [];
  for (let i = 0; i < re.length; i++) {
    if (re[i] === "\\") i++;
    else if (re[i] === "[") {
      while (i < re.length && re[i] !== "]") i += re[i] === "\\" ? 2 : 1;
    } else if (isGroup(re, i)) out.push({ n: String(out.length + 1), name: re.slice(i).match(/^\(\?P?<(\w+)>/)?.[1], body: groupBody(re, i), at: i });
  }
  return out;
}

/** Capture groups of a regex, numbered and named, mapped to whether they can hold a line break. */
export function regexGroups(re: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const g of groups(re)) {
    out.set(g.n, matchesNewline(g.body));
    if (g.name) out.set(g.name, matchesNewline(g.body));
  }
  return out;
}

/**
 * `location ~ /images(.*) { alias /data/$1; }`: the capture starts right after "images", not after
 * a slash, so `/images../secret` makes it `../secret`. nginx resolves `..` between slashes before
 * matching, so a capture that starts after a `/`, or that can't contain a dot, is safe.
 * Returns the risky capture variable, if any.
 */
export function unsafeAliasCapture(re: string, alias: string): string | undefined {
  const used = [...alias.matchAll(/\$\{?(\w+)\}?/g)].map((m) => m[1]);
  for (const g of groups(re)) {
    const v = used.find((u) => u === g.n || u === g.name);
    if (!v) continue;
    const afterSlash = re.slice(0, g.at).replace(/\^$/, "").endsWith("/") || g.body.startsWith("/");
    const noDot = /^\[\^[^\]]*\\?\.[^\]]*\][*+?]?$/.test(g.body) || /^[\w|-]*$/.test(g.body);
    if (!afterSlash && !noDot) return `$${v}`;
  }
  return undefined;
}

export function checkNginx(text: string): { findings: Finding[]; errors: string[] } {
  const { root, errors } = parseNginx(text);
  const lines = text.split(/\r?\n/);
  const out: Finding[] = [];
  const add = (rule: string, line: number, message: string, edits?: Edit[]) => out.push({ rule, severity: NGINX_RULES.find((r) => r.id === rule)!.severity, line, message, edits });

  const http = root.find((d) => d.name === "http");
  const servers: Directive[] = [];
  walk(root, (d) => isServer(d) && d.block && servers.push(d));
  // A file with no `http` or `server` is a fragment meant to be included (conf.d snippets,
  // `include`d location files). Its directives are still checked; checks about what a whole
  // server is missing are not, since the including file may provide it.
  const fragment = !servers.length && !http;

  // NG001
  const tokens: Directive[] = [];
  walk(root, (d) => d.name === "server_tokens" && tokens.push(d));
  for (const t of tokens) if (t.args[0] === "on" || t.args[0] === "build") add("NG001", t.line, `\`server_tokens ${t.args[0]}\` shows the nginx version.`, [replaceLine(t.line, "server_tokens off;", lines)]);
  if (!fragment) {
    if (!tokens.length) {
      const host = http ?? servers[0];
      const l = openLine(host, lines);
      add("NG001", host.line, "`server_tokens` isn't set, so it defaults to on.", [insertAfter(l, [`${indentFor(lines, host)}server_tokens off;`])]);
    }
  }

  // NG011: which variables can carry a decoded line break. `$uri` and `$document_uri` are
  // decoded; so are captures from a location, `if` or `map` regex that can match a line break;
  // `set` and `map` pass that on to the variables they define.
  const taintedVars = new Set<string>();
  const capturesOf = (d: Directive | undefined): Map<string, boolean> => {
    for (let b = d; b; b = b.parent) {
      if (b.name === "location" && (b.args[0] === "~" || b.args[0] === "~*")) return regexGroups(b.args[1] ?? "");
      if (b.name === "if" && b.args.length >= 3 && /^\(?\$(uri|document_uri)$/.test(b.args[0]) && /^!?~\*?$/.test(b.args[1])) return regexGroups(b.args[2].replace(/\)$/, ""));
    }
    return new Map();
  };
  const varsIn = (text: string) => [...text.matchAll(/\$\{?(\w+)\}?/g)].map((m) => m[1]);
  const taintIn = (text: string, scope: Directive | undefined): string | undefined => {
    const caps = capturesOf(scope);
    const v = varsIn(text).find((v) => v === "uri" || v === "document_uri" || taintedVars.has(v) || caps.get(v));
    return v && `$${v}`;
  };
  const tainted = (d: Directive, args: string[]) => args.map((a) => taintIn(a, d.parent)).find(Boolean);
  for (let round = 0; round < 4; round++) {
    walk(root, (d) => {
      if (d.name === "set" && d.args[0]?.startsWith("$") && taintIn(d.args[1] ?? "", d.parent)) taintedVars.add(d.args[0].slice(1));
      if (d.name === "map" && d.block && d.args[1]?.startsWith("$")) {
        const fromUri = /^\$(uri|document_uri)$/.test(d.args[0] ?? "");
        for (const e of d.block) {
          if (!e.args.length) continue;
          const groups = fromUri && e.name.startsWith("~") ? regexGroups(e.name.replace(/^~\*?/, "")) : new Map<string, boolean>();
          if (varsIn(e.args[e.args.length - 1]).some((v) => v === "uri" || v === "document_uri" || taintedVars.has(v) || groups.get(v))) taintedVars.add(d.args[1].slice(1));
        }
      }
    });
  }

  walk(root, (d) => {
    if (d.name === "ssl_protocols") {
      const old = d.args.filter((a) => /^(SSLv2|SSLv3|TLSv1|TLSv1\.1)$/.test(a));
      if (old.length) add("NG002", d.line, `Allows ${old.join(", ")}.`, d.line === d.endLine ? [replaceLine(d.line, "ssl_protocols TLSv1.2 TLSv1.3;", lines)] : undefined);
    }
    if (d.name === "ssl_ciphers") {
      const list = d.args.join(":").split(":");
      const weak = list.filter((c) => !c.startsWith("!") && !c.startsWith("-") && /(RC4|(^|-)DES|3DES|MD5|NULL|EXPORT|EXP-|aNULL|eNULL|ADH|SEED|IDEA|^LOW$|^MEDIUM$)/i.test(c));
      if (weak.length) add("NG003", d.line, `Allows ${weak.slice(0, 4).join(", ")}${weak.length > 4 ? ` and ${weak.length - 4} more` : ""}.`, d.line === d.endLine ? [replaceLine(d.line, `ssl_ciphers ${MOZILLA_CIPHERS};`, lines)] : undefined);
    }
    if (d.name === "autoindex" && d.args[0] === "on") add("NG004", d.line, "Lists the contents of folders.", [replaceLine(d.line, "autoindex off;", lines)]);
    if (d.name === "location" && d.block) {
      const path = d.args.length === 1 ? d.args[0] : d.args[0] === "=" || d.args[0] === "^~" ? d.args[1] : undefined;
      const alias = inner(d).find((c) => c.name === "alias");
      const capture = alias && (d.args[0] === "~" || d.args[0] === "~*") ? unsafeAliasCapture(d.args[1] ?? "", alias.args[0] ?? "") : undefined;
      if (capture) add("NG007", d.line, `\`alias ${alias!.args[0]}\` takes \`${capture}\` from a part of the URL that doesn't start after a \`/\`, so a request with \`..\` there reaches the folder above.`);
      else if (path && !path.endsWith("/") && alias?.args[0]?.endsWith("/") && d.args[0] !== "=") {
        add("NG007", d.line, `\`location ${path}\` with \`alias ${alias.args[0]}\`: \`${path}../\` reaches the folder above.`, d.line === openLine(d, lines) ? [{ start: d.line, end: d.line + 1, lines: [lines[d.line - 1].replace(path, `${path}/`)] }] : undefined);
      }
    }
    const sinkArgs = SINKS[d.name]?.(d.args);
    const bad = sinkArgs && tainted(d, sinkArgs);
    if (bad) {
      const direct = /^\$(document_)?uri$/.test(bad);
      const where = d.name.startsWith("proxy") ? "the request sent upstream" : "a response header";
      add("NG011", d.line, `Puts \`${bad}\` into ${where}. It is decoded from the URL, so an encoded line break (\`%0d%0a\`) in a request can add headers of its own.`, direct && d.line === d.endLine ? [{ start: d.line, end: d.line + 1, lines: [lines[d.line - 1].replace(/\$(document_)?uri\b(\$is_args\$args|\?\$args)?/g, "$request_uri")] }] : undefined);
    }
  });

  // Headers that apply to a block, following nginx's all-or-nothing inheritance.
  // `add_header_inherit merge` (nginx 1.29.3+) keeps the parent's headers and is itself inherited.
  const inheritMode = (block: Directive | undefined): string => {
    for (let b = block; b; b = b.parent) {
      const m = inner(b).find((d) => d.name === "add_header_inherit");
      if (m) return m.args[0] ?? "on";
    }
    return root.find((d) => d.name === "add_header_inherit")?.args[0] ?? "on";
  };
  const effective = (block: Directive | undefined): Directive[] => {
    const own = headers(block ? inner(block) : root);
    if (!block) return own;
    if (own.length && inheritMode(block) === "merge") return [...own, ...effective(block.parent)];
    return own.length ? own : effective(block.parent);
  };
  const hasHeader = (list: Directive[], name: string) => list.some((h) => headerName(h).toLowerCase() === name.toLowerCase());

  for (const s of servers) {
    const kids = inner(s);
    const listens = kids.filter((d) => d.name === "listen");
    const tls = listens.some((l) => l.args.includes("ssl") || l.args.some((a) => /(^|:)443$/.test(a))) || kids.some((d) => d.name === "ssl" && d.args[0] === "on") || kids.some((d) => d.name === "ssl_certificate");
    const sh = effective(s);
    const ind = indentFor(lines, s);
    const at = openLine(s, lines);
    const afterName = kids.filter((k) => ["listen", "server_name"].includes(k.name)).reduce((m, k) => Math.max(m, k.endLine), at);
    const returns = kids.some((d) => d.name === "return" || (d.name === "rewrite" && d.args.some((a) => /^https:/.test(a))));
    const servesContent = kids.some((d) => d.name === "root" || d.name === "location" || d.name === "proxy_pass");

    if (tls && !hasHeader(sh, "Strict-Transport-Security")) add("NG005", s.line, "HTTPS server without `Strict-Transport-Security`.", [{ ...insertAfter(afterName, [`${ind}add_header Strict-Transport-Security "max-age=63072000" always;`]), merge: { key: `hdr:${s.line}`, header: [] } }]);
    const shouldRedirect = !tls && listens.some((l) => l.args.some((a) => /(^|:)80$/.test(a))) && !returns && servesContent && servers.some((o) => o !== s && inner(o).some((d) => d.name === "ssl_certificate"));
    if (shouldRedirect) add("NG006", s.line, "This port-80 server serves pages instead of redirecting to HTTPS.");
    const missing = [!hasHeader(sh, "X-Content-Type-Options") && `${ind}add_header X-Content-Type-Options "nosniff" always;`, !hasHeader(sh, "X-Frame-Options") && !sh.some((h) => /frame-ancestors/.test(h.args[1] ?? "")) && `${ind}add_header X-Frame-Options "DENY" always;`].filter(Boolean) as string[];
    if (servesContent && !returns && !shouldRedirect && missing.length) add("NG009", s.line, `Missing ${missing.map((m) => m.trim().split(" ")[1]).join(" and ")}.`, [{ ...insertAfter(afterName, missing), merge: { key: `hdr:${s.line}`, header: [] } }]);

    const root = kids.find((d) => d.name === "root");
    const guarded = kids.some((d) => d.name === "location" && d.args.some((a) => /\/\\\.|\\\.(git|ht|env)/.test(a)));
    if (root && !guarded) {
      const close = s.endLine;
      add("NG010", root.line, `Files under \`${root.args[0]}\` are served with nothing blocking \`/.git\` or \`/.env\`.`, [insertAfter(close - 1, ["", `${ind}location ~ /\\.(?!well-known) {`, `${ind}    deny all;`, `${ind}}`])]);
    }

  }

  // NG008: a location (or an `if` in one) with its own add_header loses the ones above it.
  walk(root, (d) => {
    if ((d.name !== "location" && d.name !== "if") || !d.block) return;
    const own = headers(d.block);
    if (!own.length || inheritMode(d) === "merge") return;
    const lost = effective(d.parent).filter((p) => !hasHeader(own, headerName(p)));
    if (!lost.length) return;
    const li = indentFor(lines, d);
    add("NG008", d.line, `This ${d.name === "if" ? "`if` block" : "location"} sets its own headers, so ${lost.map((h) => `\`${headerName(h)}\``).join(", ")} from above no longer apply here.`, [
      insertAfter(
        openLine(d, lines),
        lost.map((h) => `${li}${lines[h.line - 1].trim()}`),
      ),
    ]);
  });
  return { findings: out, errors };
}
