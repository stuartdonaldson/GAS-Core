'use strict';

const fs = require('fs');

/**
 * Reads BUILD_INFO fields out of a GAS-side version file (e.g. src/Version.js), the same file
 * gas-deploy's `buildInfoStamper` writes to as the last step of `clasp deploy`. Regex, not
 * require() — the target is a GAS script file (bare consts, no module.exports), not a requirable
 * Node module. Both quoted-key JSON-shaped literals (buildInfoStamper's output) and bare-key
 * literals (pre-package copies) are valid JS and both occur in checkouts, so key quotes are
 * optional here.
 */
function readBuildInfo_(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const field = (name) => {
    const m = content.match(new RegExp('"?' + name + '"?\\s*:\\s*"([^"]*)"'));
    return m ? m[1] : '';
  };
  return {
    version: field('version'),
    webappUrl: field('webappUrl'),
    env: field('env'),
  };
}

module.exports = { readBuildInfo_ };
