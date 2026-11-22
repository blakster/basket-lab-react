#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.argv[2] ?? "src";
const skip = new Set(["lint-weight-constants.mjs"]);

const rules = [
  {
    re: /Math\.abs\(\s*overflow\s*\)\s*[<>]=?\s*0\.01/,
    msg: "Bare 0.01 is the leftover overflow epsilon. Use hasWeightOverflow / WEIGHT_CENT from lib/weights.ts.",
  },
  {
    re: /Math\.abs\(\s*overflow\s*\)\s*[<>]=?\s*WEIGHT_TOLERANCE/,
    msg: "Overflow uses WEIGHT_CENT via hasWeightOverflow. WEIGHT_TOLERANCE is basket-valid around 100.",
  },
  {
    re: /Math\.abs\([^;]{0,120}- 100\)\s*[<>]=?\s*0\.(?:1|01)\b/,
    msg: "Bare 0.1/0.01 next to a 100% weight sum. Use isWeightBalanced from lib/weights.ts.",
  },
  {
    re: /Math\.abs\([^;]{0,120}- 100\)\s*[<>]=?\s*WEIGHT_CENT/,
    msg: "Basket validity uses WEIGHT_TOLERANCE via isWeightBalanced, not WEIGHT_CENT.",
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(path, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(extname(name))) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(root);
let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = relative(process.cwd(), file);
  for (const rule of rules) {
    if (!rule.re.test(text)) continue;
    failed = true;
    console.error(`${rel}: ${rule.msg}`);
  }
}
if (failed) process.exit(1);
