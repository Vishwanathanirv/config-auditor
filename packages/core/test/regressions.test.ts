import { describe, expect, it } from "vitest";
import { audit } from "../src";

const rules = (name: string, text: string, kind?: Parameters<typeof audit>[2]) => audit(name, text, kind).findings.map((f) => f.rule);

describe("kubernetes", () => {
  it("checks custom resources that embed a pod template (Knative, Argo Rollouts)", () => {
    const text = "apiVersion: serving.knative.dev/v1\nkind: Configuration\nmetadata:\n  name: c\nspec:\n  template:\n    spec:\n      hostIPC: true\n      containers:\n        - name: a\n          image: busybox:1.36\n";
    expect(rules("c.yaml", text)).toContain("K8S007");
  });

  it("does not report a token mount when the pod's service account turns it off", () => {
    const sa = "apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: quiet\nautomountServiceAccountToken: false\n---\n";
    const pod = (account: string) => `apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  serviceAccountName: ${account}\n  containers:\n    - name: a\n      image: busybox:1.36\n`;
    expect(rules("p.yaml", sa + pod("quiet"))).not.toContain("K8S012");
    expect(rules("p.yaml", sa + pod("other"))).toContain("K8S012");
  });
});

describe("nginx", () => {
  const ng = (text: string) => rules("site.conf", text, "nginx");

  it("checks included fragments that have no server block, without asking them for server-wide settings", () => {
    expect(ng("ssl_protocols SSLv3 TLSv1.2;\n")).toEqual(["NG002"]);
    expect(ng("location /files {\n    alias /home/;\n}\n")).toEqual(["NG007"]);
    expect(ng("server_tokens on;\n")).toEqual(["NG001"]);
    expect(ng("location / {\n    root /srv;\n}\n")).toEqual([]);
  });

  it("finds alias traversal through a regex capture that doesn't start after a slash", () => {
    expect(ng("location ~ /images(.*) {\n  alias /app/static/$1;\n}\n")).toEqual(["NG007"]);
    expect(ng("location ~ /images/(.*)$ {\n  alias /app/static/$1;\n}\n")).toEqual([]);
    expect(ng("location ~ /images(/.*) {\n  alias /app/static$1;\n}\n")).toEqual([]);
    expect(ng("location ~ /images([^.]*) {\n  alias /app/static/$1;\n}\n")).toEqual([]);
  });

  it("follows add_header_inherit merge and if blocks", () => {
    const merge = "server {\n    add_header X-Frame-Options DENY;\n    location /api/ {\n        add_header_inherit merge;\n        add_header Cache-Control no-store;\n    }\n}\n";
    expect(ng(merge)).not.toContain("NG008");
    const inIf = "server {\n    add_header X-Frame-Options DENY;\n    location / {\n        if ($request_method = OPTIONS) {\n            add_header Access-Control-Allow-Origin *;\n        }\n    }\n}\n";
    expect(ng(inIf)).toContain("NG008");
  });

  it("counts headers set with more_set_headers", () => {
    expect(ng('http {\n  server {\n    listen 443 ssl;\n    more_set_headers "Strict-Transport-Security: max-age=31536000";\n  }\n}\n')).not.toContain("NG005");
  });

  it("follows URL-decoded values through map, set and regex captures into headers and proxy_pass", () => {
    expect(ng('proxy_set_header "X-Original-Uri" $document_uri;\n')).toEqual(["NG011"]);
    expect(ng("map $host $a {\n  x $uri;\n  default 1;\n}\nmap $host $b {\n  x $a;\n  default 1;\n}\nadd_header X-H $b;\n")).toEqual(["NG011"]);
    expect(ng("location ~ /proxy/(a|b)/(\\W*)$ {\n    set $p $2;\n    proxy_pass http://storage/$p;\n}\n")).toEqual(["NG011"]);
    expect(ng("location ~ /proxy/(a|b)/(\\W*)$ {\n    set $p $1;\n    proxy_pass http://storage/$p;\n}\n")).toEqual([]);
    expect(ng("return 301 https://some$request_uri;\n")).toEqual([]);
    expect(ng("return 200 $uri;\n")).toEqual([]);
  });
});

describe("file detection", () => {
  it("does not treat source code or docs named after Dockerfiles as Dockerfiles", async () => {
    const { detect } = await import("../src");
    expect(detect("packages/core/src/dockerfile.ts", 'add("DF002")\nFROM x\nRUN y\n')).toBeNull();
    expect(detect("dockerfile-notes.md", "FROM node\nRUN npm i\n")).toBeNull();
    expect(detect("Dockerfile", "")).toBe("dockerfile");
    expect(detect("Dockerfile.prod", "")).toBe("dockerfile");
    expect(detect("api.dockerfile", "")).toBe("dockerfile");
    expect(detect("Containerfile", "")).toBe("dockerfile");
  });

  it("reads a Kubernetes manifest named nginx-deployment.yaml as Kubernetes", async () => {
    const { detect } = await import("../src");
    const text = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: http\nspec:\n  template:\n    metadata:\n      labels: {app: nginx}\n";
    expect(detect("nginx-deployment.yaml", text)).toBe("kubernetes");
  });
});

describe("dockerfile parsing", () => {
  it("joins continuations across comment and blank lines", () => {
    expect(rules("Dockerfile", "FROM debian:12\nRUN apt-get update && \\\n    # tools\n    apt-get install -y curl\nUSER app\n")).toContain("DF006");
  });

  it("honours the escape parser directive", () => {
    const text = "# escape=`\nFROM mcr.microsoft.com/windows/nanoserver:ltsc2022\nCOPY app C:\\app\\\nUSER ContainerUser\nCMD [\"app.exe\"]\n";
    expect(rules("Dockerfile", text)).not.toContain("DF002");
  });

  it("checks heredoc bodies", () => {
    const r = rules("Dockerfile", "FROM debian:12\nRUN <<EOF\ncurl -fsSL https://x.sh | sh\nchmod 777 /app\nEOF\nUSER app\n");
    expect(r).toContain("DF005");
    expect(r).toContain("DF008");
  });

  it("knows a stage built from an earlier stage inherits its USER", () => {
    expect(rules("Dockerfile", "FROM node:22.13 AS base\nUSER node\nFROM base\nCMD [\"node\", \"app.js\"]\n")).not.toContain("DF002");
  });

  it("keeps the final newline when it appends USER", async () => {
    const { fix } = await import("../src");
    expect(fix("Dockerfile", "FROM debian:12\nRUN echo hi\n").text).toBe("FROM debian:12\nRUN echo hi\nUSER 10001:10001\n");
  });
});

describe("diff", () => {
  it("stays fast and small on a large file with a small change", async () => {
    const { unifiedDiff } = await import("../src");
    const big = "FROM node:22\n" + "#\n".repeat(200_000);
    const t0 = performance.now();
    const d = unifiedDiff("Dockerfile", big, big.replace("FROM node:22\n", "FROM node:22\nUSER node\n"));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(d).toContain("+USER node");
  });
});
