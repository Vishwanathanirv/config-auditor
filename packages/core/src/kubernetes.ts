import type { Node, YAMLMap } from "yaml";
import { PRIVATE_PORTS, SECRET_KEY, looksLiteral } from "./compose";
import type { Edit, Finding, Rule } from "./types";
import { get, isMap, isScalar, isSeq, pairOf, scalar, truthy, Yaml } from "./yamlkit";

const ref = (label: string, url: string) => ({ label, url });
const PSS = ref("Kubernetes Pod Security Standards", "https://kubernetes.io/docs/concepts/security/pod-security-standards/");
const NSA = ref("NSA/CISA Kubernetes Hardening Guide", "https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CTR_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF");
const RBAC = ref("Kubernetes RBAC good practices", "https://kubernetes.io/docs/concepts/security/rbac-good-practices/");

export const KUBERNETES_RULES: Rule[] = [
  { id: "K8S001", kind: "kubernetes", title: "Privileged container", severity: "critical", autofix: true, why: "A privileged container has full access to the node's devices and kernel. Escaping to the node, and from there to every pod on it, is one command.", fix: "`privileged: false`. Grant specific capabilities if something is really needed.", refs: [PSS, NSA] },
  { id: "K8S002", kind: "kubernetes", title: "May run as root", severity: "high", autofix: true, why: "Nothing stops the container from running as user 0. Root in a container is much closer to root on the node, especially with a kernel bug.", fix: "`runAsNonRoot: true` (and a non-zero `runAsUser` if the image has no user).", refs: [PSS, NSA] },
  { id: "K8S003", kind: "kubernetes", title: "Privilege escalation allowed", severity: "medium", autofix: true, why: "Without `allowPrivilegeEscalation: false`, a process can gain more privileges than its parent through setuid programs like `sudo` or `su`.", fix: "`allowPrivilegeEscalation: false`", refs: [PSS] },
  { id: "K8S004", kind: "kubernetes", title: "Writable root filesystem", severity: "low", autofix: true, why: "An attacker who gets in can download tools and change your app's files. A read-only filesystem stops both.", fix: "`readOnlyRootFilesystem: true`, with an `emptyDir` mounted where the app needs to write (like `/tmp`).", refs: [NSA] },
  { id: "K8S005", kind: "kubernetes", title: "Linux capabilities not dropped", severity: "medium", autofix: true, why: "Containers start with a set of Linux capabilities (like `NET_RAW`, used for network spoofing) that almost no app needs.", fix: 'Drop them all: `capabilities: { drop: ["ALL"] }`, then add back only what is needed.', refs: [PSS] },
  { id: "K8S006", kind: "kubernetes", title: "Dangerous capability added", severity: "high", autofix: false, why: "`SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE` and `ALL` give root-like control over the kernel or network and are common escape routes.", fix: "Remove it, or find the narrow capability the app needs.", refs: [PSS] },
  { id: "K8S007", kind: "kubernetes", title: "Shares the node's namespaces", severity: "high", autofix: true, why: "`hostNetwork`, `hostPID` and `hostIPC` let the pod see the node's network services, every process on the node, or its shared memory.", fix: "Remove them (they default to false).", refs: [PSS, NSA] },
  { id: "K8S008", kind: "kubernetes", title: "Node folder mounted", severity: "high", autofix: false, why: "A `hostPath` volume gives the pod the node's files. Mounting `/`, `/etc`, `/var/run/docker.sock` or the kubelet's folders is equal to root on the node.", fix: "Use a PersistentVolumeClaim, ConfigMap or emptyDir instead.", refs: [PSS] },
  { id: "K8S009", kind: "kubernetes", title: "Image not pinned", severity: "medium", autofix: false, why: "`latest`, or no tag, means each node may pull a different version, and a rollback can't go back to a known image.", fix: "Pin a version tag, or better, a digest.", refs: [NSA] },
  { id: "K8S010", kind: "kubernetes", title: "No memory limit", severity: "medium", autofix: false, why: "Without limits, one leaking or attacked pod can use all the memory on its node and take down every other pod there.", fix: "Set `resources.requests` and `resources.limits.memory` sized from real usage.", refs: [NSA] },
  { id: "K8S011", kind: "kubernetes", title: "Secret written into the manifest", severity: "high", autofix: false, why: "The manifest lives in Git, so the value is in the history and visible to anyone who can read the Deployment.", fix: "Store it in a Secret and use `valueFrom.secretKeyRef`, or use an external secrets manager.", refs: [ref("Kubernetes Secrets good practices", "https://kubernetes.io/docs/concepts/security/secrets-good-practices/")] },
  { id: "K8S012", kind: "kubernetes", title: "API token mounted in every pod", severity: "low", autofix: true, why: "By default each pod gets a token for the Kubernetes API. If the app never calls the API, the token is only useful to an attacker.", fix: "`automountServiceAccountToken: false` on the pod.", refs: [NSA] },
  { id: "K8S013", kind: "kubernetes", title: "Wildcard permissions", severity: "high", autofix: false, why: "`*` in verbs or resources grants everything, including permissions added in future Kubernetes versions.", fix: "List the exact resources and verbs the workload uses.", refs: [RBAC] },
  { id: "K8S014", kind: "kubernetes", title: "cluster-admin handed out", severity: "high", autofix: false, why: "Binding `cluster-admin` gives full control of every namespace. Bound to a default service account or a broad group, every pod or user in it becomes a cluster admin.", fix: "Bind a narrower role in a single namespace.", refs: [RBAC] },
  { id: "K8S015", kind: "kubernetes", title: "Database exposed outside the cluster", severity: "high", autofix: false, why: "A `LoadBalancer` or `NodePort` Service for a database makes it reachable from outside the cluster, often from the whole internet.", fix: "Use `ClusterIP` and reach it from inside the cluster, or through a VPN or bastion.", refs: [NSA] },
];

const WORKLOADS = new Set(["Pod", "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "ReplicationController"]);
const DANGEROUS_CAPS = /^(ALL|SYS_ADMIN|SYS_PTRACE|SYS_MODULE|NET_ADMIN|DAC_READ_SEARCH|SYS_RAWIO|BPF)$/i;
const CRITICAL_PATHS = /^\/(|etc|root|proc|sys|var\/run\/docker\.sock|var\/run|run\/containerd.*|var\/lib\/kubelet.*|var\/lib\/docker.*|home)\/?$/;

export function checkKubernetes(y: Yaml): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, line: number, message: string, edits?: Edit[], severity?: Finding["severity"]) => out.push({ rule, severity: severity ?? KUBERNETES_RULES.find((r) => r.id === rule)!.severity, line, message, edits });

  y.docs.forEach((doc, di) => {
    const root = doc.contents;
    if (!isMap(root)) return;
    const kind = String(scalar(get(root, "kind")) ?? "");
    const name = String(scalar(get(root, "metadata", "name")) ?? kind);

    if (WORKLOADS.has(kind)) {
      const podPath = kind === "Pod" ? ["spec"] : kind === "CronJob" ? ["spec", "jobTemplate", "spec", "template", "spec"] : ["spec", "template", "spec"];
      const pod = get(root, ...podPath);
      if (!isMap(pod)) return;
      const podSc = get(pod, "securityContext");
      const podNonRoot = truthy(get(podSc, "runAsNonRoot")) || Number(scalar(get(podSc, "runAsUser"))) > 0;

      for (const k of ["hostNetwork", "hostPID", "hostIPC"]) {
        const pr = pairOf(pod, k);
        if (pr && truthy(pr.value)) add("K8S007", y.line(pr), `\`${name}\` sets \`${k}: true\`.`, [y.setValue(pr, "false")].filter(Boolean) as Edit[]);
      }

      const vols = get(pod, "volumes");
      if (isSeq(vols)) {
        for (const v of vols.items) {
          const path = scalar(get(v, "hostPath", "path"));
          if (typeof path === "string") add("K8S008", y.line(get(v, "hostPath") as Node), `\`${name}\` mounts \`${path}\` from the node.`, undefined, CRITICAL_PATHS.test(path) ? "critical" : "high");
        }
      }

      const sa = pairOf(pod, "automountServiceAccountToken");
      if (!sa || truthy(sa.value)) {
        const edits = sa ? [y.setValue(sa, "false")] : pod.flow ? [] : [{ start: y.lastLine(pod) + 1, end: y.lastLine(pod) + 1, lines: [`${y.indent(pod)}automountServiceAccountToken: false`], merge: { key: `${di}.pod.sa`, header: [] } }];
        add("K8S012", sa ? y.line(sa) : y.line(pairOf(root, "kind")), `\`${name}\` mounts an API token into its pods.`, edits.filter(Boolean) as Edit[]);
      }

      for (const group of ["initContainers", "containers"]) {
        const list = get(pod, group);
        if (!isSeq(list)) continue;
        list.items.forEach((c, ci) => {
          if (!isMap(c)) return;
          const cname = String(scalar(c.get("name", true)) ?? `#${ci + 1}`);
          const at = `${di}.${group}.${ci}`;
          const cl = y.line(c.items[0]);
          const sc = get(c, "securityContext") as YAMLMap | undefined;
          const scPair = (k: string) => pairOf(sc, k);
          const fixField = (k: string, value: string) => {
            const pr = scPair(k);
            return pr ? [y.setValue(pr, value)].filter(Boolean) as Edit[] : y.ensure(c, "securityContext", [`${k}: ${value}`], at);
          };

          const priv = scPair("privileged");
          if (priv && truthy(priv.value)) add("K8S001", y.line(priv), `Container \`${cname}\` is privileged.`, fixField("privileged", "false"));

          const ru = scalar(get(sc, "runAsUser"));
          const nonRoot = truthy(get(sc, "runAsNonRoot")) || Number(ru) > 0 || (podNonRoot && ru === undefined);
          if (ru === 0 || ru === "0") add("K8S002", y.line(scPair("runAsUser")), `Container \`${cname}\` runs as user 0 (root).`);
          else if (!nonRoot) add("K8S002", cl, `Container \`${cname}\` doesn't say \`runAsNonRoot: true\`, so it runs as whatever user the image picks, often root.`, fixField("runAsNonRoot", "true"));

          const ape = scPair("allowPrivilegeEscalation");
          if (!ape || truthy(ape.value)) add("K8S003", ape ? y.line(ape) : cl, `Container \`${cname}\` can gain privileges through setuid programs.`, fixField("allowPrivilegeEscalation", "false"));

          const ro = scPair("readOnlyRootFilesystem");
          if (!ro || !truthy(ro.value)) add("K8S004", ro ? y.line(ro) : cl, `Container \`${cname}\` can write anywhere in its filesystem.`, fixField("readOnlyRootFilesystem", "true"));

          const caps = get(sc, "capabilities");
          const drop = get(caps, "drop");
          const dropsAll = isSeq(drop) && drop.items.some((d) => isScalar(d) && String(d.value).toUpperCase() === "ALL");
          if (!dropsAll) add("K8S005", caps ? y.line(scPair("capabilities")) : cl, `Container \`${cname}\` keeps the default Linux capabilities.`, caps ? undefined : y.ensure(c, "securityContext", ["capabilities:", '  drop: ["ALL"]'], at));
          const addCaps = get(caps, "add");
          if (isSeq(addCaps)) for (const a of addCaps.items) if (isScalar(a) && DANGEROUS_CAPS.test(String(a.value).replace(/^CAP_/, ""))) add("K8S006", y.line(a as Node), `Container \`${cname}\` adds \`${a.value}\`.`);

          const image = scalar(get(c, "image"));
          if (typeof image === "string" && !image.includes("@sha256:")) {
            const tag = image.split("/").pop()!.split(":")[1];
            if (!tag || tag === "latest") add("K8S009", y.line(pairOf(c, "image")), `Container \`${cname}\` uses \`${image}\`${tag ? "" : " (no tag means latest)"}.`);
          }

          if (group === "containers" && !scalar(get(c, "resources", "limits", "memory"))) add("K8S010", y.line(pairOf(c, "resources") ?? pairOf(c, "image") ?? c.items[0]), `Container \`${cname}\` has no memory limit.`);

          const env = get(c, "env");
          if (isSeq(env)) {
            for (const e of env.items) {
              const k = String(scalar(get(e, "name")) ?? "");
              const v = scalar(get(e, "value"));
              if (SECRET_KEY.test(k) && typeof v === "string" && looksLiteral(v)) add("K8S011", y.line(pairOf(e, "value")), `Container \`${cname}\` sets \`${k}\` to a literal value.`);
            }
          }
        });
      }
    }

    if (kind === "Role" || kind === "ClusterRole") {
      const rules = get(root, "rules");
      if (isSeq(rules)) {
        for (const r of rules.items) {
          const star = (k: string) => {
            const s = get(r, k);
            return isSeq(s) && s.items.some((x) => isScalar(x) && x.value === "*");
          };
          if (star("verbs") || star("resources")) add("K8S013", y.line(r as Node), `\`${kind} ${name}\` grants \`*\` on ${star("resources") ? "every resource" : "the listed resources"}${star("verbs") ? " for every action" : ""}.`, undefined, star("verbs") && star("resources") ? "critical" : "high");
        }
      }
    }

    if ((kind === "ClusterRoleBinding" || kind === "RoleBinding") && scalar(get(root, "roleRef", "name")) === "cluster-admin") {
      const subjects = get(root, "subjects");
      const broad = isSeq(subjects) && subjects.items.some((s) => /^(default|system:(serviceaccounts|authenticated|unauthenticated)(:.*)?)$/.test(String(scalar(get(s, "name")))));
      add("K8S014", y.line(pairOf(get(root, "roleRef"), "name")), `\`${name}\` binds \`cluster-admin\`${broad ? " to a default or very broad subject" : ""}.`, undefined, broad ? "critical" : "high");
    }

    if (kind === "Service") {
      const type = scalar(get(root, "spec", "type"));
      if (type === "LoadBalancer" || type === "NodePort") {
        const ports = get(root, "spec", "ports");
        if (isSeq(ports)) {
          for (const p of ports.items) {
            const port = Number(scalar(get(p, "port")));
            const target = Number(scalar(get(p, "targetPort")));
            const db = PRIVATE_PORTS[port] ?? PRIVATE_PORTS[target];
            if (db) add("K8S015", y.line(p as Node), `\`${name}\` is a \`${type}\` exposing ${db} (port ${port}).`);
          }
        }
      }
    }
  });
  return out;
}
