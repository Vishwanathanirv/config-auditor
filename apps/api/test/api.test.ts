import { describe, expect, it } from "vitest";
import { SAMPLES } from "@redline/core";
import { buildApp } from "../src/app";

describe("API", () => {
  it("audits several files at once and says which it didn't recognise", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/audit", payload: { files: [...SAMPLES, { name: "notes.txt", text: "hello" }] } });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.reports).toHaveLength(SAMPLES.length);
    expect(j.unknown).toEqual(["notes.txt"]);
    expect(j.reports[0].findings[0]).toHaveProperty("fixable");
    expect(j.reports[0].findings[0]).not.toHaveProperty("edits");
  });

  it("returns SARIF when asked", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/audit", payload: { files: SAMPLES.slice(0, 1), format: "sarif" } });
    expect(r.json().version).toBe("2.1.0");
  });

  it("fixes only the rules asked for and returns a patch", async () => {
    const app = await buildApp();
    const df = SAMPLES[0];
    const r = await app.inject({ method: "POST", url: "/api/fix", payload: { name: df.name, text: df.text, rules: ["DF010"] } });
    const j = r.json();
    expect(j.fixed).toEqual(["DF010"]);
    expect(j.patch).toContain('+LABEL maintainer="Shopfront Team <ops@shopfront.example>"');
    expect(j.text).toContain("CMD npm start");
  });

  it("rejects bad input clearly", async () => {
    const app = await buildApp();
    expect((await app.inject({ method: "POST", url: "/api/audit", payload: { files: [] } })).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/fix", payload: { name: "x.txt", text: "hi" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/Pass "kind"/);
  });

  it("lists the rules", async () => {
    const app = await buildApp();
    const rules = (await app.inject({ url: "/api/rules" })).json();
    expect(rules.length).toBeGreaterThan(50);
    expect(rules.every((r: { why: string; fix: string }) => r.why && r.fix)).toBe(true);
  });
});
