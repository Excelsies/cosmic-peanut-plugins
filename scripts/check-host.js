// Checks this package against a Cosmic Peanut checkout:
//
//   npm run check:host -- ~/Projects/cosmic-peanut      (or COSMIC_PEANUT=<checkout> npm run check:host)
//
// 1. tidalviz.d.ts is a byte copy of <host>/web/sdk/tidalviz.d.ts.
// 2. src/lib/gl.js and src/lib/flash.js are byte copies of the built-ins' tested helpers.
// 3. tidalviz.json passes the host's own manifest loader (schema, semantic and file checks),
//    run with the host's Python environment (`uv sync` there first).
//
// Prints one line per check and exits 1 if any fails, 2 if the checkout can't be used.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPIES = [
  ["tidalviz.d.ts", "web/sdk/tidalviz.d.ts"],
  ["src/lib/gl.js", "plugins/builtin/src/lib/gl.js"],
  ["src/lib/flash.js", "plugins/builtin/src/lib/flash.js"],
];
const LOAD_MANIFEST = `
import sys
from pathlib import Path
from tidalviz.plugins.manifest import load_manifest
result = load_manifest(Path(sys.argv[1]))
for e in result.errors:
    print(f"    {e.path}: {e.message}")
sys.exit(1 if result.errors or result.manifest is None else 0)
`;

const arg = process.argv[2] ?? process.env.COSMIC_PEANUT;
if (!arg) {
  console.error("usage: npm run check:host -- <cosmic-peanut checkout>   (or set COSMIC_PEANUT)");
  process.exit(2);
}
const host = resolve(arg.replace(/^~(?=$|\/)/, homedir()));
if (!existsSync(join(host, "src/tidalviz/plugins/manifest.py"))) {
  console.error(`not a Cosmic Peanut checkout (no src/tidalviz/plugins/manifest.py): ${host}`);
  process.exit(2);
}
console.log(`Checking ${REPO}\n against ${host}`);

let failed = 0;
for (const [mine, theirs] of COPIES) {
  const problem = compare(join(REPO, mine), join(host, theirs));
  report(problem === null, `${mine} == <host>/${theirs}`, problem);
}

const uv = spawnSync(
  "uv",
  ["run", "--project", host, "--no-sync", "python", "-c", LOAD_MANIFEST, REPO],
  { encoding: "utf8" },
);
const output = `${uv.stdout ?? ""}${uv.stderr ?? ""}`.trimEnd();
if (uv.error) report(false, "host's load_manifest accepts tidalviz.json", `can't run uv: ${uv.error.message}`);
else report(uv.status === 0, "host's load_manifest accepts tidalviz.json", output || `exit ${uv.status}`);

console.log(failed ? `${failed} check(s) failed` : "all host checks passed");
process.exit(failed ? 1 : 0);

/**
 * @param {string} a
 * @param {string} b
 * @returns {string | null} why the two files differ, or null when they are byte-identical
 */
function compare(a, b) {
  if (!existsSync(a)) return `missing: ${a}`;
  if (!existsSync(b)) return `missing: ${b}`;
  const x = readFileSync(a);
  const y = readFileSync(b);
  if (x.equals(y)) return null;
  const n = Math.min(x.length, y.length);
  let i = 0;
  while (i < n && x[i] === y[i]) i++;
  const line = x.subarray(0, i).toString("utf8").split("\n").length;
  return `differ from line ${line} (${x.length} vs ${y.length} bytes); copy the host's file over`;
}

/**
 * @param {boolean} ok
 * @param {string} what
 * @param {string | null} detail
 */
function report(ok, what, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) {
    failed++;
    if (detail) console.log(detail.replace(/^(?! {4})/gm, "    "));
  }
}
