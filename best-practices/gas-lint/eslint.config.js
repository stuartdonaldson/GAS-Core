'use strict';

/**
 * GAS-Core standard ESLint config for an Apps Script project.
 * Copy to the repo root as `eslint.config.js`; edit only the two marked
 * PER-PROJECT blocks below.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (the one thing worth understanding before editing it)
 * ---------------------------------------------------------------------------
 * Apps Script has a FLAT GLOBAL SCOPE and no import graph. clasp concatenates
 * every `.js` file in the script project into one execution context, so a
 * top-level `function foo() {}` in one file IS the global `foo` that another
 * file calls. There is no build step to notice when that helper is moved,
 * renamed, or deleted — the reference simply survives into production and
 * throws `ReferenceError` the first time that branch runs, possibly weeks
 * later, possibly in a trigger nobody is watching.
 *
 * ESLint lints one file at a time and has no idea about that shared scope, so
 * out of the box `no-undef` would flag every legitimate cross-file call.
 * `collectProjectGlobals` closes the gap the only way that does not require a
 * GAS-specific ESLint plugin (none exists on the registry — checked): it
 * regex-scans every source file for top-level `function NAME(` / `var NAME`
 * declarations and declares each one a project-wide global. `no-undef` then
 * validates a reference against "a real GAS built-in OR something actually
 * declared somewhere in this source tree" — which is exactly the invariant the
 * flat global scope has at runtime.
 *
 * Deliberately regex-based, not a full AST parse: top-level-anchored
 * `^function ` / `^var ` matches the declaration style GAS code is written in,
 * and stays legible to the next person who has to extend it. A nested or
 * conditionally-declared global is not matched, and that is fine — it would not
 * be a reliable cross-file global anyway.
 *
 * This lints in seconds and catches a class of defect a full test sweep can
 * miss, which is why it belongs at the merge gate alongside the regression
 * suite. See README.md in this folder for the policy.
 */

const fs = require('fs');
const path = require('path');

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

/**
 * PER-PROJECT #1 — GAS built-in services.
 *
 * List the services this project ACTUALLY references (`grep` for them; do not
 * paste a generic list of everything Apps Script offers), plus every advanced
 * service declared in `appsscript.json`'s `enabledAdvancedServices`. A service
 * missing from here surfaces as a false `no-undef`; a service listed but unused
 * costs nothing but misleads the next reader about what this project touches.
 */
const gasGlobals = {
  // Core services
  SpreadsheetApp: 'readonly',
  DocumentApp: 'readonly',
  DriveApp: 'readonly',
  CardService: 'readonly',
  ContentService: 'readonly',
  HtmlService: 'readonly',
  PropertiesService: 'readonly',
  ScriptApp: 'readonly',
  LockService: 'readonly',
  CacheService: 'readonly',
  UrlFetchApp: 'readonly',
  MailApp: 'readonly',
  GmailApp: 'readonly',
  Session: 'readonly',
  Utilities: 'readonly',
  Logger: 'readonly',
  MimeType: 'readonly',
  // Advanced services (appsscript.json enabledAdvancedServices) — PER-PROJECT
  Drive: 'readonly',
  Docs: 'readonly',
  // V8 runtime
  console: 'readonly',
};

/**
 * PER-PROJECT #2 — where the GAS sources live. `src/` is the convention; a repo
 * using `script/` changes both the glob and the path below, and nothing else.
 */
const SRC_GLOB = 'src/**/*.js';
const SRC_DIR = path.join(__dirname, 'src');

module.exports = [
  {
    files: [SRC_GLOB],
    languageOptions: {
      // 2022, not 2019: GAS's V8 runtime supports optional chaining (`?.`) and
      // friends fine, but an older ecmaVersion cannot PARSE them and reports a
      // false "Parsing error" on a perfectly valid file.
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...gasGlobals, ...collectProjectGlobals(SRC_DIR) },
    },
    linterOptions: {
      // A suppression comment that no longer suppresses anything (because the
      // code it guarded moved or was fixed) is a dead directive nobody is
      // reading. Flag it rather than keeping it forever.
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      // The actual safety net: the flat-global-scope class described in the
      // header, plus two cheap dead-code checks. 'error' from day one on a new
      // repo — there is nothing to ratchet, and a repo that starts green stays
      // green. See README.md for adopting this on a repo with a backlog.
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',

      // 'warn', permanently, and NOT as a deferred ratchet. GAS entry points
      // (doGet, doPost, onOpen, menu and trigger callbacks, manifest-bound
      // handlers) are called BY NAME by the platform, from outside any file
      // ESLint can see, so single-file analysis reports them as unused. That is
      // a permanent property of Apps Script, not a backlog a cleanup pass
      // eliminates. `args: 'none'` covers the mandatory-but-unused `e` param
      // those callbacks receive.
      //
      // Consequence worth stating: if this warning count grows for any reason
      // OTHER than a new entry point — a genuinely dead local, an orphaned
      // catch variable — that growth is real debt and should be fixed then, not
      // allowed to accumulate into a backlog that makes the rule unreadable.
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
];
