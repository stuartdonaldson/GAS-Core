/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * Plain-Node unit test for GasLogger.js's and AxiomLogger.js's pure functions
 * (maskPiiForLog_, maskRecipientListForLog_, buildAxiomRows_). No GAS runtime
 * required -- these functions are defined outside their module's closure
 * specifically so they can be exercised here. Run with: node test_gas_logger.js
 */
const assert = require('node:assert/strict');

const { maskPiiForLog_, maskRecipientListForLog_, classifyErrorKeyword_ } = require('./GasLogger.js');
const { buildAxiomRows_ } = require('./AxiomLogger.js');

const entries = [
  { ts: '2026-07-16T09:03:18.000Z', tag: 'sync.complete', version: '1.2.0', env: 'prod', data: { docId: 'abc123', changesCount: 3 } },
  { ts: '2026-07-16T09:05:18.000Z', tag: 'sync.scanned', version: '1.2.0', env: 'prod', op: 'op-1', parentOp: 'op-0', data: { warning: 'retry' } },
];

const opts = { app: 'demo', hoistedKeys: ['docId'] };
const rows = buildAxiomRows_(entries, opts);

assert.equal(rows.length, 2);
assert.equal(rows[0]._time, '2026-07-16T09:03:18.000Z');
assert.equal(rows[0].name, 'sync.complete');
assert.equal(rows[0].side, 'gas');
assert.equal(rows[0].app, 'demo');
assert.equal(rows[0].version, '1.2.0');
assert.equal(rows[0].env, 'prod');
assert.equal('op' in rows[0], false);
assert.equal('parentOp' in rows[0], false);

// THE 257-FIELD RULE (AxiomLogger.js rule 1): a listed key becomes a real
// top-level column and is REMOVED from the nested copy (one source of truth per
// event); every other payload key stays inside the single `data` map field and
// must NOT appear at the top level, or each distinct key mints a permanent
// column and the dataset eventually starts silently dropping new fields.
assert.equal(rows[0].docId, 'abc123');
assert.equal('docId' in rows[0].data, false);
assert.equal(rows[0].data.changesCount, 3);
assert.equal('changesCount' in rows[0], false);

assert.equal(rows[1].op, 'op-1');
assert.equal(rows[1].parentOp, 'op-0');
assert.equal(rows[1].data.warning, 'retry');
assert.equal('warning' in rows[1], false);

// An entry with no hoistable key still nests its whole payload.
const plain = buildAxiomRows_([{ ts: 't', tag: 'x', data: { a: 1, b: 2 } }], opts)[0];
assert.deepEqual(plain.data, { a: 1, b: 2 });
assert.equal(plain.env, 'unknown');

// classifyErrorKeyword_ -- returns ONLY a literal from the fixed vocabulary,
// never any part of the exception's own message (that is the whole point: some
// GAS exceptions embed fetched document content in their message text).
assert.equal(classifyErrorKeyword_(new Error('File not found: SECRET-DOC-TITLE')), 'not_found');
assert.equal(classifyErrorKeyword_(new Error('You do not have permission')), 'permission_denied');
assert.equal(classifyErrorKeyword_(new Error('Service invoked too many times for one day')), 'quota_exceeded');
assert.equal(classifyErrorKeyword_(new Error('Exceeded maximum execution time')), 'timeout');
assert.equal(classifyErrorKeyword_(new Error('something entirely novel')), 'other');
assert.equal(classifyErrorKeyword_(null), 'other');
assert.equal(classifyErrorKeyword_('a bare thrown string'), 'other');

// maskPiiForLog_ -- names: first/last character kept, middle collapsed to '...'.
assert.equal(maskPiiForLog_('Little John'), 'L...n');
assert.equal(maskPiiForLog_('Jo'), 'J...o');
assert.equal(maskPiiForLog_('J'), 'J');
assert.equal(maskPiiForLog_(''), '');
assert.equal(maskPiiForLog_(null), '');

// maskPiiForLog_ -- emails: only the local part is masked, domain stays fully visible.
assert.equal(maskPiiForLog_('jane.doe@example.com'), 'j...e@example.com');
assert.equal(maskPiiForLog_('a@b.com'), 'a@b.com');

// maskRecipientListForLog_ -- plain comma-separated addresses.
assert.equal(
  maskRecipientListForLog_('jane.doe@example.com,a@b.com'),
  'j...e@example.com,a@b.com'
);

// maskRecipientListForLog_ -- 'Display Name <email>' form, both parts masked.
assert.equal(
  maskRecipientListForLog_('Little John <jane.doe@example.com>'),
  'L...n <j...e@example.com>'
);

assert.equal(maskRecipientListForLog_(''), '');
assert.equal(maskRecipientListForLog_(null), '');

console.log('test_gas_logger.js: PASS');
