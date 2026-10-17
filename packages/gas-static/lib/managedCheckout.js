'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { assertSafeDest_ } = require('./publishers.js');

/**
 * Managed host checkout (GAS-Core-bsi).
 *
 * When `local.settings.json` does not name a checkout of the shared static-host repo
 * (`settings[envDef.repoKey]`, now an optional override), gas-static keeps its own: a sparse,
 * blobless clone under a cache directory, materialising only the folders this project publishes
 * into. That is what ADR-0003's "each folder is owned 100% by one project repo" already asserts, so
 * nothing outside this project's folder is ever needed on disk.
 *
 * SAFETY. The publish that follows `rm -rf`s `<checkout>/<dest>`. A checkout the package created and
 * fast-forwards on its own can silently drift into a state nobody looked at, so every way it can be
 * wrong is a NAMED error (ManagedCheckoutError.code) raised before the publish writes anything:
 * DIRTY, DIVERGED, NO_UPSTREAM, WRONG_ORIGIN, NOT_A_CHECKOUT, INVALID_REPO, CLONE_FAILED,
 * SYNC_FAILED. This module never deletes, resets or cleans anything itself; the only mutations are
 * `git clone`, `git fetch`, `git merge --ff-only` and `git sparse-checkout set|add`, all of which
 * refuse to discard work.
 */

class ManagedCheckoutError extends Error {
  constructor(code, message) {
    super(`gas-static: [${code}] ${message}`);
    this.name = 'ManagedCheckoutError';
    this.code = code;
  }
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Default cache root: $GAS_STATIC_CACHE, else $XDG_CACHE_HOME/gas-static, else ~/.cache/gas-static. */
function defaultCacheRoot_(env = process.env) {
  if (env.GAS_STATIC_CACHE) return env.GAS_STATIC_CACHE;
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'gas-static');
}

function assertSlug_(repo) {
  if (typeof repo !== 'string' || !SLUG_RE.test(repo) || repo.split('/').some((p) => p === '.' || p === '..')) {
    throw new ManagedCheckoutError(
      'INVALID_REPO',
      `repo slug ${JSON.stringify(repo)} is not "owner/name". Declare it as staticHosts.<host>.repo in gas-project.json.`
    );
  }
}

/** The managed checkout's directory: <cacheRoot>/<owner>__<name>. Never outside cacheRoot. */
function managedRepoRoot_(cacheRoot, repo) {
  assertSlug_(repo);
  const root = path.resolve(cacheRoot);
  const dir = path.resolve(root, repo.replace('/', '__'));
  if (path.dirname(dir) !== root) {
    throw new ManagedCheckoutError('INVALID_REPO', `repo slug "${repo}" resolves outside the cache root ${root}.`);
  }
  return dir;
}

function defaultCloneUrl_(repo) {
  return `https://github.com/${repo}.git`;
}

function normUrl_(u) {
  return String(u).trim().replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();
}

function run_(exec, cwd, args, opts = {}) {
  const out = exec('git', args, { cwd, ...opts });
  return out == null ? '' : out.toString();
}

function isEmptyDir_(dir) {
  return fs.readdirSync(dir).length === 0;
}

/**
 * Makes sure a clean, current, sparse checkout of `repo` exists under `cacheRoot` with `dest`
 * materialised. Returns its absolute path. Throws ManagedCheckoutError and writes nothing else on any
 * unsafe state.
 *
 * @param {object} p
 * @param {Function} p.exec         execFileSync-compatible runner (injected in tests: no network).
 * @param {string}   p.cacheRoot
 * @param {string}   p.repo         "owner/name" from gas-project.json staticHosts.<host>.repo
 * @param {string}   [p.cloneUrl]   override; default https://github.com/<repo>.git
 * @param {string}   p.dest         the folder this project publishes into (sparse-checkout path)
 * @param {Function} [p.log]
 */
function ensureManagedCheckout_({ exec = execFileSync, cacheRoot, repo, cloneUrl, dest, log = () => {} }) {
  const repoRoot = managedRepoRoot_(cacheRoot, repo);
  // `dest` becomes a sparse-checkout path and later an rm -rf target: structural checks first.
  assertSafeDest_(repoRoot, dest);
  const url = cloneUrl || defaultCloneUrl_(repo);
  const destPath = String(dest).replace(/\\/g, '/').replace(/\/+$/, '');

  const exists = fs.existsSync(repoRoot);
  if (!exists || (fs.statSync(repoRoot).isDirectory() && isEmptyDir_(repoRoot))) {
    fs.mkdirSync(path.dirname(repoRoot), { recursive: true });
    log(`cloning ${url} -> ${repoRoot} (sparse, blobless)`);
    try {
      exec('git', ['clone', '--filter=blob:none', '--sparse', url, repoRoot], { cwd: path.dirname(repoRoot), stdio: 'inherit' });
      exec('git', ['sparse-checkout', 'set', destPath], { cwd: repoRoot, stdio: 'inherit' });
    } catch (err) {
      throw new ManagedCheckoutError('CLONE_FAILED', `could not create the managed checkout of ${url} at ${repoRoot}: ${err.message}`);
    }
    return repoRoot;
  }

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    throw new ManagedCheckoutError(
      'NOT_A_CHECKOUT',
      `${repoRoot} exists and is not empty but is not a git checkout. Refusing to use or replace it; remove it by hand or set the override in local.settings.json.`
    );
  }

  let top;
  try {
    top = run_(exec, repoRoot, ['rev-parse', '--show-toplevel']).trim();
  } catch (err) {
    throw new ManagedCheckoutError('NOT_A_CHECKOUT', `${repoRoot} has a .git entry git cannot read (${err.message}).`);
  }
  if (top && fs.realpathSync(top) !== fs.realpathSync(repoRoot)) {
    throw new ManagedCheckoutError('NOT_A_CHECKOUT', `${repoRoot} is inside another repository (${top}), not a checkout of its own.`);
  }

  let origin = '';
  try { origin = run_(exec, repoRoot, ['remote', 'get-url', 'origin']).trim(); } catch (err) { origin = ''; }
  if (normUrl_(origin) !== normUrl_(url)) {
    throw new ManagedCheckoutError(
      'WRONG_ORIGIN',
      `${repoRoot} has origin "${origin}", expected "${url}" for ${repo}. Refusing to publish into a checkout of a different repository.`
    );
  }

  const dirty = run_(exec, repoRoot, ['status', '--porcelain']).trim();
  if (dirty) {
    const lines = dirty.split('\n');
    throw new ManagedCheckoutError(
      'DIRTY',
      `the managed checkout ${repoRoot} has uncommitted changes (${lines.length} path(s), first: ${lines[0].trim()}). ` +
      `Refusing to publish. Inspect with: git -C ${repoRoot} status — then commit/push or discard them by hand.`
    );
  }

  try {
    exec('git', ['fetch', 'origin'], { cwd: repoRoot, stdio: 'inherit' });
  } catch (err) {
    throw new ManagedCheckoutError('SYNC_FAILED', `git fetch failed in ${repoRoot}: ${err.message}`);
  }

  try {
    run_(exec, repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  } catch (err) {
    throw new ManagedCheckoutError(
      'NO_UPSTREAM',
      `${repoRoot} is not on a branch with a tracking branch (detached HEAD?). Check out the host repo's default branch there.`
    );
  }
  const counts = run_(exec, repoRoot, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']).trim().split(/\s+/).map(Number);
  if (counts.length !== 2 || counts.some((n) => !Number.isInteger(n))) {
    throw new ManagedCheckoutError('SYNC_FAILED', `could not compare ${repoRoot} with its upstream (rev-list said ${JSON.stringify(counts)}).`);
  }
  const [ahead, behind] = counts;
  if (ahead > 0 && behind > 0) {
    throw new ManagedCheckoutError(
      'DIVERGED',
      `the managed checkout ${repoRoot} has diverged from its upstream (${ahead} local commit(s) not pushed, ${behind} upstream commit(s) not merged). ` +
      `Refusing to publish. Resolve by hand in ${repoRoot} (e.g. git pull --rebase), or delete the checkout to have it re-cloned.`
    );
  }
  if (behind > 0) {
    try {
      exec('git', ['merge', '--ff-only', '@{u}'], { cwd: repoRoot, stdio: 'inherit' });
    } catch (err) {
      throw new ManagedCheckoutError('SYNC_FAILED', `fast-forward of ${repoRoot} failed: ${err.message}`);
    }
  }
  // ahead-only (a previous publish committed but could not push) is not divergence: the publish's
  // own pull --rebase + push will deliver it.

  let sparse = '';
  try { sparse = run_(exec, repoRoot, ['config', '--get', 'core.sparseCheckout']).trim(); } catch (err) { sparse = ''; }
  if (sparse === 'true') {
    try {
      exec('git', ['sparse-checkout', 'add', destPath], { cwd: repoRoot, stdio: 'inherit' });
    } catch (err) {
      throw new ManagedCheckoutError('SYNC_FAILED', `git sparse-checkout add ${destPath} failed in ${repoRoot}: ${err.message}`);
    }
  }
  return repoRoot;
}

module.exports = {
  ManagedCheckoutError,
  defaultCacheRoot_,
  managedRepoRoot_,
  defaultCloneUrl_,
  ensureManagedCheckout_,
};
