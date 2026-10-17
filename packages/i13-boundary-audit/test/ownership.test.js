'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildI13Blocks, listExceptions, validateConfig } = require('../lib/ownership.js');

test('no config -> silent no-op (AC2)', () => {
  assert.deepEqual(buildI13Blocks(undefined), []);
  assert.deepEqual(buildI13Blocks(null), []);
  assert.deepEqual(buildI13Blocks({}), []);
  assert.deepEqual(buildI13Blocks({ ownership: {} }), []);
});

test('declared ownership produces exactly one config block carrying the whole map', () => {
  const blocks = buildI13Blocks({
    ownership: {
      PropertiesService: ['Admin.js'],
      UrlFetchApp: ['Admin.js', 'AxiomLogger.js'],
    },
  });
  assert.equal(blocks.length, 1);
  const opts = blocks[0].rules['i13/boundary-ownership'][1];
  assert.deepEqual(opts.ownership, {
    PropertiesService: ['Admin.js'],
    UrlFetchApp: ['Admin.js', 'AxiomLogger.js'],
  });
});

test('exceptions are carried through to the rule options', () => {
  const blocks = buildI13Blocks({
    ownership: { PropertiesService: ['Admin.js'] },
    exceptions: [{ identifier: 'PropertiesService', file: 'Gate.js', reason: 'known breach, NDocs-40d' }],
  });
  const opts = blocks[0].rules['i13/boundary-ownership'][1];
  assert.deepEqual(opts.exceptions, [
    { identifier: 'PropertiesService', file: 'Gate.js', reason: 'known breach, NDocs-40d' },
  ]);
});

test('exception without a reason is a config error, not a silent pass (AC3)', () => {
  assert.throws(
    () =>
      buildI13Blocks({
        ownership: { PropertiesService: ['Admin.js'] },
        exceptions: [{ identifier: 'PropertiesService', file: 'Gate.js', reason: '' }],
      }),
    /has no reason/
  );
  assert.throws(
    () =>
      buildI13Blocks({
        ownership: { PropertiesService: ['Admin.js'] },
        exceptions: [{ identifier: 'PropertiesService', file: 'Gate.js' }],
      }),
    /has no reason/
  );
});

test('exception for an ungoverned identifier is a config error', () => {
  assert.throws(
    () =>
      buildI13Blocks({
        ownership: { PropertiesService: ['Admin.js'] },
        exceptions: [{ identifier: 'DriveApp', file: 'Gate.js', reason: 'x' }],
      }),
    /not governed by ownership/
  );
});

test('malformed ownership entry is a config error', () => {
  assert.throws(() => validateConfig({ ownership: { PropertiesService: [] } }), /non-empty/);
  assert.throws(() => validateConfig({ ownership: { PropertiesService: '' } }), /non-empty/);
});

test('listExceptions enumerates every declared exception (AC3)', () => {
  const config = {
    ownership: { PropertiesService: ['Admin.js'], UrlFetchApp: ['Admin.js'] },
    exceptions: [
      { identifier: 'UrlFetchApp', file: 'Legacy.js', reason: 'b-reason' },
      { identifier: 'PropertiesService', file: 'Gate.js', reason: 'a-reason' },
    ],
  };
  const list = listExceptions(config);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { identifier: 'PropertiesService', file: 'Gate.js', reason: 'a-reason' });
  assert.deepEqual(list[1], { identifier: 'UrlFetchApp', file: 'Legacy.js', reason: 'b-reason' });
});

test('listExceptions on a config with no exceptions returns []', () => {
  assert.deepEqual(listExceptions({ ownership: { PropertiesService: ['Admin.js'] } }), []);
  assert.deepEqual(listExceptions(undefined), []);
});
