#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const OWNER = "apps/api/app/db.py";
const NEEDLE = /sqlite3\.connect\s*\(/;
const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "dist", ".worktrees"]);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else if (extname(entry.name) === ".py") acc.push(path);
  }
  return acc;
}

const errors = [];
for (const path of walk(".")) {
  const rel = relative(".", path).split("\\").join("/");
  const text = readFileSync(path, "utf8");
  if (!NEEDLE.test(text)) continue;
  if (rel !== OWNER) {
    errors.push(
      `${rel}: sqlite3.connect outside db.py drops check_same_thread=False and PRAGMA foreign_keys=ON. Use app.db.connect_db.`,
    );
    continue;
  }
  if (!/sqlite3\.connect\([^)]*check_same_thread\s*=\s*False/.test(text)) {
    errors.push(
      `${rel}: connect_db must pass check_same_thread=False so TestClient/uvicorn workers can use the connection.`,
    );
  }
  if (!/PRAGMA foreign_keys\s*=\s*ON/.test(text)) {
    errors.push(
      `${rel}: connect_db must execute PRAGMA foreign_keys = ON. SQLite defaults to off.`,
    );
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
