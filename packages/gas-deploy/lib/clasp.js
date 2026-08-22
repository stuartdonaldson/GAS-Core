'use strict';

/**
 * Every `clasp` invocation in this package goes through here.
 *
 * RECOMMENDATION.md finding #1: `execSync('clasp push -f')` with no `env` makes clasp fall back
 * to the default `~/.clasprc.json` — silently pushing to whatever project *that* account can
 * see, which is how code lands in the wrong script project. clasp reads its credential file
 * from the `clasp_config_auth` environment variable (lower-case, exact match — see
 * @google/clasp's commands/program.js). `CLASP_CONFIG` is NOT a real clasp variable; setting it
 * is a no-op that silently falls back.
 *
 * The invariant this file exists to enforce: there is no code path in this package that runs
 * bare `clasp`. `claspEnv()` is the only way to build the environment, and it always sets
 * `clasp_config_auth`.
 */

const os = require('os');
const path = require('path');

function expandHome(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * Resolves the credential file for a target. `claspAuthKey` is per-target on purpose: RCV
 * deploys its NUUC environment under an entirely separate Google account (`nuucAuth`) from
 * SIT/PROD (`claspAuth`), so auth resolution can never be a single global.
 */
function resolveClaspAuthPath(settings, claspAuthKey) {
  const key = claspAuthKey || 'claspAuth';
  const value = settings[key];
  if (!value) {
    throw new Error(`${key} is not set in local.settings.json — clasp would silently fall back to ~/.clasprc.json`);
  }
  return expandHome(value);
}

/** The only supported way to build an environment for a clasp child process. */
function claspEnv(settings, claspAuthKey, baseEnv = process.env) {
  return { ...baseEnv, clasp_config_auth: resolveClaspAuthPath(settings, claspAuthKey) };
}

/**
 * A freshly created/updated Apps Script deployment takes a few seconds to propagate on Google's
 * edge, so the very next call against it may fail transiently (RECOMMENDATION.md #9). Only
 * F3Go30 had this; every consumer gets it now.
 */
function execWithRetry(command, options, { attempts = 3, delayMs = 5000, exec, log = console.log, sleepSync } = {}) {
  const run = exec || require('child_process').execSync;
  const wait = sleepSync || ((ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); });

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return run(command, options);
    } catch (err) {
      if (attempt === attempts) throw err;
      log(`\n⚠️  Command failed (attempt ${attempt}/${attempts}), retrying in ${delayMs / 1000}s…`);
      wait(delayMs);
    }
  }
}

/**
 * Parses `clasp deployments` output. A line looks like:
 *   - AKfycbzwlKLu...UZA @269 - v2.5.0.9 GO30-APP
 * The always-present `@HEAD` test-deployment row is dropped — it is not a named deployment and
 * matching it would deploy to a URL nobody shares.
 */
function parseDeployments(output) {
  return String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('-') && !line.includes('@HEAD'))
    .map(line => {
      const match = line.match(/^-\s*(\S+)\s+@(\d+)(?:\s*-\s*(.*))?$/);
      return match
        ? { id: match[1], revision: match[2], description: (match[3] || '').trim(), raw: line }
        : { id: null, revision: null, description: '', raw: line };
    });
}

/** Runs `clasp deployments` for the current .clasp.json, through claspEnv. */
function listDeployments({ cwd, env, exec }) {
  const run = exec || require('child_process').execSync;
  if (!env || !env.clasp_config_auth) {
    throw new Error('listDeployments called without clasp_config_auth — build the env with claspEnv()');
  }
  return run('clasp deployments', { cwd, env }).toString();
}

/**
 * Revision resolution (RECOMMENDATION.md §3.1): parse `clasp deploy`'s own stdout first; on a
 * miss consult the deployment list and read the revision off the matching row. `listFn` is a
 * thunk so it is not invoked at all unless the parse missed — which is what makes the fallback
 * path assertable in a unit test without shelling out. Returns null only if both miss.
 */
function resolveRevision(deployStdout, deploymentId, listFn) {
  const match = String(deployStdout || '').match(/@(\d+)\b/);
  if (match) return match[1];

  const found = parseDeployments(listFn()).find(d => d.id === deploymentId);
  return found ? found.revision : null;
}

module.exports = {
  expandHome,
  resolveClaspAuthPath,
  claspEnv,
  execWithRetry,
  parseDeployments,
  listDeployments,
  resolveRevision,
};
