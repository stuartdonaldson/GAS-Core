'use strict';

const fs = require('fs');

/**
 * Which version of the deploy tooling is this checkout actually running? (PLAN2 F10.)
 *
 * Five repos consume `gas-deploy`/`gas-static` by **git tag**, and three of them sat two minor
 * versions behind for months with nothing anywhere saying so — including for fixes shipped
 * precisely to remove their onboarding friction. A repo-wide "what is pinned where" checker is not
 * worth building for five repos; printing the resolved version on every deploy is, because it puts
 * the number in front of the one person who can act on it, next to a CHANGELOG that says what the
 * newer version would give them.
 *
 * Resolved from the **consumer's** node_modules, not from this file's own package.json: what
 * matters is the version installed in the checkout doing the deploy.
 */
const TOOLING_PACKAGES = ['gas-deploy', 'gas-static'];

function resolveToolingVersions(root, packages = TOOLING_PACKAGES) {
  const out = [];
  for (const name of packages) {
    try {
      const manifest = require.resolve(`${name}/package.json`, { paths: [root] });
      const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (version) out.push({ name, version });
    } catch {
      // Not installed here (a consumer with no static page has no gas-static), or resolution is
      // unavailable. A provenance row must never be able to fail a deploy.
    }
  }
  return out;
}

/** The `printDeploySummary({ tooling })` row. */
function toolingRow(root, packages = TOOLING_PACKAGES) {
  const versions = resolveToolingVersions(root, packages);
  if (versions.length === 0) {
    return { label: 'Tooling', missing: '(not resolvable from this checkout)' };
  }
  return { label: 'Tooling', value: versions.map(({ name, version }) => `${name} v${version}`).join(' · ') };
}

module.exports = { resolveToolingVersions, toolingRow, TOOLING_PACKAGES };
