import { describe, expect, it } from "vitest";
import { isBinary, MAX_FILE, sanitizeEdits, sanitizeFiles } from "../src/shape";

describe("stored workspace shape", () => {
  it("drops anything that is not a list of named text files", () => {
    expect(sanitizeFiles(null)).toEqual([]);
    expect(sanitizeFiles({ name: "x" })).toEqual([]);
    expect(sanitizeFiles([null, 3, { name: 1, text: "" }, { name: "Dockerfile", text: "FROM a" }])).toEqual([{ id: "own:Dockerfile", name: "Dockerfile", text: "FROM a", own: true }]);
  });
  it("caps oversized text instead of loading it whole", () => {
    expect(sanitizeFiles([{ id: "a", name: "big", text: "x".repeat(MAX_FILE + 10) }])[0].text.length).toBe(MAX_FILE);
  });
  it("keeps only string edits to the examples", () => {
    expect(sanitizeEdits([1, 2])).toEqual({});
    expect(sanitizeEdits({ "sample:Dockerfile": "FROM b", "sample:x": 5, other: "y" })).toEqual({ "sample:Dockerfile": "FROM b" });
  });
  it("spots binary files", () => {
    expect(isBinary("FROM a\u0000")).toBe(true);
    expect(isBinary("FROM a")).toBe(false);
  });
});
