'use strict';

/**
 * The deploy pipeline itself: the six steps every copy implemented differently
 * (auth, stamp, push, redeploy, post-deploy hooks, report), once.
 *
 * A consumer's tools/manage-deployments.js is pure config — TARGETS, a stamper, a resolver, and
 * an ordered postDeploy array. It contains no `clasp` string and no HTTP code.
 *
 * Ordering is not arbitrary and must not be reordered per-project:
 *   1. resolve auth        — before anything shells out (#1)
 *   2. write .clasp.json   — points clasp at THIS target's script project
 *   3. bump + stamp        — package.json is authoritative; the version file is generated (#5)
 *   3a. prePush hooks      — regenerate source that must be part of the push
 *   4. clasp push          — captured stdout, echoed, so the revision is parseable (#3)
 *   5. resolve deployment  — from the live list, via the configured resolver chain
 *   6. clasp deploy        — update the named deployment in place; never create one
 *   7. postDeploy hooks    — in declared order
 *   8. assertDeployedVersion — mandatory, non-skippable (§3.2)
 *   9. printDeploySummary  — mandatory final step (§3.1)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { claspEnv, parseDeployments, resolveRevision, execWithRetry } = require('./clasp.js');
const { computeVersion } = require('./version.js');
const { resolveDeploymentId, standardChain } = require('./resolvers.js');
const { assertDeployedVersion, queryLiveVersion } = require('./verify.js');
const { printDeploySummary } = require('./summary.js');
const { writeLedgerEntry, writeDeployMetadata } = require('./ledger.js');

function loadSettings_(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`local.settings.json not found at ${settingsPath} — copy the .example and populate the ID fields.`);
  }
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function writeClasp_(claspPath, scriptId, rootDir) {
  fs.writeFileSync(claspPath, JSON.stringify({ scriptId, rootDir }, null, 2) + '\n', 'utf8');
}

function saveSetting_(settingsPath, key, value) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings[key] = value;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/**
 * Runs the ordered post-deploy hooks.
 *
 * `required: false` (the default) means a throw is a warning plus a copy-pasteable retry command,
 * NOT a failed deploy — the code is already live at this point, and failing the run would imply
 * a rollback that never happened. `required: true` means the deploy is not usable without it, so
 * a throw fails the deploy.
 */
async function runPostDeploy_(hooks, ctx, { log = console.log, errorLog = console.error } = {}) {
  const results = [];
  for (const hook of hooks) {
    log(`\n🪝 ${hook.name}…`);
    try {
      await hook.run(ctx);
      results.push({ name: hook.name, ok: true });
    } catch (err) {
      if (hook.required) {
        throw new Error(`Required post-deploy hook "${hook.name}" failed: ${err.message}`);
      }
      errorLog(`⚠️  Optional hook "${hook.name}" failed: ${err.message}`);
      if (hook.retryCommand) errorLog(`   Retry with: ${hook.retryCommand}`);
      results.push({ name: hook.name, ok: false, error: err.message });
    }
  }
  return results;
}

function targetContext_(config, targetKey) {
  const target = config.targets[targetKey];
  if (!target) {
    throw new Error(`Unknown target "${targetKey}". Known: ${Object.keys(config.targets).join(', ')}`);
  }
  const root = config.root;
  const settingsPath = path.join(root, config.settingsPath || 'local.settings.json');
  const settings = loadSettings_(settingsPath);
  const scriptId = settings[target.scriptIdKey];

  if (!scriptId || String(scriptId).startsWith('<')) {
    throw new Error(`${target.scriptIdKey} is not set in local.settings.json`);
  }

  return {
    target,
    targetKey,
    root,
    settingsPath,
    settings,
    scriptId,
    pkgPath: path.join(root, config.pkgPath || 'package.json'),
    claspPath: path.join(root, config.claspPath || '.clasp.json'),
    env: claspEnv(settings, target.authKey),
  };
}

/** Resolves the deployment ID through the target's (or the default) resolver chain. */
function resolveDeployment_(config, ctx, { exec = execSync } = {}) {
  const resolver = ctx.target.resolveDeployment
    || config.resolveDeployment
    || standardChain(ctx.target.anchor);
  const listOutput = exec('clasp deployments', { cwd: ctx.root, env: ctx.env }).toString();
  return {
    deploymentId: resolveDeploymentId(resolver, {
      listOutput,
      settings: ctx.settings,
      target: ctx.target,
      targetKey: ctx.targetKey,
    }),
    listOutput,
  };
}

async function deploy(config, targetKey, options = {}) {
  const log = config.log || console.log;
  const errorLog = config.errorLog || console.error;
  const exec = config.exec || execSync;
  const ctx = targetContext_(config, targetKey);
  const { target, root, settings, scriptId } = ctx;
  const label = target.label;

  log(`\n${target.emoji || '📦'}  Deploying to ${label} (${scriptId.slice(0, 12)}…)\n`);

  writeClasp_(ctx.claspPath, scriptId, config.rootDir || 'script');
  log(`✅ .clasp.json written (rootDir: ${config.rootDir || 'script'}, scriptId: ${scriptId.slice(0, 12)}…)`);

  const version = computeVersion(ctx.pkgPath, { counter: target.counter, skipBump: options.skipBump, log });
  const now = new Date().toISOString();
  config.stamper({ root, label, version, now, log });

  // prePush hooks regenerate source that must be IN the push — F3Go30 rebuilds its "How it
  // Works" panels from the canonical markdown here, so an edit to that source lands on every
  // deploy with no manual sync step. They run after the stamp (so generated files can read the
  // version) and before the push (so they are part of it). A prePush failure fails the deploy by
  // default: unlike a post-deploy hook, nothing is live yet, so stopping costs nothing.
  await runPostDeploy_(
    (config.prePush || []).map(h => ({ required: true, ...h })),
    { targetKey, target, label, version, now, scriptId, settings, root, env: ctx.env },
    { log, errorLog }
  );

  log(`\n🚀 Running: clasp push -f  (clasp_config_auth=${ctx.env.clasp_config_auth})\n`);
  exec('clasp push -f', { stdio: 'inherit', cwd: root, env: ctx.env });
  log(`\n✅ ${label} push complete.`);

  log(`\n🔎 Resolving the named deployment for ${label}…`);
  const { deploymentId } = resolveDeployment_(config, ctx, { exec });
  log(`   → ${deploymentId}`);

  // Captured (not 'inherit') so the revision is parseable, then echoed so nothing is lost.
  const description = (config.describeDeployment || ((v) => `v${v}`))(version, label, target);
  const deployOutput = exec(
    `clasp deploy --deploymentId ${deploymentId} --description "${description}"`,
    { cwd: root, env: ctx.env }
  ).toString();
  process.stdout.write(deployOutput);
  const revision = resolveRevision(deployOutput, deploymentId, () =>
    exec('clasp deployments', { cwd: root, env: ctx.env }).toString()
  );
  log(`\n✅ ${label} named deployment updated.`);

  if (target.deploymentIdKey) {
    saveSetting_(ctx.settingsPath, target.deploymentIdKey, deploymentId);
    log(`💾 ${target.deploymentIdKey} saved to local.settings.json`);
  }

  const hookCtx = { targetKey, target, label, version, now, deploymentId, revision, scriptId, settings, root, env: ctx.env };
  await runPostDeploy_(config.postDeploy || [], hookCtx, { log, errorLog });

  writeLedgerEntry(root, targetKey, { target: label, version, deploymentId, revision, scriptId }, { log });
  writeDeployMetadata(root, { target: label, version, deploymentId, revision, scriptId }, { log });

  // Mandatory, non-skippable (§3.2). There is deliberately no option to turn this off.
  log(`\n🔍 Verifying ${label} is actually serving v${version}…`);
  const summaryRows = (config.extraRows || (() => []))(hookCtx);
  let verified;
  try {
    verified = await assertDeployedVersion(deploymentId, version, label, { log, ...(config.verifyOptions || {}) });
    log(`✅ ${label} verified — serving v${verified.version} (target ${verified.target})`);
  } catch (err) {
    errorLog(`\n❌ Deploy verification failed: ${err.message}`);
    printDeploySummary({
      label, emoji: target.emoji, version, now, deploymentId, revision, scriptId,
      scriptIdKey: target.scriptIdKey, sheetId: settings[target.sheetIdKey],
      sheetIdKey: target.sheetIdKey, extraRows: summaryRows, log,
    });
    process.exitCode = 1;
    return { ok: false, error: err.message, version, deploymentId, revision };
  }

  printDeploySummary({
    label, emoji: target.emoji, version: verified.version, now, deploymentId, revision, scriptId,
    scriptIdKey: target.scriptIdKey, sheetId: settings[target.sheetIdKey],
    sheetIdKey: target.sheetIdKey, extraRows: summaryRows, log,
  });
  return { ok: true, version: verified.version, deploymentId, revision };
}

/**
 * Read-only: no bump, no stamp, no push, no clasp deploy, no post-deploy hooks. It still writes
 * .clasp.json, because `clasp deployments` has to be pointed at the target's script project —
 * that is the one side effect, and it is not destructive.
 */
async function summary(config, targetKey) {
  const log = config.log || console.log;
  const exec = config.exec || execSync;
  const ctx = targetContext_(config, targetKey);
  const { target, settings, scriptId, root } = ctx;
  const label = target.label;

  log(`\n${target.emoji || '📦'}  Reading current ${label} deployment state (${scriptId.slice(0, 12)}…)…`);
  writeClasp_(ctx.claspPath, scriptId, config.rootDir || 'script');

  const { deploymentId } = resolveDeployment_(config, ctx, { exec });
  // No `clasp deploy` stdout exists here, so this always takes resolveRevision's fallback branch.
  const revision = resolveRevision('', deploymentId, () =>
    exec('clasp deployments', { cwd: root, env: ctx.env }).toString()
  );

  // Reading the stamped file is the CONSUMER's job, never the package's: the package must never
  // read a version back out of what it stamped (#5). Here it is display-only — the local value
  // exists solely so a divergence from what the server reports can be flagged — so it is opted
  // into by config rather than done implicitly.
  const local = (config.readLocalVersion && config.readLocalVersion(ctx)) || null;
  const localVersion = local && (typeof local === 'string' ? local : local.version);
  const live = await queryLiveVersion(deploymentId, config.verifyOptions || {});
  let version = localVersion || '(unknown)';
  let now = (local && local.now) || '(unknown)';

  if (live) {
    version = live.version;
    if (localVersion && live.version !== localVersion) {
      log(`⚠️  Live ${label} reports v${live.version}, but the local stamped file says v${localVersion} — deployed from elsewhere, or a deploy half-failed.`);
    }
  } else {
    log(`⚠️  Could not reach ${label}'s cmd=version route — reporting the local stamped file instead.`);
  }

  const rows = (config.extraRows || (() => []))({ targetKey, target, label, settings, root });
  printDeploySummary({
    label, emoji: target.emoji, version, now, deploymentId, revision, scriptId,
    scriptIdKey: target.scriptIdKey, sheetId: settings[target.sheetIdKey],
    sheetIdKey: target.sheetIdKey, extraRows: rows, log,
  });
  return { version, deploymentId, revision, live: !!live };
}

async function interactiveMenu(config) {
  let select;
  try {
    ({ select } = require('@inquirer/prompts'));
  } catch {
    throw new Error('@inquirer/prompts is not installed — install it, or use an explicit --deploy-<target> flag.');
  }
  const choices = Object.entries(config.targets).map(([key, t]) => ({
    name: `${t.emoji || '📦'} ${t.label} — push to ${t.scriptIdKey}`,
    value: key,
  }));
  choices.push({ name: '❌ Exit', value: 'exit' });

  const action = await select({ message: 'Deploy target:', choices });
  if (action !== 'exit') await deploy(config, action);
}

/**
 * Argument surface, identical for every consumer:
 *   --deploy-<targetKey>            deploy that target
 *   --summary --env <envName>       read-only summary
 *   --skip-bump                     reuse the current package.json version (release: scripts)
 * `envAliases` maps a public env name onto an internal target key, because the two vocabularies
 * legitimately differ: F3Go30's public envs are sit/prod over internal targets test/template.
 */
async function runCli(config, argv = process.argv) {
  const args = argv.slice(2);
  const options = { skipBump: args.includes('--skip-bump') };
  const aliases = config.envAliases || {};

  if (args.includes('--summary')) {
    const envIdx = args.indexOf('--env');
    const env = envIdx !== -1 ? args[envIdx + 1] : Object.keys(config.targets)[0];
    return summary(config, aliases[env] || env);
  }

  for (const targetKey of Object.keys(config.targets)) {
    if (args.includes(`--deploy-${targetKey}`)) return deploy(config, targetKey, options);
  }
  for (const [alias, targetKey] of Object.entries(aliases)) {
    if (args.includes(`--deploy-${alias}`)) return deploy(config, targetKey, options);
  }

  return interactiveMenu(config);
}

module.exports = { runCli, deploy, summary, interactiveMenu, runPostDeploy_, resolveDeployment_ };
