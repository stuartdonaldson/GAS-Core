'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadSettings_(config) {
  const settingsPath = config.settingsPath || path.join(config.root, 'local.settings.json');
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`gas-static: ${settingsPath} not found`);
  }
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function copyDir_(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir_(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Publishes one env's built dist/ output into its sibling static-hosting repo, per
 * RECOMMENDATION §3.1's one policy for the two divergences:
 *
 *   - missing repo path (envDef.repoKey unset in local.settings.json) = warn and skip, not a
 *     hard failure — a fresh clone without the sibling repo checked out should still deploy;
 *   - prompt before a cross-repo push, unless `chained` (invoked from a deploy pipeline that
 *     already confirmed) or `yes` (non-interactive) — the same human-in-the-loop norm every
 *     other cross-repo push in these projects uses.
 *
 * `git add`/`git status` are always scoped to envDef.dest — an unscoped add publishes another
 * app's half-finished work out of a shared host repo (RCV's finding).
 */
async function publishEnv(config, envKey, options = {}) {
  const {
    yes = false,
    chained = false,
    confirmFn,
    log = () => {},
    warn = () => {},
    exec = execFileSync,
  } = options;

  const envDef = config.envs && config.envs[envKey];
  if (!envDef) throw new Error(`gas-static: unknown env '${envKey}'`);

  const settings = loadSettings_(config);
  const repoPathSetting = settings[envDef.repoKey];
  if (!repoPathSetting) {
    warn(`gas-static: ${envDef.repoKey} is not set in local.settings.json — skipping publish for '${envKey}'.`);
    return { skipped: true, reason: 'no-repo-path' };
  }
  const repoRoot = path.resolve(config.root, repoPathSetting);
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    throw new Error(`gas-static: ${repoRoot} does not look like a git checkout (no .git found)`);
  }

  const srcDir = path.join(config.root, config.distDir, envKey);
  if (!fs.existsSync(srcDir)) {
    throw new Error(`gas-static: ${srcDir} not found — build it first`);
  }

  const dest = path.join(repoRoot, envDef.dest);
  copyDir_(srcDir, dest);
  log(`copied ${config.distDir}/${envKey} -> ${path.relative(config.root, dest)}`);

  const status = exec('git', ['status', '--porcelain', '--', envDef.dest], { cwd: repoRoot }).toString().trim();
  if (!status) {
    log(`${envDef.dest} already matches build output — nothing to publish.`);
    return { skipped: true, reason: 'up-to-date' };
  }

  if (!yes && !chained) {
    const proceed = confirmFn ? await confirmFn(`Commit and push ${envDef.dest} to ${repoRoot}?`) : true;
    if (!proceed) {
      log('Publish cancelled — dist/ copied locally but not committed/pushed.');
      return { skipped: true, reason: 'cancelled' };
    }
  }

  exec('git', ['add', envDef.dest], { cwd: repoRoot, stdio: 'inherit' });
  const message = config.commitMessage
    ? config.commitMessage({ env: envKey, envDef })
    : `Publish static ${envKey} (${envDef.label || envKey})`;
  exec('git', ['commit', '-m', message], { cwd: repoRoot, stdio: 'inherit' });
  exec('git', ['push'], { cwd: repoRoot, stdio: 'inherit' });
  log(`published ${envDef.dest} and pushed (${repoRoot}).`);
  return { published: true, repoRoot, dest: envDef.dest };
}

module.exports = { publishEnv, loadSettings_, copyDir_ };
