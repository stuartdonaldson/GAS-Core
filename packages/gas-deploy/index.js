'use strict';

/**
 * gas-deploy — the shared Google Apps Script deployment pipeline.
 *
 * See README.md for the config shape. The short version: a consumer's
 * tools/manage-deployments.js is pure config and calls runCli().
 */

const clasp = require('./lib/clasp.js');
const version = require('./lib/version.js');
const stampers = require('./lib/stampers.js');
const resolvers = require('./lib/resolvers.js');
const ledger = require('./lib/ledger.js');
const summary = require('./lib/summary.js');
const verify = require('./lib/verify.js');
const tooling = require('./lib/tooling.js');
const webapp = require('./lib/webapp.js');
const cli = require('./lib/cli.js');

module.exports = {
  ...cli,
  ...stampers,
  ...resolvers,
  ...verify,
  ...ledger,
  ...summary,
  ...tooling,
  ...version,
  claspEnv: clasp.claspEnv,
  execWithRetry: clasp.execWithRetry,
  parseDeployments: clasp.parseDeployments,
  listDeployments: clasp.listDeployments,
  resolveRevision: clasp.resolveRevision,
  resolveClaspAuthPath: clasp.resolveClaspAuthPath,
  expandHome: clasp.expandHome,
  webapp,
};
