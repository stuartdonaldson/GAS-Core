#!/usr/bin/env node
'use strict';

/**
 * Convenience CLI for i13-boundary-audit.
 *
 * Normal integration is `buildI13Blocks()` spread into a project's own eslint.config.js and run
 * via that project's own `eslint` (see README.md "Using it in CI"). This CLI exists for two
 * cases that don't fit that path:
 *
 *   1. Verifying the tool against a project it does not want to modify (a scratch config
 *      outside the target repo, pointed at the target repo's source directory).
 *   2. Measuring retrofit cost (--measure) BEFORE any ownership map exists — a raw per-
 *      identifier, per-file occurrence count. This is deliberately NOT the enforcement path:
 *      it never reads an i13.config.js and produces no pass/fail. It answers "how big is this"
 *      not "is this correct" — see README.md's (boundary, operation) limit for why those differ.
 *
 * Usage:
 *   node bin/i13-audit.js --src <dir> --config <path-to-i13.config.js>   # enforce + report
 *   node bin/i13-audit.js --src <dir> --measure                          # retrofit-cost report
 *   node bin/i13-audit.js --src <dir> --config <path> --list-exceptions  # print exception inventory only
 */

const path = require('path');
const fs = require('fs');

const { buildStandaloneConfig, listExceptions } = require('../index.js');
const { gasGlobals } = require('../lib/gasGlobals.js');

function parseArgs(argv) {
  const args = { src: null, config: null, measure: false, listExceptions: false, identifiers: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') args.src = argv[++i];
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--measure') args.measure = true;
    else if (a === '--list-exceptions') args.listExceptions = true;
    else if (a === '--identifiers') args.identifiers = argv[++i].split(',').map((s) => s.trim());
  }
  return args;
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(resolved);
}

/**
 * --measure: raw per-identifier, per-file occurrence scan. No ownership map, no pass/fail —
 * see the module doc comment above for why this is a separate, non-enforcement mode.
 */
function measure(srcDir, identifiers) {
  const targets = identifiers && identifiers.length ? identifiers : Object.keys(gasGlobals);
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'));
  const counts = {};
  for (const id of targets) counts[id] = { files: [], occurrences: 0 };

  for (const file of files) {
    const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const id of targets) {
      const re = new RegExp(`\\b${id}\\b`, 'g');
      const m = text.match(re);
      if (m && m.length) {
        counts[id].files.push(file);
        counts[id].occurrences += m.length;
      }
    }
  }

  const rows = Object.entries(counts)
    .filter(([, v]) => v.files.length > 0)
    .sort((a, b) => b[1].files.length - a[1].files.length);

  console.log(`Retrofit-cost measurement (raw identifier scan, NOT I13 enforcement): ${srcDir}`);
  console.log('identifier'.padEnd(20), 'files'.padEnd(8), 'occurrences');
  for (const [id, v] of rows) {
    console.log(id.padEnd(20), String(v.files.length).padEnd(8), v.occurrences);
  }
  console.log('\nPer-identifier file lists:');
  for (const [id, v] of rows) {
    console.log(`  ${id}: ${v.files.join(', ')}`);
  }
  console.log(
    '\nThis counts files NAMING an identifier, not (boundary, operation) pairs — two files ' +
      'naming the same identifier against two different remote contracts both count here. ' +
      'Human review is still required to turn this into an ownership map. See README.md.'
  );
}

async function enforce(srcDir, i13Config) {
  let ESLintClass;
  try {
    // Deliberately required lazily and from the CALLER's resolution path (see README.md
    // "Dependencies"): this tool does not bundle eslint. It is expected to run either inside a
    // consuming project's own `eslint` invocation (the normal path) or, for out-of-repo
    // verification runs like this CLI, against whatever eslint is reachable from the current
    // working directory / NODE_PATH.
    // eslint-disable-next-line global-require
    ({ ESLint: ESLintClass } = require('eslint'));
  } catch (err) {
    console.error(
      'i13-audit: could not load "eslint" (not a bundled dependency of this tool — see ' +
        'README.md "Dependencies"). Run this from a project that has eslint installed, or set ' +
        'NODE_PATH to one that does.'
    );
    process.exitCode = 2;
    return;
  }

  const config = buildStandaloneConfig(i13Config, { srcDir });
  const eslint = new ESLintClass({
    overrideConfigFile: true,
    overrideConfig: config,
    cwd: srcDir,
  });

  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'));
  const results = await eslint.lintFiles(files.map((f) => path.join(srcDir, f)));

  let errorCount = 0;
  for (const r of results) {
    for (const msg of r.messages) {
      if (msg.ruleId === 'i13/boundary-ownership') {
        errorCount++;
        console.log(`${path.relative(srcDir, r.filePath)}:${msg.line}:${msg.column}  ${msg.message}`);
      }
    }
  }

  console.log(`\nI13 boundary-ownership violations: ${errorCount}`);

  const exceptions = listExceptions(i13Config);
  console.log(`\nDeclared exceptions (${exceptions.length}):`);
  for (const e of exceptions) {
    console.log(`  ${e.identifier} in ${e.file} — ${e.reason}`);
  }

  process.exitCode = errorCount > 0 ? 1 : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.src) {
    console.error('Usage: i13-audit --src <dir> (--config <path> | --measure) [--list-exceptions]');
    process.exitCode = 2;
    return;
  }
  const srcDir = path.resolve(args.src);

  if (args.measure) {
    measure(srcDir, args.identifiers);
    return;
  }

  if (!args.config) {
    console.error('--config <path-to-i13.config.js> is required unless --measure is given.');
    process.exitCode = 2;
    return;
  }
  const i13Config = loadConfig(args.config);

  if (args.listExceptions) {
    const exceptions = listExceptions(i13Config);
    console.log(`Declared exceptions (${exceptions.length}):`);
    for (const e of exceptions) {
      console.log(`  ${e.identifier} in ${e.file} — ${e.reason}`);
    }
    return;
  }

  await enforce(srcDir, i13Config);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
