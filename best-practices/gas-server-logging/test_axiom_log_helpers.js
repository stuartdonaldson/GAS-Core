/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * Plain-Node unit test for axiom-log-helpers.js's row reshaping
 * (reshapeAxiomMatch, and queryAll end-to-end with a stubbed fetch). No network.
 * Run with: node test_axiom_log_helpers.js
 */
const assert = require('node:assert/strict');
const { createAxiomDriver, reshapeAxiomMatch } = require('./axiom-log-helpers.js');

const probe = {
  _time: '2026-10-05T20:41:32.774Z',
  data: { name: 'test.axiom_probe', side: 'gas', app: 'practicemix', version: '1.6.17.5', env: 'TEST', data: { sentinel: 'abc' } },
};
const withOp = {
  _time: '2026-10-05T20:42:00.000Z',
  data: {
    name: 'track.load', side: 'gas', app: 'practicemix', version: '1.6.17.5', env: 'TEST',
    op: 'op-1', parentOp: 'op-0', visitor: 'v-123', data: { trackId: 't9', ms: 12 },
  },
};
const noisy = {
  _time: '2026-10-05T20:43:00.000Z',
  data: {
    name: 'x.y', side: 'gas', app: 'practicemix', version: '1.0', env: 'TEST',
    visitor: null, docId: null, op: null, data: { k: 1 },
  },
};

function checkAll(reshape) {
  const p = reshape(probe, ['env', 'visitor']);
  assert.equal(p.ts, '2026-10-05T20:41:32.774Z');
  assert.equal(p.tag, 'test.axiom_probe');
  assert.equal(p.version, '1.6.17.5');
  assert.equal(p.data.sentinel, 'abc');
  assert.equal(p.data.env, 'TEST');
  assert.ok(!('side' in p.data) && !('app' in p.data));
  assert.deepEqual(Object.keys(p).sort(), ['data', 'op', 'parentOp', 'tag', 'ts', 'version']);

  const o = reshape(withOp, ['env', 'visitor']);
  assert.equal(o.tag, 'track.load');
  assert.equal(o.op, 'op-1');
  assert.equal(o.parentOp, 'op-0');
  assert.equal(o.data.visitor, 'v-123');
  assert.equal(o.data.trackId, 't9');
  assert.ok(!('side' in o.data) && !('app' in o.data) && !('name' in o.data));

  const n = reshape(noisy, ['env', 'visitor']);
  assert.equal(n.data.k, 1);
  assert.ok(!('visitor' in n.data), 'null hoisted key is not merged');
  assert.ok(!('docId' in n.data), 'unlisted noise column dropped');
  assert.equal(n.op, undefined);
}

// 1. Pure function.
checkAll((m, keys) => reshapeAxiomMatch(m, keys));

// 2. End to end through queryAll with a stubbed fetch (legacy-format response).
(async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ matches: [probe, withOp, noisy] }), text: async () => '' });
  try {
    const d = createAxiomDriver({ axiomDataset: 'ds', axiomQueryToken: 't', axiomHoistedKeys: ['visitor'] });
    const [a, b, c] = await d.queryAll(Date.now() - 1000);
    assert.equal(a.data.sentinel, 'abc');
    assert.equal(a.data.env, 'TEST');
    assert.equal(b.data.visitor, 'v-123');
    assert.equal(c.data.k, 1);
    assert.ok(!('side' in a.data) && !('app' in a.data));
    // waitFor predicate used by probeLatency must now match.
    const hit = await d.waitFor((e) => e.tag === 'test.axiom_probe' && e.data.sentinel === 'abc', 2000, Date.now() - 1000);
    assert.equal(hit.tag, 'test.axiom_probe');
  } finally {
    global.fetch = realFetch;
  }
  console.log('test_axiom_log_helpers.js: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
