'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runPostDeploy_ } = require('../lib/cli.js');
const { printDeploySummary } = require('../lib/summary.js');

test('hooks run in declared order', async () => {
  const order = [];
  await runPostDeploy_([
    { name: 'first', run: async () => { order.push('first'); } },
    { name: 'second', run: async () => { order.push('second'); } },
    { name: 'third', run: async () => { order.push('third'); } },
  ], {}, { log: () => {}, errorLog: () => {} });
  assert.deepEqual(order, ['first', 'second', 'third']);
});

test('an optional hook that throws warns with a retry command and does NOT fail the deploy', async () => {
  const errors = [];
  const results = await runPostDeploy_([
    { name: 'flaky', run: async () => { throw new Error('edge not ready'); }, retryCommand: 'node tools/callWebapp.js invalidateAllCache --env sit' },
    { name: 'after', run: async () => {} },
  ], {}, { log: () => {}, errorLog: (m) => errors.push(m) });

  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true, 'a later hook still runs');
  assert.ok(errors.some(e => e.includes('Optional hook "flaky" failed')));
  assert.ok(errors.some(e => e.includes('Retry with: node tools/callWebapp.js invalidateAllCache --env sit')));
});

test('a required hook that throws fails the deploy', async () => {
  await assert.rejects(
    () => runPostDeploy_([{ name: 'must-work', required: true, run: async () => { throw new Error('nope'); } }], {}, { log: () => {}, errorLog: () => {} }),
    /Required post-deploy hook "must-work" failed: nope/
  );
});

test('hooks receive the deploy context', async () => {
  let seen;
  await runPostDeploy_([{ name: 'x', run: async (ctx) => { seen = ctx; } }],
    { version: '1.2.3', deploymentId: 'AKfycA', label: 'TEST' }, { log: () => {}, errorLog: () => {} });
  assert.equal(seen.version, '1.2.3');
  assert.equal(seen.deploymentId, 'AKfycA');
});

test('summary prints the FULL deployment ID, never truncated', () => {
  const id = 'AKfycbzwlKLu' + 'x'.repeat(60) + 'UZA';
  const out = printDeploySummary({ label: 'TEST', version: '1.2.3', now: 'NOW', deploymentId: id, revision: '47', scriptId: 'S'.repeat(20), sheetId: 'SHEET1', log: () => {} });
  assert.ok(out.includes(id), 'a truncated ID cannot be pasted into call-webapp or a bug report');
});

test('summary prints an explanation, never a broken URL, for every missing input', () => {
  const out = printDeploySummary({
    label: 'NUUC', version: '1.0', now: 'NOW', deploymentId: null, revision: null,
    scriptId: null, scriptIdKey: 'nuucScriptId', sheetId: null, sheetIdKey: 'nuucSheetId',
    extraRows: [{ label: 'Static page', value: null, missing: '(static hosting not configured for this target)' }],
    log: () => {},
  });
  assert.match(out, /\(unresolved\)/);
  assert.match(out, /\(nuucScriptId not set in local\.settings\.json\)/);
  assert.match(out, /\(nuucSheetId not set in local\.settings\.json\)/);
  assert.match(out, /\(static hosting not configured for this target\)/);
  assert.doesNotMatch(out, /macros\/s\/null/, 'no malformed URL');
  assert.doesNotMatch(out, /spreadsheets\/d\/null/);
});

test('summary reports the server-confirmed version it was handed', () => {
  const out = printDeploySummary({ label: 'TEST', version: '9.9.9', now: 'NOW', deploymentId: 'A', revision: '1', scriptId: 'S', sheetId: 'X', log: () => {} });
  assert.match(out, /Product version:\s+v9\.9\.9/);
});
