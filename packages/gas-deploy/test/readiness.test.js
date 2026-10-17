'use strict';

/**
 * GAS-Core-o8v: the new version must be confirmed serving BEFORE any postDeploy hook runs, and
 * the mandatory final assert still runs AFTER them. The version source is a fake injected through
 * verifyOptions, appending to the same event log the hooks write to, so ordering is directly
 * observable and no wall-clock wait or network call is involved.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deploy } = require('../lib/cli.js');
const { constStamper } = require('../lib/stampers.js');

async function withDeploy(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-ready-'));
  const savedExit = process.exitCode;
  try {
    fs.mkdirSync(path.join(dir, 'script'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', build: 0 }), 'utf8');
    fs.writeFileSync(path.join(dir, 'script/version.js'), "const APP_VERSION = '0';\n", 'utf8');
    fs.writeFileSync(path.join(dir, 'local.settings.json'),
      JSON.stringify({ testScriptId: 'S1', claspAuth: '/tmp/creds.json', testDeploymentId: 'AKfycA' }), 'utf8');
    const exec = (cmd) => (cmd.includes('deployments') ? '- AKfycA @5 - d' : 'Deployed @6.');
    const base = {
      root: dir,
      stamper: constStamper({ file: 'script/version.js' }),
      exec, log: () => {}, errorLog: () => {},
      targets: { test: { scriptIdKey: 'testScriptId', label: 'TEST', counter: 'build', deploymentIdKey: 'testDeploymentId', sheetIdKey: 'testSheetId' } },
    };
    return await run(base);
  } finally {
    process.exitCode = savedExit;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const READY = { ok: true, version: '1.0.0.1', target: 'TEST' };
const NOT_READY = { ok: true, version: '0.9.9.9', target: 'TEST' };

test('no postDeploy hook runs until the new version is serving; the final assert runs after the hooks', async () => {
  await withDeploy(async (base) => {
    const events = [];
    let polls = 0;
    // The first three reads are the settling window (old version); the fake flips to ready after.
    const postFn = async () => {
      polls++;
      const ready = polls > 3;
      events.push(ready ? 'poll:ready' : 'poll:not-ready');
      return ready ? READY : NOT_READY;
    };
    const result = await deploy({
      ...base,
      verifyOptions: { postFn, sleep: async () => {}, settleReads: 1 },
      postDeploy: [
        { name: 'h1', run: async () => { events.push('hook:h1'); } },
        { name: 'h2', run: async () => { events.push('hook:h2'); } },
      ],
    }, 'test');

    assert.equal(result.ok, true);
    const firstHook = events.indexOf('hook:h1');
    assert.ok(firstHook > 0, 'the hook ran');
    assert.equal(events[firstHook - 1], 'poll:ready', 'readiness was confirmed immediately before the hooks');
    assert.deepEqual(events.slice(firstHook, firstHook + 2), ['hook:h1', 'hook:h2'], 'hooks keep declared order');
    assert.deepEqual(events.slice(firstHook + 2), ['poll:ready'],
      'the mandatory final assert polls again after the hooks, and is the last thing to run');
  });
});

test('a readiness timeout fails the deploy and NO postDeploy hook runs', async () => {
  await withDeploy(async (base) => {
    let hooksRun = 0;
    let polls = 0;
    const errors = [];
    const result = await deploy({
      ...base,
      errorLog: (m) => errors.push(m),
      // intervalSec > timeoutSec: the first unmatched read exhausts the budget, no real wait.
      verifyOptions: { postFn: async () => { polls++; return NOT_READY; }, sleep: async () => {}, intervalSec: 5, timeoutSec: 1, settleReads: 1 },
      postDeploy: [{ name: 'must-not-run', run: async () => { hooksRun++; } }],
    }, 'test');

    assert.equal(hooksRun, 0, 'a hook ran against a deployment that never served the new version');
    assert.equal(result.ok, false);
    assert.match(result.error, /assertDeployedVersion timed out/);
    assert.equal(process.exitCode, 1);
    assert.equal(polls, 1, 'the final assert is not re-run after a readiness timeout');
    assert.ok(errors.some(e => e.includes('Deploy verification failed')));
  });
});
