#!/usr/bin/env node
/**
 * Publishes the built static/dist/<env>/ output to a dedicated, generated-only static-hosting
 * repo (local.settings.json's staticPagesRepoPath, a sibling checkout — e.g. ../<project>Static)
 * that GitHub Pages actually serves. See ../README.md Step 5: keep the publish target out of the
 * main dev repo so the static page's release cadence isn't coupled to every push-to-main, and so
 * a public Pages site isn't served from a repo that also holds unrelated source.
 *
 * (If this project instead deploys static/ straight out of THIS repo via a GitHub Actions
 * workflow — see gh-pages-deploy.yml.example — you don't need this script at all; the Action
 * IS the publish step, and it fires directly off `static/`, no dist/ copy or sibling repo
 * required. Use this script when you specifically want the generated-only-repo isolation, e.g.
 * because the main repo can't be public but the Pages site needs to be.)
 *
 * Normally invoked automatically, once per target, as the last step of this project's own
 * deploy script — with --skip-bump, since deploy already bumped/reset package.json's "build"
 * counter for this push. A publish that didn't go through deploy() would either reuse a stale
 * build stamp or need to bump the same counter itself, double-counting against the next real
 * deploy.
 *
 * Runs build-static-pages.js first (so dist/ is never stale), then copies each requested env's
 * folder into <staticPagesRepoPath>/dist/<env>/, and commits + pushes from that repo.
 *
 * Usage:
 *   node publish-static-pages.js [--env <name>|all] [--skip-bump]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
// Adapt to wherever this project keeps its own build-counter bump helper.
const { bumpBuildNumber_ } = require('./manage-deployments.js');

const ROOT = path.resolve(__dirname, '..', '..'); // repo root, when copied to <project>/tools/
const DIST_ROOT = path.join(ROOT, 'static', 'dist');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json'); // gitignored, local-only config
const PKG_PATH = path.join(ROOT, 'package.json');

const ENVIRONMENTS = ['sit', 'prod']; // keep in sync with build-static-pages.js

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.error(`local.settings.json not found at ${SETTINGS_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'all';
  const envs = env === 'all' ? ENVIRONMENTS : [env];

  const settings = loadSettings();
  if (!settings.staticPagesRepoPath) {
    console.error('staticPagesRepoPath is not set in local.settings.json');
    process.exit(1);
  }
  const staticRepo = path.resolve(ROOT, settings.staticPagesRepoPath);
  if (!fs.existsSync(path.join(staticRepo, '.git'))) {
    console.error(`${staticRepo} does not look like a git checkout (no .git found)`);
    process.exit(1);
  }

  if (!args.includes('--skip-bump')) {
    const build = bumpBuildNumber_(PKG_PATH);
    console.log(`build number bumped to ${build}`);
  }

  console.log('building static pages...');
  execSync(`node ${path.join(__dirname, 'build-static-pages.js')} --env all`, { cwd: ROOT, stdio: 'inherit' });

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));

  envs.forEach((e) => {
    const src = path.join(DIST_ROOT, e);
    const dest = path.join(staticRepo, 'dist', e);
    if (!fs.existsSync(src)) {
      console.error(`${src} not found -- build did not produce it`);
      process.exit(1);
    }
    copyDir(src, dest);
    console.log(`copied static/dist/${e} -> ${path.relative(ROOT, dest)}`);
  });

  const status = execSync('git status --porcelain', { cwd: staticRepo }).toString().trim();
  if (!status) {
    console.log('static-hosting repo working tree already matches build output -- nothing to publish.');
    return;
  }

  execSync('git add dist', { cwd: staticRepo, stdio: 'inherit' });
  const message = `Publish static pages v${pkg.version}.${pkg.build || 0} (${envs.join(', ')})`;
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: staticRepo, stdio: 'inherit' });
  execSync('git push', { cwd: staticRepo, stdio: 'inherit' });
  console.log('published and pushed.');
}

main();
