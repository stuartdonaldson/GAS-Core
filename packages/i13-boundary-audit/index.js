'use strict';

/**
 * i13-boundary-audit — declarative, CI-runnable ESLint enforcement of DevStandard I13
 * (platform-boundary ownership), given a PROJECT-DECLARED ownership map.
 *
 * See README.md for the config shape, the worked (boundary, operation) example, and the
 * documented limit of what this tool can and cannot check.
 *
 * Two entry points:
 *   - buildI13Blocks(i13Config)      composable rule blocks — spread into a project's OWN
 *                                     flat eslint.config.js, which already declares GAS
 *                                     globals (e.g. via GActionSheet's pattern). This is the
 *                                     normal, CI-integrated path (AC1).
 *   - buildStandaloneConfig(...)     a full flat config (globals included) for a project that
 *                                     has no eslint.config.js of its own yet, or for ad-hoc /
 *                                     out-of-repo verification runs (used by bin/i13-audit.js).
 */

const { gasGlobals } = require('./lib/gasGlobals.js');
const { collectProjectGlobals } = require('./lib/collectProjectGlobals.js');
const { buildI13Blocks, listExceptions, validateConfig } = require('./lib/ownership.js');

function buildStandaloneConfig(i13Config, opts = {}) {
  const srcDir = opts.srcDir;
  const extraGlobals = opts.extraGlobals || {};
  const projectGlobals = srcDir ? collectProjectGlobals(srcDir) : {};

  const globalsBlock = {
    files: opts.files || ['**/*.js'],
    languageOptions: {
      ecmaVersion: opts.ecmaVersion || 2022,
      sourceType: 'script',
      globals: { ...gasGlobals, ...projectGlobals, ...extraGlobals },
    },
  };

  return [
    globalsBlock,
    ...buildI13Blocks(i13Config, { files: opts.files, baseDir: opts.baseDir || srcDir }),
  ];
}

module.exports = {
  buildI13Blocks,
  buildStandaloneConfig,
  listExceptions,
  validateConfig,
  gasGlobals,
  collectProjectGlobals,
};
