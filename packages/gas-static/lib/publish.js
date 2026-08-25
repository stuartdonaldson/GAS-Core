'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertRegisteredDest_ } = require('./publishers.js');

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
 * Publishes one env's built dist/ output into its sibling static-hosting repo. The three
 * pre-package copies disagreed on two points; the policy each one resolves to (README
 * §Provenance records which copy each came from):
 *
 *   - missing repo path (envDef.repoKey unset in local.settings.json) = warn and skip, not a
 *     hard failure — a fresh clone without the sibling repo checked out should still deploy;
 *   - prompt before a cross-repo push, unless `chained` (invoked from a deploy pipeline that
 *     already confirmed) or `yes` (non-interactive) — the same human-in-the-loop norm every
 *     other cross-repo push in these projects uses.
 *
 * `git add`/`git status` are always scoped to envDef.dest — an unscoped add publishes another
 * app's half-finished work out of a shared host repo (RCV's finding).
 *
 * Before anything is written, `dest` is validated against the host repo's PUBLISHERS.md ownership
 * declaration plus the structural backstop (lib/publishers.js, ADR-0003): the `rm -rf` in
 * copyDir_() is unreachable until that passes.
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

  // Guard first, copy second: copyDir_() opens with rm -rf on a path that came from another repo's
  // local.settings.json, so validation must be the thing standing between that and a shared host repo.
  assertRegisteredDest_({ repoRoot, dest: envDef.dest, projectName: config.projectName, warn });

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

  // A shared host repo moves under us whenever another project publishes: our push is then a
  // non-fast-forward *after* the commit is already made, which fails the deploy with the page
  // committed locally and nothing published. The rebase can be automatic and unattended precisely
  // because of the ownership rule PUBLISHERS.md states — each folder's content is owned 100% by one
  // project repo, so two publishers can never touch the same path and a rebase can never conflict.
  // --autostash carries the just-copied files (still unstaged at this point) across the rebase.
  exec('git', ['fetch'], { cwd: repoRoot, stdio: 'inherit' });
  try {
    exec('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repoRoot });
  } catch (err) {
    throw new Error(
      `gas-static: ${repoRoot} is not on a branch with a tracking branch, so the publish cannot be ` +
      'rebased onto its remote before pushing. Check the branch out against its upstream and re-run.'
    );
  }
  exec('git', ['pull', '--rebase', '--autostash'], { cwd: repoRoot, stdio: 'inherit' });

  exec('git', ['add', envDef.dest], { cwd: repoRoot, stdio: 'inherit' });
  const message = config.commitMessage
    ? config.commitMessage({ env: envKey, envDef })
    : `Publish static ${envKey} (${envDef.label || envKey})`;
  exec('git', ['commit', '-m', message], { cwd: repoRoot, stdio: 'inherit' });
  try {
    exec('git', ['push'], { cwd: repoRoot, stdio: 'inherit' });
  } catch (err) {
    throw new Error(
      `gas-static: ${envDef.dest} is committed locally in ${repoRoot} but the push failed ` +
      `(${err.message}). Nothing is published yet; the work is not lost. Finish it with: ` +
      `cd ${repoRoot} && git pull --rebase && git push`
    );
  }
  log(`published ${envDef.dest} and pushed (${repoRoot}).`);
  return { published: true, repoRoot, dest: envDef.dest };
}

module.exports = { publishEnv, loadSettings_, copyDir_ };
