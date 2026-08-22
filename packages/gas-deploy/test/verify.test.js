'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertDeployedVersion, queryLiveVersion, pingWebapp } = require('../lib/verify.js');

const frozenClock = (fn) => {
  let now = 0;
  const real = Date.now;
  Date.now = () => now;
  const sleep = async (ms) => { now += ms; };
  return fn(sleep).finally(() => { Date.now = real; });
};

test('matches on the first poll and carries no secret', async () => {
  const calls = [];
  const postFn = async (url, body) => { calls.push({ url, body }); return { ok: true, version: '1.2.3', target: 'TEST', deploymentId: 'AKfycA' }; };
  const result = await assertDeployedVersion('AKfycA', '1.2.3', 'TEST', { postFn });
  assert.deepEqual(result, { ok: true, attempts: 1, version: '1.2.3', target: 'TEST', deploymentId: 'AKfycA' });
  assert.equal(calls[0].url, 'https://script.google.com/macros/s/AKfycA/exec?cmd=version');
  assert.deepEqual(calls[0].body, { action: 'version' }, 'cmd=version is ungated — no secret may be sent');
});

test('tolerates the ~5s edge-propagation race (#9)', async () => {
  let n = 0;
  const postFn = async () => (++n === 1 ? { ok: true, version: '1.2.2', target: 'TEST' } : { ok: true, version: '1.2.3', target: 'TEST' });
  const sleeps = [];
  const result = await assertDeployedVersion('AKfycA', '1.2.3', 'TEST', { postFn, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(result.attempts, 2);
  assert.deepEqual(sleeps, [5000]);
});

test('a version mismatch times out with expected-vs-actual', () => frozenClock(async (sleep) => {
  await assert.rejects(
    () => assertDeployedVersion('AKfycA', '1.2.3', 'TEST', { postFn: async () => ({ ok: true, version: '1.2.2', target: 'TEST' }), sleep, intervalSec: 5, timeoutSec: 12 }),
    (err) => {
      assert.match(err.message, /timed out/);
      assert.match(err.message, /expected version=1\.2\.3 target=TEST/);
      assert.match(err.message, /last seen version=1\.2\.2 target=TEST/);
      return true;
    }
  );
}));

test('a TARGET mismatch fails even when the version matches — the wrong-environment catch', () => frozenClock(async (sleep) => {
  await assert.rejects(
    () => assertDeployedVersion('AKfycA', '1.2.3', 'SIT', { postFn: async () => ({ ok: true, version: '1.2.3', target: 'PROD' }), sleep, intervalSec: 5, timeoutSec: 12 }),
    (err) => {
      assert.match(err.message, /last seen version=1\.2\.3 target=PROD/);
      return true;
    }
  );
}));

test('a rejecting client counts as a miss and still times out cleanly', () => frozenClock(async (sleep) => {
  await assert.rejects(
    () => assertDeployedVersion('AKfycA', '1.2.3', 'TEST', { postFn: async () => { throw new Error('Non-JSON response'); }, sleep, intervalSec: 5, timeoutSec: 6 }),
    (err) => { assert.match(err.message, /last seen \(no response\)/); return true; }
  );
}));

test('ok:false is a miss, not a match', () => frozenClock(async (sleep) => {
  await assert.rejects(
    () => assertDeployedVersion('AKfycA', '1.2.3', 'TEST', { postFn: async () => ({ ok: false, version: '1.2.3', target: 'TEST' }), sleep, intervalSec: 5, timeoutSec: 6 }),
    /timed out/
  );
}));

test('queryLiveVersion never throws — returns null on every failure shape', async () => {
  assert.deepEqual(await queryLiveVersion('A', { postFn: async () => ({ ok: true, version: '1', target: 'T' }) }), { version: '1', target: 'T' });
  assert.equal(await queryLiveVersion('A', { postFn: async () => { throw new Error('unreachable'); } }), null);
  assert.equal(await queryLiveVersion('A', { postFn: async () => 'not json' }), null);
  assert.equal(await queryLiveVersion('A', { postFn: async () => ({ ok: false }) }), null);
});

test('pingWebapp reports reachability without throwing', async () => {
  assert.equal((await pingWebapp('A', { postFn: async () => ({ ok: true }) })).reachable, true);
  assert.equal((await pingWebapp('A', { postFn: async () => { throw new Error('down'); } })).reachable, false);
});
