'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertPublishedBuild } = require('../lib/assert.js');

const frozenClock = (fn) => {
  let now = 0;
  const real = Date.now;
  Date.now = () => now;
  const sleep = async (ms) => { now += ms; };
  return fn(sleep).finally(() => { Date.now = real; });
};

function config_() {
  return { liveUrl: (env) => `https://example.github.io/Static/pub/${env}/` };
}

test('succeeds on the first poll when version.json already matches', async () => {
  const calls = [];
  const fetchJson = async (url) => { calls.push(url); return { version: '2.5.0.9', env: 'sit', webappUrl: 'https://x/exec' }; };

  const result = await assertPublishedBuild(config_(), 'sit', '2.5.0.9', { fetchJson });

  assert.deepEqual(result, { ok: true, attempts: 1, version: '2.5.0.9', env: 'sit', webappUrl: 'https://x/exec' });
  assert.match(calls[0], /^https:\/\/example\.github\.io\/Static\/pub\/sit\/version\.json\?cachebust=/);
});

test('tolerates CDN propagation delay — retries until the version matches', async () => {
  let n = 0;
  const fetchJson = async () => (++n === 1 ? { version: '2.5.0.8' } : { version: '2.5.0.9' });
  const sleeps = [];

  const result = await assertPublishedBuild(config_(), 'sit', '2.5.0.9', { fetchJson, sleep: async (ms) => sleeps.push(ms) });

  assert.equal(result.attempts, 2);
  assert.deepEqual(sleeps, [5000]);
});

test('a stale version.json times out with expected-vs-actual', () => frozenClock(async (sleep) => {
  await assert.rejects(
    () => assertPublishedBuild(config_(), 'sit', '2.5.0.9', {
      fetchJson: async () => ({ version: '2.5.0.8' }), sleep, intervalSec: 5, timeoutSec: 12,
    }),
    (err) => {
      assert.match(err.message, /timed out/);
      assert.match(err.message, /waiting for sit to serve v2\.5\.0\.9/);
      assert.match(err.message, /last seen: 2\.5\.0\.8/);
      return true;
    }
  );
}));

test('a fetch failure counts as a miss and still times out cleanly', () => frozenClock(async (sleep) => {
  await assert.rejects(
    () => assertPublishedBuild(config_(), 'sit', '2.5.0.9', {
      fetchJson: async () => { throw new Error('404'); }, sleep, intervalSec: 5, timeoutSec: 6,
    }),
    /last seen: \(none\)/
  );
}));
