'use strict';

/**
 * gas-static — the shared static-front-end build/publish/verify pipeline.
 *
 * See README.md for the config shape. The short version: a consumer's tools/static-pages.js is
 * pure config and calls runStatic().
 */

const { buildEnv } = require('./lib/build.js');
const { publishEnv } = require('./lib/publish.js');
const { assertPublishedBuild } = require('./lib/assert.js');

function runStatic(config) {
  return {
    config,
    build: (envKey) => buildEnv(config, envKey),
    publish: (envKey, options) => publishEnv(config, envKey, options),
    assertPublishedBuild: (envKey, expectedVersion, options) =>
      assertPublishedBuild(config, envKey, expectedVersion, options),
  };
}

module.exports = { runStatic, buildEnv, publishEnv, assertPublishedBuild };
