/**
 * Redline's HTTP API: audit files, get fixes as a corrected file and a patch, and list the
 * rules. Stateless: nothing you send is stored.
 */

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { audit, fix, RULES, toSarif, unifiedDiff, type Kind } from "@redline/core";

const KINDS = ["dockerfile", "compose", "kubernetes", "nginx", "sshd"] as const;
const File = z.object({ name: z.string().min(1).max(300), text: z.string().max(500_000), kind: z.enum(KINDS).optional() });
const AuditBody = z.object({ files: z.array(File).min(1).max(50), format: z.enum(["json", "sarif"]).default("json") });
const FixBody = File.extend({ rules: z.array(z.string()).optional() });

const strip = (r: ReturnType<typeof audit>) => ({ ...r, findings: r.findings.map(({ edits, ...f }) => ({ ...f, fixable: !!edits?.length })) });

export async function buildApp(opts: { logger?: boolean; webDir?: string } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5_000_000 });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.get("/api/health", async () => ({ ok: true, rules: RULES.length }));
  app.get("/api/rules", async () => RULES);

  app.post("/api/audit", async (req, reply) => {
    const body = AuditBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
    const reports = body.data.files.map((f) => audit(f.name, f.text, f.kind as Kind | undefined));
    const unknown = reports.filter((r) => !r.kind).map((r) => r.name);
    if (body.data.format === "sarif") return toSarif(reports.filter((r) => r.kind));
    return { reports: reports.filter((r) => r.kind).map(strip), unknown };
  });

  app.post("/api/fix", async (req, reply) => {
    const body = FixBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
    const { name, text, rules } = body.data;
    const before = audit(name, text, body.data.kind as Kind | undefined);
    if (!before.kind) return reply.code(422).send({ error: `Couldn't tell what kind of file "${name}" is. Pass "kind".` });
    const r = fix(name, text, rules ? new Set(rules) : undefined, before.kind);
    return { text: r.text, patch: unifiedDiff(name, text, r.text), fixed: r.fixed, before: strip(before), after: strip(r.report) };
  });

  if (opts.webDir) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api") ? reply.sendFile("index.html") : reply.code(404).send({ error: "Not found" })));
  }
  return app;
}
