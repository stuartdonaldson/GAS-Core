'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TAG_RE = /^(gas-[a-z0-9-]+)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

function parseTag(tag) {
  const m = TAG_RE.exec(tag);
  if (!m) return null;
  return { pkgName: m[1], version: m[2] };
}

function defaultReadPackageVersion(pkgName) {
  const pkgJsonPath = path.join(__dirname, '..', '..', 'packages', pkgName, 'package.json');
  const raw = fs.readFileSync(pkgJsonPath, 'utf8');
  return JSON.parse(raw).version;
}

function checkTagVersion(tag, { readPackageVersion = defaultReadPackageVersion } = {}) {
  const parsed = parseTag(tag);
  if (!parsed) {
    return { ok: false, message: `Tag "${tag}" does not match the gas-<name>-v<version> shape.` };
  }
  const { pkgName, version } = parsed;
  let pkgVersion;
  try {
    pkgVersion = readPackageVersion(pkgName);
  } catch (err) {
    return {
      ok: false,
      message: `Tag "${tag}" names package "${pkgName}", but packages/${pkgName}/package.json could not be read: ${err.message}`,
    };
  }
  if (pkgVersion !== version) {
    return {
      ok: false,
      message: `Tag "${tag}" claims version ${version}, but packages/${pkgName}/package.json declares ${pkgVersion}.`,
    };
  }
  return { ok: true };
}

module.exports = { parseTag, checkTagVersion };
