#!/usr/bin/env node
// MIT. Guarded release for the independent Media Studio.
// Only a clean, pushed main may upload. Checks run once, then one deploy, then
// the live source identity is read back.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const migrate = args.has("--migrate");

function run(command, options = {}) {
  return execFileSync(command[0], command.slice(1), {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: process.env,
  });
}

function fail(message) {
  console.error(`\nrelease refused: ${message}\n`);
  process.exit(1);
}

const status = run(["git", "status", "--porcelain"], { capture: true }).trim();
if (status) fail(`working tree is not clean:\n${status}`);

const branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).trim();
if (branch !== "main") fail(`release runs from main, not ${branch}`);

run(["git", "fetch", "origin", "main", "--quiet"]);
const head = run(["git", "rev-parse", "HEAD"], { capture: true }).trim();
const origin = run(["git", "rev-parse", "origin/main"], { capture: true }).trim();
if (head !== origin) fail("main is not pushed; push the reviewed commit first");

const manifest = JSON.parse(readFileSync(new URL("../app.manifest.json", import.meta.url), "utf8"));
if (manifest.repository !== "https://github.com/loftwah/composer-media-studio")
  fail("manifest repository does not match this app");

console.log(`checking ${head.slice(0, 12)}…`);
run(["pnpm", "check"]);

if (dryRun) {
  console.log("dry run: checks passed; nothing uploaded");
  process.exit(0);
}

if (migrate) {
  console.log("applying remote D1 migrations…");
  run(["npx", "wrangler", "d1", "migrations", "apply", "media-studio", "--remote"]);
}

const builtAt = new Date().toISOString();
run([
  "npx",
  "wrangler",
  "deploy",
  "--define",
  `__BUILD_REVISION__:${JSON.stringify(head)}`,
  "--define",
  `__BUILD_TIME__:${JSON.stringify(builtAt)}`,
]);

const originUrl = "https://media.loftwah.com";
const health = await fetch(`${originUrl}/healthz`, { headers: { "cache-control": "no-cache" } });
if (!health.ok) fail(`live health check failed (${health.status})`);
const payload = await health.json();
if (payload.revision !== head)
  fail(`live revision ${payload.revision} does not match released source ${head}`);

const built = await (await fetch(`${originUrl}/build.json`, { headers: { "cache-control": "no-cache" } })).json();
if (built.revision !== head) fail("build.json does not match released source");

console.log(`released ${head.slice(0, 12)} at ${builtAt}`);
console.log(`live: ${originUrl}/healthz`);
