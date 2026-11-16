#!/usr/bin/env node
// Fails if an npm package in web/package-lock.json has a disallowed license.
// Shipped (production) packages must be MIT. Build/test tools may use other
// common open-source licenses, since they never reach users.
// Usage: node scripts/check-npm-licenses.mjs [path/to/package-lock.json]
import { readFileSync } from "node:fs";

const PROD_ALLOWED = new Set(["MIT"]);
const DEV_ALLOWED = new Set([
  "MIT", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "BlueOak-1.0.0",
  // lightningcss (Vite's CSS minifier): weak copyleft, build-time only.
  "MPL-2.0",
]);

const lockPath = process.argv[2] ?? "web/package-lock.json";
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const failures = [];
const counts = {};

for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path) continue; // the root project itself
  const license = meta.license ?? "UNKNOWN";
  const kind = meta.dev ? "dev" : "prod";
  counts[`${kind} ${license}`] = (counts[`${kind} ${license}`] ?? 0) + 1;
  const allowed = meta.dev ? DEV_ALLOWED : PROD_ALLOWED;
  if (!allowed.has(license)) failures.push(`${kind}: ${path.replace(/^.*node_modules\//, "")} ${meta.version} is '${license}'`);
}

console.log("Licenses: " + Object.entries(counts).sort().map(([k, v]) => `${k}=${v}`).join(", "));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`OK: shipped packages are ${[...PROD_ALLOWED].join(", ")}; build tools use allowed open-source licenses.`);
