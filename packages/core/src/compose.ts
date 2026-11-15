import type { Node, Pair, YAMLMap } from "yaml";
import { deleteLines } from "./edits";
import type { Edit, Finding, Rule } from "./types";
import { get, isMap, isScalar, isSeq, pairOf, scalar, truthy, Yaml } from "./yamlkit";

const ref = (label: string, url: string) => ({ label, url });
const CIS = ref("CIS Docker Benchmark", "https://www.cisecurity.org/benchmark/docker");
const OWASP = ref("OWASP Docker Security Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html");

/** Ports that should never face the internet. */
export const PRIVATE_PORTS: Record<number, string> = {
  2375: "the Docker API",
  2376: "the Docker API",
  3306: "MySQL",
  5432: "PostgreSQL",
  6379: "Redis",
  27017: "MongoDB",
  9200: "Elasticsearch",
  11211: "Memcached",
  5672: "RabbitMQ",
  15672: "the RabbitMQ admin page",
  5984: "CouchDB",
  9042: "Cassandra",
  8086: "InfluxDB",
  2379: "etcd",
  1433: "SQL Server",
  5601: "Kibana",
};

export const SECRET_KEY = /(pass(word|wd)?|secret([_-]?key)?|token|api[_-]?key|private[_-]?key|access[_-]?key|credentials?)$/i;
export const looksLiteral = (v: string) => !!v && !v.includes("${") && !v.startsWith("$") && !/^(true|false|yes|no|none|null|changeme)?$/i.test(v) && !/^\/run\/secrets\//.test(v);

export const COMPOSE_RULES: Rule[] = [
  { id: "DC001", kind: "compose", title: "Privileged container", severity: "critical", autofix: true, why: "`privileged: true` turns off nearly all of the container's isolation. Code inside can load kernel modules and reach the host's devices, so escaping to the host is trivial.", fix: "Remove it. If the service needs one specific power, grant just that with `cap_add` or `devices`.", refs: [CIS, OWASP] },
  { id: "DC002", kind: "compose", title: "Docker socket mounted", severity: "critical", autofix: false, why: "Whoever can talk to `/var/run/docker.sock` can start a privileged container that mounts the host's disk. Mounting it gives the service root on the host.", fix: "Remove the mount. If a tool needs to watch containers, put a read-only socket proxy that allows only the calls it needs in front of it.", refs: [OWASP] },
  { id: "DC003", kind: "compose", title: "Shares the host's namespaces", severity: "high", autofix: false, why: "`network_mode: host`, `pid: host` or `ipc: host` let the container see the host's network services, processes or shared memory.", fix: "Use the default bridge network and publish only the ports you need.", refs: [CIS] },
  { id: "DC004", kind: "compose", title: "Database port open to the internet", severity: "high", autofix: true, why: "A published port listens on every interface, and Docker writes its own iptables rules, so `ufw` won't block it. Open Redis, MongoDB and Elasticsearch servers are found and wiped by bots within hours.", fix: "Don't publish it at all if only other services use it, or bind to localhost: `127.0.0.1:5432:5432`.", refs: [ref("Docker and ufw", "https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw")] },
  { id: "DC005", kind: "compose", title: "Password written in the compose file", severity: "high", autofix: false, why: "The compose file goes into Git, so the password ends up in the history, in every clone and in CI logs.", fix: "Use `${DB_PASSWORD}` with an `.env` file that isn't committed, or Docker secrets.", refs: [ref("Compose secrets", "https://docs.docker.com/compose/how-tos/use-secrets/")] },
  { id: "DC006", kind: "compose", title: "Dangerous capability added", severity: "high", autofix: false, why: "Capabilities like `SYS_ADMIN` and `ALL` give root-like powers over the kernel and are the usual first step in a container escape.", fix: "Remove it, or replace it with the narrow capability the service needs.", refs: [CIS] },
  { id: "DC007", kind: "compose", title: "Security profile turned off", severity: "high", autofix: true, why: "`seccomp:unconfined` and `apparmor:unconfined` remove the filters that block dangerous system calls.", fix: "Remove the option to get Docker's default profile.", refs: [CIS] },
  { id: "DC008", kind: "compose", title: "Image not pinned", severity: "medium", autofix: false, why: "`latest`, or no tag, can change under you on the next `docker compose pull`.", fix: "Pin a version tag.", refs: [CIS] },
];

const DANGEROUS_CAPS = /^(ALL|SYS_ADMIN|SYS_PTRACE|SYS_MODULE|NET_ADMIN|DAC_READ_SEARCH|SYS_RAWIO)$/i;

export function checkCompose(y: Yaml): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, line: number, message: string, edits?: Edit[]) => out.push({ rule, severity: COMPOSE_RULES.find((r) => r.id === rule)!.severity, line, message, edits });
  for (const doc of y.docs) {
    const services = get(doc.contents, "services");
    if (!isMap(services)) continue;
    for (const svc of services.items as Pair<Node, YAMLMap>[]) {
      const name = String(scalar(svc.key));
      const s = svc.value;
      if (!isMap(s)) continue;
      const p = (k: string) => pairOf(s, k);

      if (truthy(p("privileged")?.value)) add("DC001", y.line(p("privileged")), `\`${name}\` runs privileged.`, [deleteLines(y.line(p("privileged")))]);

      const vols = get(s, "volumes");
      if (isSeq(vols)) {
        for (const v of vols.items) {
          const src = isScalar(v) ? String(v.value).split(":")[0] : String(scalar(get(v, "source")) ?? "");
          if (/docker\.sock$/.test(src)) add("DC002", y.line(v as Node), `\`${name}\` mounts the Docker socket.`);
        }
      }

      for (const k of ["network_mode", "pid", "ipc"]) {
        const pr = p(k);
        if (pr && scalar(pr.value) === "host") add("DC003", y.line(pr), `\`${name}\` uses \`${k}: host\`.`);
      }

      const ports = get(s, "ports");
      if (isSeq(ports)) {
        for (const item of ports.items) {
          let host: string | undefined;
          let published: number | undefined;
          let target: number | undefined;
          if (isScalar(item)) {
            const parts = String(item.value).replace(/\/(tcp|udp)$/, "").split(":");
            target = +parts[parts.length - 1];
            if (parts.length === 3) {
              host = parts[0];
              published = +parts[1];
            } else if (parts.length === 2) published = +parts[0];
            else published = target; // "6379" publishes on a random host port
          } else if (isMap(item)) {
            target = Number(scalar(item.get("target", true)));
            published = Number(scalar(item.get("published", true)) ?? target);
            host = scalar(item.get("host_ip", true)) as string | undefined;
          }
          const svcName = PRIVATE_PORTS[target ?? -1] ?? PRIVATE_PORTS[published ?? -1];
          const open = !host || host === "0.0.0.0" || host === "::" || host === "[::]";
          if (svcName && open) {
            const l = y.line(item as Node);
            const text = y.lines[l - 1];
            const fixable = isScalar(item) && String(item.value).split(":").length === 2;
            const edits = fixable ? [{ start: l, end: l + 1, lines: [text.replace(String(item.value), `127.0.0.1:${item.value}`)] }] : undefined;
            add("DC004", l, `\`${name}\` publishes ${svcName} (port ${target}) on every network interface.`, edits);
          }
        }
      }

      const env = get(s, "environment");
      const envPairs: [string, string, Node][] = [];
      if (isMap(env)) for (const it of env.items as Pair<Node, Node>[]) envPairs.push([String(scalar(it.key)), String(scalar(it.value) ?? ""), it.key]);
      if (isSeq(env)) for (const it of env.items) if (isScalar(it)) envPairs.push([String(it.value).split("=")[0], String(it.value).split("=").slice(1).join("="), it as Node]);
      for (const [k, v, node] of envPairs) if (SECRET_KEY.test(k) && !/_FILE$/i.test(k) && looksLiteral(v)) add("DC005", y.line(node), `\`${name}\` sets \`${k}\` to a literal value.`);

      const caps = get(s, "cap_add");
      if (isSeq(caps)) for (const c of caps.items) if (isScalar(c) && DANGEROUS_CAPS.test(String(c.value).replace(/^CAP_/, ""))) add("DC006", y.line(c as Node), `\`${name}\` adds \`${c.value}\`.`);

      const sec = get(s, "security_opt");
      if (isSeq(sec)) for (const o of sec.items) if (isScalar(o) && /(seccomp|apparmor)[:=]unconfined|label[:=]disable/.test(String(o.value))) add("DC007", y.line(o as Node), `\`${name}\` turns off \`${String(o.value).split(/[:=]/)[0]}\`.`, sec.items.length === 1 ? [deleteLines(y.line(p("security_opt")), y.line(o as Node))] : [deleteLines(y.line(o as Node))]);

      const image = scalar(get(s, "image"));
      if (typeof image === "string" && !get(s, "build") && !image.includes("@sha256:") && !image.includes("${")) {
        const tag = image.split("/").pop()!.split(":")[1];
        if (!tag || tag === "latest") add("DC008", y.line(p("image")), `\`${name}\` uses \`${image}\`${tag ? "" : " (no tag means latest)"}.`);
      }
    }
  }
  return out;
}
