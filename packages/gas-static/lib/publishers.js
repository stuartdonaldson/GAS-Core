'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_FILE = 'PUBLISHERS.md';

/**
 * The publish guard (PLAN2 §3 F3/F4, ADR-0003).
 *
 * A static-host repo (`nuuc-it/Static`, `f3go30/static-pages`) is shared by several project repos,
 * each publishing into its own top-level folder. `publish.js` starts by `rm -rf`-ing the folder it
 * is about to write, using a path that came from another repo's `local.settings.json` — so a `dest`
 * of `pub` instead of `pub/pmix` deletes every other project's published site, and the chained
 * publish then commits and pushes that with no prompt.
 *
 * The fix is a declaration in the host repo, not a heuristic in the package: PUBLISHERS.md carries
 * the folder -> project -> live-URL table a human reads, and one fenced ```json block — the first
 * one in the file — that this module reads. Registering a new folder is a reviewed two-line edit in
 * the repo that owns the namespace.
 *
 * The structural checks below are the backstop for the bootstrap window (a host repo with no
 * manifest yet, or a manifest someone has just broken). They are cheap and always active.
 */

/** Extracts and validates the ownership map from PUBLISHERS.md's first fenced ```json block. */
function parseOwnershipMap_(markdown) {
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(markdown);
  if (!m) {
    throw new Error(`gas-static: ${MANIFEST_FILE} has no fenced \`\`\`json block — the ownership map is missing.`);
  }
  let map;
  try {
    map = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`gas-static: ${MANIFEST_FILE}'s ownership map is not valid JSON — ${err.message}`);
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`gas-static: ${MANIFEST_FILE}'s ownership map must be a JSON object of "dest": { project, env, url }.`);
  }
  for (const [dest, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== 'object' || typeof entry.project !== 'string' || !entry.project) {
      throw new Error(`gas-static: ${MANIFEST_FILE} entry "${dest}" has no "project" — every published folder must name its owning repo.`);
    }
  }
  return map;
}

/** Reads the host repo's manifest. Returns null when the repo has none (bootstrap window). */
function loadOwnershipMap_(repoRoot) {
  const manifestPath = path.join(repoRoot, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;
  return { manifestPath, map: parseOwnershipMap_(fs.readFileSync(manifestPath, 'utf8')) };
}

function normalizeDest_(dest) {
  return String(dest).replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Structural backstop. Refuses a dest that is empty, absolute, contains '..', resolves outside the
 * host repo, resolves *to* the host repo, or names a `.git` directory. Returns the resolved path.
 */
function assertSafeDest_(repoRoot, dest) {
  if (dest === undefined || dest === null || String(dest).trim() === '') {
    throw new Error('gas-static: envs[env].dest is empty — a publish target must be declared.');
  }
  const raw = String(dest);
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error(`gas-static: dest "${raw}" is absolute — it must be relative to the host repo root.`);
  }
  const parts = normalizeDest_(raw).split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) {
    throw new Error(`gas-static: dest "${raw}" must not contain '..' — a publish may not reach outside its own folder.`);
  }
  if (parts.includes('.git')) {
    throw new Error(`gas-static: dest "${raw}" names a '.git' directory — refusing to publish into git's own storage.`);
  }
  const resolved = path.resolve(repoRoot, parts.join('/'));
  const root = path.resolve(repoRoot);
  if (resolved === root) {
    throw new Error(`gas-static: dest "${raw}" resolves to the host repo root itself — a publish would delete the whole repo.`);
  }
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`gas-static: dest "${raw}" resolves outside the host repo (${root}).`);
  }
  if (fs.existsSync(path.join(resolved, '.git'))) {
    throw new Error(`gas-static: dest "${raw}" contains a '.git' directory — it is a repository, not a published folder.`);
  }
  return resolved;
}

/**
 * The full guard: structural checks first (so `rm -rf` is unreachable while any of them fails),
 * then the host repo's declaration. A missing or malformed manifest warns and leaves the structural
 * checks as the only guard; a present manifest is authoritative and fails closed.
 */
function assertRegisteredDest_({ repoRoot, dest, projectName, warn = () => {} }) {
  const resolved = assertSafeDest_(repoRoot, dest);
  const key = normalizeDest_(dest);

  let loaded;
  try {
    loaded = loadOwnershipMap_(repoRoot);
  } catch (err) {
    warn(`${err.message} Publishing with the structural checks only — fix ${path.join(repoRoot, MANIFEST_FILE)}.`);
    return { registered: false, reason: 'malformed-manifest', resolved };
  }
  if (!loaded) {
    warn(
      `gas-static: ${repoRoot} has no ${MANIFEST_FILE} — publishing "${key}" with the structural checks only. ` +
      `Add ${MANIFEST_FILE} so the host repo declares which project owns which folder.`
    );
    return { registered: false, reason: 'no-manifest', resolved };
  }

  const entry = loaded.map[key];
  if (!entry) {
    throw new Error(
      `gas-static: dest "${key}" is not registered in ${loaded.manifestPath}. ` +
      `Registered: ${Object.keys(loaded.map).join(', ') || '(none)'}. ` +
      'Add an entry there (project, env, url) before publishing to a new folder.'
    );
  }
  if (!projectName) {
    throw new Error(
      `gas-static: config.projectName is not declared, so ownership of "${key}" (registered to ` +
      `${entry.project} in ${loaded.manifestPath}) cannot be checked. Declare projectName in the static config.`
    );
  }
  if (entry.project !== projectName) {
    throw new Error(
      `gas-static: dest "${key}" is registered to ${entry.project} in ${loaded.manifestPath}, ` +
      `but this project declares projectName "${projectName}". Refusing to overwrite another project's published folder.`
    );
  }
  return { registered: true, entry, manifestPath: loaded.manifestPath, resolved };
}

module.exports = {
  MANIFEST_FILE,
  parseOwnershipMap_,
  loadOwnershipMap_,
  assertSafeDest_,
  assertRegisteredDest_,
};
