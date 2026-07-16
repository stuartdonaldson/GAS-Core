#!/usr/bin/env node
/**
 * Builds static/src/index.html into per-environment, publishable copies under
 * static/dist/<env>/index.html.
 *
 * Generic template for Step 5 of ../README.md ("Build and publish as their own pipeline stage").
 * The only thing this build step changes is stamping a version placeholder in the source
 * (`var STATIC_BUILD_VERSION_ = null;`) with a real version string, plus copying static assets
 * (favicon, etc.) unmodified alongside it. The page should always reconcile this fast, offline
 * first-paint value against the live GAS-reported version on its first API call — it does not
 * need to match whichever version is actually live on that environment's deployment at build
 * time (see the CONFIG_VERSION_ pattern in gas-backend-example.js's demoPing_).
 *
 * Adapt ENVIRONMENTS / versionStringFor() to however this project names its deploy targets
 * (e.g. sit/prod, staging/production, or a single "prod" if there's no multi-env split).
 *
 * Usage:
 *   node build-static-pages.js [--env <name>|all]   (default: all)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // repo root, when copied to <project>/tools/
const SRC_PATH = path.join(ROOT, 'static', 'src', 'index.html');
const ASSETS_SRC_DIR = path.join(ROOT, 'static', 'src', 'assets');
const DIST_ROOT = path.join(ROOT, 'static', 'dist');
const PKG_PATH = path.join(ROOT, 'package.json');

const ENVIRONMENTS = ['sit', 'prod']; // rename/extend to match this project's deploy targets

const PLACEHOLDER = 'var STATIC_BUILD_VERSION_ = null;';

function versionStringFor(env, pkg) {
  // Non-prod environments append a build counter so every push is individually identifiable;
  // prod ships a bare semver. Adjust to match this project's own versioning scheme.
  if (env !== 'prod') return `${pkg.version}.${pkg.build || 0}`;
  return String(pkg.version);
}

function buildOne(env) {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const versionString = versionStringFor(env, pkg);
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  if (!src.includes(PLACEHOLDER)) {
    throw new Error(`static/src/index.html: expected placeholder not found: ${PLACEHOLDER}`);
  }
  const out = src.replace(PLACEHOLDER, `var STATIC_BUILD_VERSION_ = ${JSON.stringify(versionString)};`);
  const outDir = path.join(DIST_ROOT, env);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), out, 'utf8');
  // Small companion file a GAS-side "about" dialog can UrlFetchApp to show the live static
  // page's own build stamp alongside the backend's own version.
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify({ version: versionString }), 'utf8');
  if (fs.existsSync(ASSETS_SRC_DIR)) {
    const assetsOutDir = path.join(outDir, 'assets');
    fs.mkdirSync(assetsOutDir, { recursive: true });
    for (const entry of fs.readdirSync(ASSETS_SRC_DIR)) {
      fs.copyFileSync(path.join(ASSETS_SRC_DIR, entry), path.join(assetsOutDir, entry));
    }
  }
  console.log(`built static/dist/${env}/index.html (v${versionString})`);
}

function main() {
  const args = process.argv.slice(2);
  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'all';
  const envs = env === 'all' ? ENVIRONMENTS : [env];
  envs.forEach(buildOne);
}

main();
