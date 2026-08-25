'use strict';

const fs = require('fs');

/**
 * Finds the `BUILD_INFO = { … }` object literal and returns its body (the text between the
 * braces), or null when the file has no such literal.
 *
 * Brace-counting rather than a regex, because the two shapes in the estate differ: gas-deploy's
 * `buildInfoStamper` writes a multi-line literal closed by `};` at line start, while pre-package
 * copies and test fixtures write it on one line. A counter reads both, and — this is the point of
 * F13 — it stops at the literal's own closing brace, so nothing outside it can supply a field.
 */
function literalBody_(content, literalName) {
  // The name must be a whole token: `PREVIOUS_BUILD_INFO` is not `BUILD_INFO`.
  const re = new RegExp('(?:^|[^\\w$.])' + literalName + '\\s*=\\s*\\{', 'm');
  const m = re.exec(content);
  if (!m) return null;

  const open = content.indexOf('{', m.index);
  let depth = 0;
  let quote = null;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) return content.slice(open + 1, i);
    }
  }
  return null; // unterminated literal — treated as absent
}

/**
 * Reads BUILD_INFO fields out of a GAS-side version file (e.g. src/Version.js), the same file
 * gas-deploy's `buildInfoStamper` writes to as the last step of `clasp deploy`. Regex, not
 * require() — the target is a GAS script file (bare consts, no module.exports), not a requirable
 * Node module. Both quoted-key JSON-shaped literals (buildInfoStamper's output) and bare-key
 * literals (pre-package copies) are valid JS and both occur in checkouts, so key quotes are
 * optional here.
 *
 * Returns **every** string field the literal declares, not a fixed three: PracticeMix needed
 * `buildDate` for its cache generation and, finding it absent, wrote a duplicate regex of its own
 * — the package's field-reader re-diverging at its first consumer (PLAN2 F13). `version`,
 * `webappUrl` and `env` are always present (empty string when the literal omits them) so existing
 * callers need no guards.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {string} [options.literalName='BUILD_INFO']
 */
function readBuildInfo_(filePath, options = {}) {
  const { literalName = 'BUILD_INFO' } = options;
  const content = fs.readFileSync(filePath, 'utf8');
  const body = literalBody_(content, literalName);
  if (body === null) {
    throw new Error(
      `gas-static: ${filePath} has no ${literalName} object literal — this file is written by ` +
      `the deploy's buildInfoStamper, so deploy the target first, or point ` +
      `config.webappUrl.file at the file that carries it.`
    );
  }

  // Only within the literal's own body: a comment or a second literal elsewhere in the file used
  // to win here, silently, because the old regex scanned the whole file for the first match.
  const fields = { version: '', webappUrl: '', env: '' };
  const fieldRe = /(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*"([^"]*)"/g;
  let f;
  while ((f = fieldRe.exec(body)) !== null) {
    fields[f[1] || f[2] || f[3]] = f[4];
  }
  return fields;
}

module.exports = { readBuildInfo_ };
