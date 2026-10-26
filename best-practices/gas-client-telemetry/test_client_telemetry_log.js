/**
 * Plain-Node unit tests for ClientTelemetryLog.js. Run: node --test test_client_telemetry_log.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./ClientTelemetryLog.js');

function rig(over) {
  const store = {};
  const r = {
    logged: [],
    ttl: null,
    cache: {
      getAll: (keys) => { const o = {}; keys.forEach((k) => { if (k in store) o[k] = store[k]; }); return o; },
      putAll: (m, ttl) => { Object.assign(store, m); r.ttl = ttl; },
      expire: () => { Object.keys(store).forEach((k) => delete store[k]); },
    },
  };
  r.opts = Object.assign({ log: (tag, data) => r.logged.push({ tag, data }), cache: r.cache }, over);
  return r;
}

describe('handleClientTelemetryBatch_', () => {
  test('logs each new record once as client.<kind> with context, acks logged and already-seen ids', () => {
    const r = rig();
    const rec = { id: 'a1', at: '2026-10-26T12:00:00Z', kind: 'error', source: 'callApi', msg: 'boom' };
    const first = M.handleClientTelemetryBatch_([rec, rec], { visitor: 'v1' }, r.opts);
    assert.deepEqual({ logged: first.logged, skipped: first.skipped }, { logged: 1, skipped: 1 });
    assert.deepEqual(first.ackIds, ['a1', 'a1']);
    assert.equal(r.logged.length, 1);
    assert.equal(r.logged[0].tag, 'client.error');
    assert.equal(r.logged[0].data.visitor, 'v1');
    assert.equal(r.logged[0].data.msg, 'boom');
    assert.equal(r.ttl, 6 * 60 * 60);
    const again = M.handleClientTelemetryBatch_([rec], {}, r.opts);       // re-send before ack arrived
    assert.equal(again.logged, 0);
    assert.deepEqual(again.ackIds, ['a1']);
    assert.equal(r.logged.length, 1);
    r.cache.expire();
    M.handleClientTelemetryBatch_([rec], {}, r.opts);
    assert.equal(r.logged.length, 2, 'dedupe lapses with the TTL');
  });

  test('kind to tag mapping: invalid kinds become client.unknown', () => {
    const r = rig();
    const kinds = ['error', 'a'.repeat(32), 'a'.repeat(33), 'bad.kind', 'x1', '', 5, undefined, null];
    M.handleClientTelemetryBatch_(kinds.map((kind, i) => ({ id: 'k' + i, kind })), {}, r.opts);
    assert.deepEqual(r.logged.map((l) => l.tag), [
      'client.error', 'client.' + 'a'.repeat(32), 'client.unknown', 'client.unknown', 'client.unknown',
      'client.unknown', 'client.unknown', 'client.unknown', 'client.unknown']);
  });

  test('keys GasLogger stamps are renamed client_<key>, in the record and in context', () => {
    const r = rig();
    M.handleClientTelemetryBatch_([{ id: 'r1', kind: 'error', version: 'v', env: 'e', op: 'o', parentOp: 'p', ts: 't', tag: 'g' }], { ts: 'ctx' }, r.opts);
    const d = r.logged[0].data;
    for (const k of ['version', 'env', 'op', 'parentOp', 'ts', 'tag']) assert.equal(k in d, false, k);
    assert.equal(d.client_version, 'v');
    assert.equal(d.client_env, 'e');
    assert.equal(d.client_op, 'o');
    assert.equal(d.client_parentOp, 'p');
    assert.equal(d.client_tag, 'g');
    assert.equal(d.client_ts, 'ctx');
  });

  test('batch is capped at 25; id-less and non-object entries are skipped, not acked', () => {
    const r = rig();
    const recs = Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, kind: 'error' }));
    const res = M.handleClientTelemetryBatch_(recs.concat([null, { kind: 'error' }, 'str']), {}, r.opts);
    assert.equal(res.ackIds.length, 25);
    assert.equal(r.logged.length, 25);
    const res2 = M.handleClientTelemetryBatch_([null, { kind: 'error' }, 'str', 7], {}, r.opts);
    assert.deepEqual(res2.ackIds, []);
    assert.equal(res2.skipped, 4);
  });

  test('never throws: broken cache degrades to no dedupe; a throwing log leaves the record un-acked', () => {
    const r = rig({ cache: { getAll() { throw new Error('x'); }, putAll() { throw new Error('x'); } } });
    const res = M.handleClientTelemetryBatch_([{ id: 'z', kind: 'error' }], {}, r.opts);
    assert.deepEqual(res.ackIds, ['z']);
    const bad = rig({ log() { throw new Error('sink down'); } });
    const res2 = M.handleClientTelemetryBatch_([{ id: 'z', kind: 'error' }], {}, bad.opts);
    assert.deepEqual(res2.ackIds, []);
    assert.deepEqual(M.handleClientTelemetryBatch_('nope', {}, r.opts).ackIds, []);
  });
});

describe('carrier helpers', () => {
  test('logPiggybackedClientTelemetry_: null when none carried, [] on failure, ids otherwise', () => {
    const r = rig();
    assert.equal(M.logPiggybackedClientTelemetry_({}, {}, r.opts), null);
    assert.equal(M.logPiggybackedClientTelemetry_({ telemetry: { records: [] } }, {}, r.opts), null);
    assert.deepEqual(M.logPiggybackedClientTelemetry_({ telemetry: { records: [{ id: 'p', kind: 'error' }] } }, {}, r.opts), ['p']);
    const boom = { get cache() { throw new Error('x'); }, log: () => { throw new Error('y'); } };
    assert.doesNotThrow(() => M.logPiggybackedClientTelemetry_({ telemetry: { records: [{ id: 'q' }] } }, {}, boom));
  });

  test('review: client-supplied who keys are stripped; only the server context supplies them', () => {
    const r = rig();
    M.handleClientTelemetryBatch_([{ id: 'w1', kind: 'error', email: 'evil@x.org', sub: 's', visitor: 'fake', anon: 'a', ip: '1.2.3.4', msg: 'm' }], { visitor: 'real' }, r.opts);
    const d = r.logged[0].data;
    assert.equal(d.visitor, 'real');
    ['email', 'sub', 'anon', 'ip'].forEach((k) => assert.equal(k in d, false, k));
    assert.equal(d.msg, 'm');
  });

  test('review: server clips msg 500, stack 1200, other strings 500, and keeps at most 40 keys (id/kind first)', () => {
    const r = rig();
    const rec = { zzz: 'z', id: 'c1', kind: 'error', msg: 'm'.repeat(900), stack: 's'.repeat(2000), other: 'o'.repeat(900), n: 7 };
    for (let i = 0; i < 60; i++) rec['k' + i] = i;
    M.handleClientTelemetryBatch_([rec], {}, r.opts);
    const d = r.logged[0].data;
    assert.equal(d.msg.length, 500);
    assert.equal(d.stack.length, 1200);
    assert.equal(d.other.length, 500);
    assert.equal(d.n, 7);
    assert.equal(Object.keys(d).length, 40);
    assert.equal(d.id, 'c1');
    assert.equal(d.kind, 'error');
  });

  test('handleClientTelemetryPost_ reads top-level records and acks', () => {
    const r = rig();
    const res = M.handleClientTelemetryPost_({ records: [{ id: 'h', kind: 'error' }] }, { visitor: 'v' }, r.opts);
    assert.equal(res.ok, true);
    assert.deepEqual(res.telemetryAck, ['h']);
    assert.deepEqual(M.handleClientTelemetryPost_(null, {}, r.opts).telemetryAck, []);
  });

  test('attachTelemetryAck_ merges onto ok:true and ok:false, leaves the original alone, no-ops on null', () => {
    const ok = { ok: true, result: 1 };
    assert.deepEqual(M.attachTelemetryAck_(ok, ['a']), { ok: true, result: 1, telemetryAck: ['a'] });
    assert.deepEqual(M.attachTelemetryAck_({ ok: false, error: 'denied' }, []), { ok: false, error: 'denied', telemetryAck: [] });
    assert.equal('telemetryAck' in ok, false);
    assert.equal(M.attachTelemetryAck_(ok, null), ok);
  });
});
