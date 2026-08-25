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
  const fetchJson = async () => (++n === 1 ? { version: '2.5.0.8', env: 'sit' } : { version: '2.5.0.9', env: 'sit' });
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

// ---------------------------------------------------------------------------------------------
// F6 half 1 — the assertion covers all three fields version.json carries, not just `version`.
// A green deploy that published the wrong env's dist, or a page pointed at a previous
// deployment's /exec URL, satisfied the version-only assertion.
// ---------------------------------------------------------------------------------------------

/** A project whose BUILD_INFO is readable, so the webappUrl default has a source. */
function projectConfig_(buildInfo = {}) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-assert-'));
  fs.mkdirSync(path.join(root, 'src'));
  const fields = { version: '2.5.0.9', env: 'test', webappUrl: 'https://script.google.com/macros/s/AKfyLIVE/exec', ...buildInfo };
  fs.writeFileSync(
    path.join(root, 'src', 'Version.js'),
    `const BUILD_INFO = ${JSON.stringify(fields, null, 2)};\n`
  );
  return {
    root,
    webappUrl: { from: 'buildInfo', file: 'src/Version.js' },
    liveUrl: (env) => `https://example.github.io/Static/pub/${env}/`,
  };
}

test('env defaults to the env being asserted, and a match on all three fields passes', async () => {
  const fetchJson = async () => ({ version: '2.5.0.9', env: 'sit', webappUrl: 'https://script.google.com/macros/s/AKfyLIVE/exec' });
  const result = await assertPublishedBuild(projectConfig_(), 'sit', '2.5.0.9', { fetchJson });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
});

test('a dist built for another env, published into this dest, fails — and fails fast', async () => {
  // The exact scenario the version-only assertion could not see: dist/prod copied into the test
  // dest. The right *version* is serving, so polling would never converge on anything better.
  const sleeps = [];
  const fetchJson = async () => ({ version: '2.5.0.9', env: 'prod', webappUrl: 'https://script.google.com/macros/s/AKfyLIVE/exec' });

  await assert.rejects(
    () => assertPublishedBuild(projectConfig_(), 'sit', '2.5.0.9', { fetchJson, sleep: async (ms) => sleeps.push(ms) }),
    (err) => {
      assert.match(err.message, /env="prod", not "sit"/);
      assert.match(err.message, /pointing somewhere real/);
      return true;
    }
  );
  assert.deepEqual(sleeps, [], 'a wrong-build publish is not a propagation delay — do not poll it out');
});

test('a webappUrl mismatch fails independently of version and env', async () => {
  const fetchJson = async () => ({ version: '2.5.0.9', env: 'sit', webappUrl: 'https://script.google.com/macros/s/AKfySTALE/exec' });

  await assert.rejects(
    () => assertPublishedBuild(projectConfig_(), 'sit', '2.5.0.9', { fetchJson }),
    (err) => {
      assert.match(err.message, /webappUrl="https:\/\/script\.google\.com\/macros\/s\/AKfySTALE\/exec"/);
      assert.match(err.message, /AKfyLIVE/, 'names what it expected, resolved from BUILD_INFO');
      return true;
    }
  );
});

test('a version mismatch is still a propagation wait, not a fast failure', () => frozenClock(async (sleep) => {
  let n = 0;
  const fetchJson = async () => (++n < 3
    ? { version: '2.5.0.8', env: 'sit', webappUrl: 'https://script.google.com/macros/s/AKfyLIVE/exec' }
    : { version: '2.5.0.9', env: 'sit', webappUrl: 'https://script.google.com/macros/s/AKfyLIVE/exec' });

  const result = await assertPublishedBuild(projectConfig_(), 'sit', '2.5.0.9', { fetchJson, sleep });
  assert.equal(result.attempts, 3);
}));

test('both expectations are overridable, and null opts one out', async () => {
  const fetchJson = async () => ({ version: '2.5.0.9', env: 'whatever', webappUrl: 'https://anything/exec' });

  const result = await assertPublishedBuild(projectConfig_(), 'sit', '2.5.0.9', {
    fetchJson, expectedEnv: 'whatever', expectedWebappUrl: null,
  });
  assert.equal(result.ok, true);
});

test('an unreadable BUILD_INFO logs that webappUrl is NOT being asserted rather than skipping silently', async () => {
  const logs = [];
  const fetchJson = async () => ({ version: '2.5.0.9', env: 'sit', webappUrl: 'https://anything/exec' });

  // config_() has no webappUrl spec at all — the pre-F6 shape.
  const result = await assertPublishedBuild(config_(), 'sit', '2.5.0.9', { fetchJson, log: (m) => logs.push(m) });

  assert.equal(result.ok, true);
  assert.ok(logs.some((l) => /webappUrl is not being asserted/.test(l)), logs.join('\n'));
});

test('the default timeout is 300s — the honest number for a CDN rebuild (PLAN2 F8)', () => frozenClock(async (sleep) => {
  let attempts = 0;
  await assert.rejects(
    () => assertPublishedBuild(config_(), 'sit', '2.5.0.9', {
      fetchJson: async () => { attempts++; return { version: '2.5.0.8' }; },
      sleep, expectedEnv: null, expectedWebappUrl: null,
    }),
    /\(300s\)/
  );
  assert.equal(attempts, 61, '300s at the 5s default interval — one read at t=0 through t=300');
}));
