#!/usr/bin/env node
/**
 * Fails on high or critical npm advisories, like `npm audit --audit-level=high`, except for advisories listed below
 * that have no fixed release yet and don't affect anything that ships. Each exception names the advisory, the reason
 * and what removes it, so the gate stays meaningful instead of being switched off.
 */
import { execFileSync } from "node:child_process";

const exceptions = new Map([
  [
    "GHSA-fc5q-39xc-vjpf",
    "ReDoS in picomatch's glob parser (CVE-2026-112366). It is reached only by Vite and Vitest globs that come from " +
      "this repository at build time, never by request data or shipped code, and there is no fixed npm release yet: it " +
      "affects every version up to 4.0.7, which is the latest. Remove this entry once picomatch 4.0.8 or later ships.",
  ],
]);

let report;
try {
  report = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (error) {
  // npm exits non-zero when it finds anything; the JSON report is still on stdout.
  report = error.stdout ?? "";
}

const audit = JSON.parse(report);
const blocking = new Set();
const accepted = new Set();

for (const vulnerability of Object.values(audit.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;

    const id = (via.url ?? "").split("/").pop();
    const line = `${vulnerability.name}: ${via.title} (${id ?? "no advisory id"}, ${via.severity})`;
    if (id && exceptions.has(id)) accepted.add(`${line}\n  accepted because: ${exceptions.get(id)}`);
    else blocking.add(line);
  }
}

for (const line of accepted) console.warn(`Accepted advisory: ${line}`);

if (blocking.size > 0) {
  console.error(`High or critical npm advisories with no accepted exception:\n- ${[...blocking].join("\n- ")}`);
  process.exit(1);
}

console.log("No unaccepted high or critical npm advisories.");
