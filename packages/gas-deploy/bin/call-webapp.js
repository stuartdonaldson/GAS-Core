#!/usr/bin/env node
'use strict';

/**
 * The standardized web app caller (RECOMMENDATION.md §3.3).
 *
 * Usage:
 *   call-webapp <action> [--cmd admin] [--env sit] [--body '{"k":"v"}'] [--ns <namespace>]
 *
 * Configured from the consuming project via a gas-deploy.config.js / the wrapper that requires
 * this module, so project-specific action semantics stay in the project while URL resolution,
 * auth injection and transport live here.
 *
 * The deployment URL is derived from the **live** deployment list by default, not from a stored
 * value — see lib/resolvers.js for why the stored ID is still tried first (it is validated
 * against that same live list before use).
 *
 * The secret is read from local.settings.json and placed in the POST body only. It is never
 * accepted on argv, never put in the query string, and never printed — including on failure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { call, redact } = require('../lib/webapp.js');
const { claspEnv } = require('../lib/clasp.js');
const { resolveDeploymentId, standardChain } = require('../lib/resolvers.js');

const VALUE_FLAGS = new Set(['--cmd', '--env', '--body', '--ns']);

function parseArgs(argv) {
  const args = argv.slice(2);
  let action;
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (!args[i].startsWith('--')) { action = args[i]; break; }
  }

  const valueOf = (flag, fallback) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : fallback;
  };

  let extraBody = {};
  const bodyRaw = valueOf('--body');
  if (bodyRaw) {
    try { extraBody = JSON.parse(bodyRaw); } catch { throw new Error('--body must be valid JSON.'); }
  }
  const ns = valueOf('--ns');
  if (ns) extraBody = { ns, ...extraBody };

  return { action, cmd: valueOf('--cmd', 'admin'), env: valueOf('--env', 'sit'), extraBody };
}

/**
 * `sit` and `test` are treated as synonyms (NUUC-Dispatch already did this) — the same
 * environment is called both across these projects, and making the operator remember which is
 * which per project is exactly the kind of drift this package exists to remove.
 */
function normalizeEnv(env, envMap) {
  if (envMap[env]) return env;
  const synonyms = { sit: 'test', test: 'sit', prod: 'production', production: 'prod' };
  const alt = synonyms[env];
  if (alt && envMap[alt]) return alt;
  throw new Error(`Unknown env "${env}". Use one of: ${Object.keys(envMap).join(', ')}`);
}

/**
 * Resolves the deployment ID for an env: live list first when a resolver is configured, falling
 * back to the settings key so this still works with no clasp auth available.
 */
function resolveEnvDeploymentId(config, envKey, settings) {
  const target = config.envMap[envKey];
  if (config.resolveFromLiveList !== false && target.scriptIdKey && settings[target.scriptIdKey]) {
    try {
      const env = claspEnv(settings, target.claspAuthKey);
      const listOutput = execSync('clasp deployments', { cwd: config.root, env }).toString();
      return resolveDeploymentId(config.resolveDeployment || standardChain(target.anchor), {
        listOutput, settings, target, targetKey: envKey,
      });
    } catch {
      // fall through to the recorded value below
    }
  }
  const stored = settings[target.deploymentIdKey];
  if (!stored || String(stored).startsWith('<')) {
    throw new Error(`${target.deploymentIdKey} is not set in local.settings.json. Run the deploy script for this environment first.`);
  }
  return stored;
}

async function run(config, argv = process.argv) {
  const { action, cmd, env, extraBody } = parseArgs(argv);
  if (!action) {
    throw new Error("Usage: call-webapp <action> [--cmd admin] [--env sit] [--body '{\"k\":\"v\"}']");
  }

  const settingsPath = path.join(config.root, config.settingsPath || 'local.settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const envKey = normalizeEnv(env, config.envMap);
  const target = config.envMap[envKey];

  const deploymentId = resolveEnvDeploymentId(config, envKey, settings);
  const secret = target.secretKey ? settings[target.secretKey] : undefined;

  // stderr, so piping stdout to jq still works. Never includes the payload's secret.
  console.error(`→ ${envKey.toUpperCase()}  cmd=${cmd}  ${action}`);

  const result = await call(deploymentId, {
    cmd,
    action,
    extraBody,
    secret,
    authField: config.authField || 'adminSecret',
    ungatedActions: config.ungatedActions || [],
  });

  console.log(JSON.stringify(result, null, 2));
  if (result && result.ok === false) process.exitCode = 1;
  return result;
}

module.exports = { run, parseArgs, normalizeEnv, resolveEnvDeploymentId, redact };
