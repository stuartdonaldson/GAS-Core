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

const { maskPiiForLog_, maskRecipientListForLog_ } = require('./GasLogger.js');
const { buildAxiomRows_ } = require('./AxiomLogger.js');

const entries = [
  { ts: '2026-07-16T09:03:18.000Z', tag: 'sync.complete', version: '1.2.0', data: { docId: 'abc123', changesCount: 3 } },
  { ts: '2026-07-16T09:05:18.000Z', tag: 'sync.scanned', version: '1.2.0', op: 'op-1', parentOp: 'op-0', data: { warning: 'retry' } },
];

const rows = buildAxiomRows_(entries);

assert.equal(rows.length, 2);
assert.equal(rows[0]._time, '2026-07-16T09:03:18.000Z');
assert.equal(rows[0].name, 'sync.complete');
assert.equal(rows[0].side, 'gas');
assert.equal(rows[0].version, '1.2.0');
assert.equal(rows[0].docId, 'abc123');
assert.equal(rows[0].changesCount, 3);
assert.equal('op' in rows[0], false);
assert.equal('parentOp' in rows[0], false);

assert.equal(rows[1].op, 'op-1');
assert.equal(rows[1].parentOp, 'op-0');
assert.equal(rows[1].warning, 'retry');

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
