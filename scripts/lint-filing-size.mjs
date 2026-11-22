#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const OWNERS = new Set([
  "apps/api/app/ingest/upload.py",
  "apps/web/src/lib/api/insights.ts",
]);
const NEEDLE = "5 * 1024 * 1024";
const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "dist"]);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else if ([".py", ".ts", ".tsx"].includes(extname(entry.name))) acc.push(path);
  }
  return acc;
}

const extras = [];
for (const path of walk(".")) {
  const rel = relative(".", path).split("\\").join("/");
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes(NEEDLE) && !OWNERS.has(rel)) {
      extras.push(`${rel}:${i + 1}:${line.trim()}`);
    }
  });
}

if (extras.length) {
  console.error(
    "Filing size lives in app.ingest.upload.MAX_BYTES and FILING_MAX_BYTES in insights.ts. Import those. Do not copy 5 * 1024 * 1024.",
  );
  for (const line of extras) console.error(line);
  process.exit(1);
}
