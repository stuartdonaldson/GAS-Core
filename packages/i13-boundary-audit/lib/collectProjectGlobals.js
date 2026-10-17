'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Vendored verbatim (logic unchanged, only re-commented) from GActionSheet/eslint.config.js
 * (`collectProjectGlobals`, as of the commit read for GAS-Core-o4j, 2026-09-14). Copied rather
 * than required for the same reason as lib/gasGlobals.js: no import path from GAS-Core back to
 * GActionSheet exists, and re-deriving a regex-based flat-global-scope reconstruction would be
 * pure waste when a working, reviewed one already exists.
 *
 * GAS has a flat global scope with no import graph: a top-level `function foo() {}` or
 * `var foo = ...` in any file of a clasp-bundled project becomes the SAME global `foo` at
 * runtime once GAS concatenates every file into one execution context. ESLint lints one file at
 * a time and has no idea of that — so without this, `no-undef` (and, more to this tool's point,
 * `no-restricted-globals`) cannot tell "a real GAS platform global" apart from "a name this
 * project declared itself," which is exactly the distinction the I13 ownership check needs:
 * only PLATFORM boundary identifiers are governed, and a project-declared helper of the same
 * shape must never be mistaken for one.
 *
 * Deliberately regex-based, not a full parse: top-level-anchored `^function `/`^var ` matches
 * the declaration style GAS/clasp projects converge on and stays legible to the next person who
 * has to extend it, unlike hand-rolling an AST walk for what is otherwise a one-off scan.
 */
function collectProjectGlobals(srcDir) {
  const globals = {};
  const funcRe = /^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
  const varRe = /^var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=;]/;
  for (const entry of fs.readdirSync(srcDir)) {
    if (!entry.endsWith('.js')) continue;
    const lines = fs.readFileSync(path.join(srcDir, entry), 'utf8').split('\n');
    for (const line of lines) {
      const m = funcRe.exec(line) || varRe.exec(line);
      if (m) globals[m[1]] = 'writable';
    }
  }
  return globals;
}

module.exports = { collectProjectGlobals };
