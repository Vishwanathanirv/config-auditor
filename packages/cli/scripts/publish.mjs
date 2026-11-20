/* global console */
// Copies the built CLI to the two places it is published from (the GitHub Action folder and the
// website) and writes its SHA-256 next to each copy, in `sha256sum -c` format.
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(pkg, "../..");
const built = join(pkg, "dist/redline.cjs");
const sha = createHash("sha256").update(readFileSync(built)).digest("hex");

for (const dir of ["action", "apps/web/public"]) {
  copyFileSync(built, join(root, dir, "redline.cjs"));
  writeFileSync(join(root, dir, "redline.cjs.sha256"), `${sha}  redline.cjs\n`);
}
console.log(`Published redline.cjs, SHA-256 ${sha}`);
