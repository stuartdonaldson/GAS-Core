'use strict';

/**
 * Version and build counters.
 *
 * RECOMMENDATION.md finding #5 — the source-of-truth inversion — is the rule this file exists to
 * enforce: **package.json is the sole source of truth for version and build, and the stamped
 * version file is generated, never read back.** Lineage A's `getVersionFromBuildInfo()` read the
 * display version back out of the file it had just written in order to build the deployment
 * description, which quietly made the version file authoritative mid-deploy. Nothing here reads
 * a version out of a stamped file; `stampVersion` returns what it wrote so callers never need to.
 *
 * Two counters, because they answer different questions:
 *   version — semver in package.json, bumped on a PROD/stable deploy, and reset build to 0
 *   build   — plain integer, bumped on a SIT/TEST deploy, so repeated test deploys are
 *             distinguishable (#6) without burning patch numbers between releases
 */

const fs = require('fs');

function readPkg_(pkgPath) {
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
}

function writePkg_(pkgPath, pkg) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

/** Increments the patch segment of package.json's semver "version". Stable-target path only. */
function bumpPatchVersion(pkgPath) {
  const pkg = readPkg_(pkgPath);
  const parts = String(pkg.version || '0.0.0').split('.');
  const patch = (parseInt(parts[2], 10) || 0) + 1;
  pkg.version = `${parts[0]}.${parts[1]}.${patch}`;
  writePkg_(pkgPath, pkg);
  return pkg.version;
}

/** Increments package.json's integer "build". Test-target path only. */
function bumpBuildNumber(pkgPath) {
  const pkg = readPkg_(pkgPath);
  pkg.build = (parseInt(pkg.build, 10) || 0) + 1;
  writePkg_(pkgPath, pkg);
  return pkg.build;
}

/** Resets package.json's "build" counter to 0. Called unconditionally by the stable path. */
function resetBuildNumber(pkgPath) {
  const pkg = readPkg_(pkgPath);
  pkg.build = 0;
  writePkg_(pkgPath, pkg);
}

/**
 * Computes the version string for a target from package.json alone.
 * `build: true` targets get `${version}.${build}`; stable targets get bare `${version}`.
 */
function computeVersion(pkgPath, { counter, skipBump, log = () => {} }) {
  if (counter === 'build') {
    if (!skipBump) log(`🔢 build number bumped to ${bumpBuildNumber(pkgPath)}`);
    const pkg = readPkg_(pkgPath);
    return `${pkg.version}.${pkg.build || 0}`;
  }
  if (!skipBump) log(`🔢 package.json version bumped to v${bumpPatchVersion(pkgPath)}`);
  resetBuildNumber(pkgPath);
  log('🔢 build counter reset to 0');
  return readPkg_(pkgPath).version;
}

/**
 * Replaces the value of a `const NAME = <value>;` line, appending the const if it is missing.
 * Deliberately line-oriented rather than a parse: the stamped file is a GAS source file that
 * also gets hand-edited, and a rewrite would lose its comments.
 */
function replaceConst(src, name, value) {
  const re = new RegExp(`^(const ${name}\\s*=\\s*)([^;]+)(;)`, 'm');
  if (re.test(src)) return src.replace(re, `$1${value}$3`);
  return src.trimEnd() + `\nconst ${name.padEnd(18)} = ${value};\n`;
}

module.exports = {
  bumpPatchVersion,
  bumpBuildNumber,
  resetBuildNumber,
  computeVersion,
  replaceConst,
};
