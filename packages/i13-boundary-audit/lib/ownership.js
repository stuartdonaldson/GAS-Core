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
const typeLeakRule = require('./rules/typeLeak.js');
const { defaultHandleMethods } = require('./gasHandleMethods.js');

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

  // Type-leak declarations (GAS-Core-0ws). Absent is fine (silent no-op); present-but-malformed
  // is a config error, same as an ownership entry.
  if (i13Config && i13Config.platformTypes !== undefined) {
    const t = i13Config.platformTypes;
    if (!Array.isArray(t) || t.some((x) => typeof x !== 'string' || x.trim() === '')) {
      problems.push(`platformTypes must be an array of non-empty type-name strings; got ${JSON.stringify(t)}`);
    }
  }
  if (i13Config && i13Config.publicSurface !== undefined) {
    const ps = i13Config.publicSurface;
    if (ps === null || typeof ps !== 'object' || Array.isArray(ps)) {
      problems.push(`publicSurface must be an object of owner-file glob -> function-name glob(s); got ${JSON.stringify(ps)}`);
    } else {
      for (const [file, value] of Object.entries(ps)) {
        const pats = toArray(value);
        if (pats.length === 0 || pats.some((x) => typeof x !== 'string' || x.trim() === '')) {
          problems.push(
            `publicSurface["${file}"] must be a non-empty function-name glob string, or a ` +
              `non-empty array of them; got ${JSON.stringify(value)}`
          );
        }
      }
    }
  }
  for (const key of ['handleMethods', 'extraHandleMethods']) {
    const v = i13Config && i13Config[key];
    if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.trim() === ''))) {
      problems.push(`${key} must be an array of non-empty method-name strings; got ${JSON.stringify(v)}`);
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
  const platformTypes = (i13Config && i13Config.platformTypes) || [];
  const publicSurface = (i13Config && i13Config.publicSurface) || {};

  // Type-leak checking needs a declared surface AND something to detect against: platform
  // types (Tier A) or governed identifiers (Tier B). Either missing -> that tier is a no-op.
  const hasSurface = Object.keys(publicSurface).length > 0;
  const typeLeakActive =
    hasSurface && ((Array.isArray(platformTypes) && platformTypes.length > 0) || identifiers.length > 0);

  if (identifiers.length === 0 && !typeLeakActive) return [];

  validateConfig(i13Config);

  const exceptions = (i13Config && i13Config.exceptions) || [];
  const filesGlob = options.files || ['**/*.js'];
  const baseDir = options.baseDir || process.cwd();

  const rules = {};
  if (identifiers.length > 0) {
    rules['i13/boundary-ownership'] = ['error', { ownership, exceptions, baseDir }];
  }
  if (typeLeakActive) {
    const typeLeakOptions = { ownership, platformTypes, publicSurface, baseDir };
    if (i13Config.handleMethods || i13Config.extraHandleMethods) {
      typeLeakOptions.handleMethods = [
        ...(i13Config.handleMethods || defaultHandleMethods),
        ...(i13Config.extraHandleMethods || []),
      ];
    }
    if (i13Config.requireReturns === true) typeLeakOptions.requireReturns = true;
    rules['i13/type-leak'] = ['error', typeLeakOptions];
  }

  return [
    {
      files: filesGlob,
      plugins: {
        i13: { rules: { 'boundary-ownership': boundaryOwnershipRule, 'type-leak': typeLeakRule } },
      },
      rules,
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
