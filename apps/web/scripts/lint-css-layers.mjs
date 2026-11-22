#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const FORBIDDEN_IN_COMPONENTS = [
  {
    test: (selector) => /(^|[\s,])\.editor-title([\s,.:[#]|$)/.test(selector),
    fix: "Move .editor-title out of @layer components. shadcn DialogTitle uses text-lg in the utilities layer, which wins. Put the rule unlayered after the layer block, like lab-surfaces.css.",
  },
  {
    test: (selector) =>
      /(^|[\s,])\.editor-description([\s,.:[#]|$)/.test(selector),
    fix: "Move .editor-description out of @layer components. shadcn DialogDescription uses text-sm text-muted-foreground in the utilities layer. Put the rule unlayered after the layer block.",
  },
  {
    test: (selector) =>
      /(^|[\s,])\.fund-search-input([\s,.:[#]|$)/.test(selector),
    fix: "Move .fund-search-input out of @layer components. shadcn Input utilities win inside the layer. Put the rule unlayered after the layer block.",
  },
  {
    test: (selector) =>
      /forced-colors/.test(selector) && /basket-check/.test(selector),
    fix: "Move forced-colors .basket-check out of @layer components. The border-0 utility wins inside the layer and hides the toggle (#17).",
  },
];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function layerBlocks(css) {
  const blocks = [];
  const needle = "@layer components";
  let from = 0;
  while (from < css.length) {
    const at = css.indexOf(needle, from);
    if (at < 0) break;
    const open = css.indexOf("{", at);
    if (open < 0) break;
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(css.slice(open + 1, i));
          from = i + 1;
          break;
        }
      }
    }
  }
  return blocks;
}

function rules(css) {
  const found = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    let depth = 0;
    let j = open;
    for (; j < css.length; j += 1) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = css.slice(open + 1, j);
    if (selector && !selector.startsWith("@")) {
      found.push({ selector, body });
    } else if (selector.startsWith("@")) {
      found.push(...rules(body).map((rule) => ({
        selector: `${selector} ${rule.selector}`,
        body: rule.body,
      })));
    }
    i = j + 1;
  }
  return found;
}

function lintFile(path, css) {
  const errors = [];
  const stripped = stripComments(css);
  for (const block of layerBlocks(stripped)) {
    for (const rule of rules(block)) {
      for (const forbidden of FORBIDDEN_IN_COMPONENTS) {
        if (forbidden.test(rule.selector)) {
          errors.push(`${path}: ${forbidden.fix}`);
        }
      }
    }
  }
  for (const rule of rules(stripped)) {
    if (
      /text-overflow\s*:\s*ellipsis/i.test(rule.body) &&
      !/white-space\s*:\s*nowrap/i.test(rule.body)
    ) {
      errors.push(
        `${path}: ${rule.selector.trim()} uses text-overflow: ellipsis without white-space: nowrap. Add nowrap or the plate will not truncate (f8a5a29).`,
      );
    }
  }
  return errors;
}

function walkCss(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkCss(path));
    else if (extname(entry.name) === ".css") files.push(path);
  }
  return files;
}

const root = process.argv[2];
if (!root) {
  console.error("usage: node lint-css-layers.mjs <css-root>");
  process.exit(2);
}

const errors = walkCss(root).flatMap((path) =>
  lintFile(path, readFileSync(path, "utf8")),
);
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
