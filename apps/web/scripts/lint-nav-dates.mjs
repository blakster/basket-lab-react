#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.argv[2] ?? "src";
const needle = /Object\.values\(\s*navs\s*\)\s*(?:\[0\]|\.at\(\s*0\s*\))/;
const skip = new Set(["lint-nav-dates.mjs"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(path, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(extname(name)) || name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(root);
let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!needle.test(text)) continue;
  failed = true;
  const rel = relative(process.cwd(), file);
  console.error(
    `${rel}: Object.values(navs)[0] is the #24 timeline bug. Use navDatesInRange from lib/series.ts.`,
  );
}
if (failed) process.exit(1);
