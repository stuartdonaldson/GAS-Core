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
const { readBuildInfo_ } = require('./lib/buildInfo.js');
const { deployHooks, summaryRows } = require('./lib/deploy.js');

function runStatic(config) {
  // Shared by deployHooks() and summaryRows() so the summary can report what the hooks actually
  // did (a skipped publish, in particular) without the consumer wiring a channel between them.
  const state = {};

  const pipeline = {
    config,
    build: (envKey) => buildEnv(config, envKey),
    publish: (envKey, options) => publishEnv(config, envKey, options),
    assertPublishedBuild: (envKey, expectedVersion, options) =>
      assertPublishedBuild(config, envKey, expectedVersion, options),
  };

  // The gas-deploy integration (lib/deploy.js): `postDeploy: pipeline.deployHooks()` and
  // `extraRows: pipeline.summaryRows()` are the whole of it.
  pipeline.deployHooks = (options = {}) => deployHooks(pipeline, config, { state, ...options });
  pipeline.summaryRows = (options = {}) => summaryRows(config, { state, ...options });

  return pipeline;
}

// readBuildInfo_ is exported because a consumer that stamps extra placeholders off BUILD_INFO
// (PracticeMix's buildDate) must read that file with the SAME code the pipeline reads it with —
// the alternative is the duplicate regex F13 was filed about.
module.exports = {
  runStatic, buildEnv, publishEnv, assertPublishedBuild, deployHooks, summaryRows, readBuildInfo_,
};
