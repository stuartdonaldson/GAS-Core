'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveToolingVersions, toolingRow } = require('../lib/tooling.js');
const { printDeploySummary } = require('../lib/summary.js');

/** A consumer checkout with the packages actually installed, which is what F10 wants reported. */
function consumerRoot_(installed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-tooling-'));
  for (const [name, version] of Object.entries(installed)) {
    const dir = path.join(root, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {};\n');
  }
  return root;
}

test('reports the versions actually installed in the consumer checkout', () => {
  const root = consumerRoot_({ 'gas-deploy': '1.2.1', 'gas-static': '1.1.0' });
  assert.deepEqual(resolveToolingVersions(root), [
    { name: 'gas-deploy', version: '1.2.1' },
    { name: 'gas-static', version: '1.1.0' },
  ]);
});

test('a consumer with no static page reports only what it has', () => {
  const root = consumerRoot_({ 'gas-deploy': '1.2.1' });
  assert.deepEqual(resolveToolingVersions(root), [{ name: 'gas-deploy', version: '1.2.1' }]);
});

test('nothing resolvable is not an error — the summary must never fail on a provenance row', () => {
  assert.deepEqual(resolveToolingVersions(consumerRoot_({})), []);
  assert.deepEqual(resolveToolingVersions('/no/such/path'), []);
});

test('the row names each package and its version', () => {
  const row = toolingRow(consumerRoot_({ 'gas-deploy': '1.2.1', 'gas-static': '1.1.0' }));
  assert.equal(row.label, 'Tooling');
  assert.equal(row.value, 'gas-deploy v1.2.1 · gas-static v1.1.0');
});

test('with nothing resolvable the row explains itself instead of printing a blank', () => {
  const row = toolingRow(consumerRoot_({}));
  assert.equal(row.value, undefined);
  assert.match(row.missing, /not resolvable/);
});

test('the summary prints the tooling row (PLAN2 F10)', () => {
  const out = printDeploySummary({
    label: 'TEST', version: '1.2.3', now: 'NOW', deploymentId: 'AKfycA', revision: '47',
    scriptId: 'S'.repeat(20), sheetId: 'SHEET1',
    tooling: toolingRow(consumerRoot_({ 'gas-deploy': '1.2.1', 'gas-static': '1.1.0' })),
    log: () => {},
  });
  assert.match(out, /Tooling:\s+gas-deploy v1\.2\.1 · gas-static v1\.1\.0/);
});

test('the summary is unchanged when no tooling row is supplied', () => {
  const out = printDeploySummary({
    label: 'TEST', version: '1.2.3', now: 'NOW', deploymentId: 'AKfycA', revision: '47',
    scriptId: 'S'.repeat(20), sheetId: 'SHEET1', log: () => {},
  });
  assert.doesNotMatch(out, /Tooling/);
});
