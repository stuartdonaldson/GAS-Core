'use strict';

/**
 * The declarative half of the I13 audit tool: validates a PROJECT-DECLARED ownership map +
 * exception list, and turns it into a single ESLint flat-config block running the custom
 * `i13/boundary-ownership` rule (lib/rules/boundaryOwnership.js) — see that file's doc comment
 * for why this is a custom rule rather than stacked `no-restricted-globals` blocks.
 *
 * Everything this module does operates on the identifiers `ownership` names — never on a
 * project-wide list GAS-Core ships. See README.md "What this tool does and does not check" for
 * the (boundary, operation) limit this implies.
 */

const { toArray } = require('./util.js');
const boundaryOwnershipRule = require('./rules/boundaryOwnership.js');

/**
 * Validates an i13.config shape. Throws a single Error enumerating every problem found (not
 * just the first) so a project fixing its config does not have to re-run per mistake.
 *
 * Config-error cases (all throw):
 *  - an ownership entry whose value is not a non-empty string or array of non-empty strings
 *  - an exception entry missing `identifier`, `file`, or a non-empty `reason`
 *  - an exception naming an identifier that is not a key of `ownership`
 *
 * A missing or empty `ownership` map is NOT an error — that is the documented silent no-op
 * (AC2) and is handled by the caller (buildI13Blocks), not here.
 */
function validateConfig(i13Config) {
  const problems = [];
  const ownership = (i13Config && i13Config.ownership) || {};
  const exceptions = (i13Config && i13Config.exceptions) || [];

  for (const [identifier, value] of Object.entries(ownership)) {
    const owners = toArray(value);
    if (owners.length === 0 || owners.some((o) => typeof o !== 'string' || o.trim() === '')) {
      problems.push(
        `ownership["${identifier}"] must be a non-empty file glob string, or a non-empty ` +
          `array of them; got ${JSON.stringify(value)}`
      );
    }
  }

  exceptions.forEach((entry, i) => {
    const where = `exceptions[${i}]`;
    if (!entry || typeof entry !== 'object') {
      problems.push(`${where} must be an object with identifier, file, and reason`);
      return;
    }
    if (!entry.identifier || typeof entry.identifier !== 'string') {
      problems.push(`${where}.identifier is required and must be a non-empty string`);
    }
    if (!entry.file || typeof entry.file !== 'string') {
      problems.push(`${where}.file is required and must be a non-empty string`);
    }
    if (!entry.reason || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      // AC3: an exception without a reason is a config error, not a silent pass.
      problems.push(
        `${where} (${entry.identifier || '?'} in ${entry.file || '?'}) has no reason — an ` +
          `exception without a reason is a config error, not a silent pass`
      );
    }
    if (entry.identifier && ownership[entry.identifier] === undefined) {
      problems.push(
        `${where}.identifier "${entry.identifier}" is not governed by ownership — an ` +
          `exception can only apply to an identifier the project has declared ownership for`
      );
    }
  });

  if (problems.length > 0) {
    throw new Error(
      `i13-boundary-audit: invalid config —\n  ${problems.join('\n  ')}`
    );
  }
}

/**
 * Builds the ESLint flat-config block(s) that enforce a declared ownership map.
 *
 * Returns `[]` (silent no-op — AC2) when `i13Config` is missing, or declares no ownership
 * entries. This is the "a project with no declaration gets no enforcement" contract: the tool
 * never falls back to an estate-wide default map.
 *
 * `options.files` overrides the default file glob (`['**\/*.js']`) the rule applies to.
 * `options.baseDir` is the directory ownership/exception file globs are relative to (default:
 * `process.cwd()`, i.e. wherever `eslint` is invoked from — normally a project's own root).
 */
function buildI13Blocks(i13Config, options = {}) {
  const ownership = (i13Config && i13Config.ownership) || {};
  const identifiers = Object.keys(ownership);
  if (identifiers.length === 0) return [];

  validateConfig(i13Config);

  const exceptions = (i13Config && i13Config.exceptions) || [];
  const filesGlob = options.files || ['**/*.js'];
  const baseDir = options.baseDir || process.cwd();

  return [
    {
      files: filesGlob,
      plugins: { i13: { rules: { 'boundary-ownership': boundaryOwnershipRule } } },
      rules: {
        'i13/boundary-ownership': ['error', { ownership, exceptions, baseDir }],
      },
    },
  ];
}

/**
 * AC3: the exception list must be enumerable — a project can print every exception it currently
 * relies on. Returns a flat, sorted array; throws via validateConfig if the config is malformed
 * (an unenumerable/invalid exception is exactly the failure mode this guards against).
 */
function listExceptions(i13Config) {
  if (!i13Config || !i13Config.exceptions) return [];
  validateConfig(i13Config);
  return [...i13Config.exceptions]
    .map((e) => ({ identifier: e.identifier, file: e.file, reason: e.reason }))
    .sort((a, b) => (a.identifier + a.file).localeCompare(b.identifier + b.file));
}

module.exports = { validateConfig, buildI13Blocks, listExceptions, toArray };
