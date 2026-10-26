/**
 * Plain-Node unit tests for client-telemetry.js. Run: node --test test_client_telemetry.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createClientTelemetry } = require('./client-telemetry.js');

const DAY = 24 * 60 * 60 * 1000;

function rig(over) {
  const store = new Map();
  const r = {
    t: Date.parse('2026-10-26T12:00:00Z'),
    n: 0,
    timers: [],
    sent: [],
    beacons: [],
    sendResult: () => Promise.resolve({ ok: true, telemetryAck: [] }),
    beaconResult: true,
    storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  };
  Object.assign(r, over);
  r.tel = createClientTelemetry({
    storage: r.storage, key: 'k', now: () => r.t, newId: () => 'id' + (++r.n),
    setTimeout: (fn, ms) => { const h = { fn, ms, cleared: false }; r.timers.push(h); return h; },
    clearTimeout: (h) => { h.cleared = true; },
    context: () => ({ page: 'selection', version: 'ctx-version' }),
    isOnline: () => true, clientVersion: '1.2.3',
    send: (recs) => { r.sent.push(recs.map((x) => x.id)); return r.sendResult(recs); },
    beacon: (recs) => { r.beacons.push(recs.map((x) => x.id)); return r.beaconResult; },
  });
  r.store = store;
  r.ids = () => r.tel.pending().map((x) => x.id);
  r.fire = async () => { const h = r.timers.filter((x) => !x.cleared).pop(); h.cleared = true; h.fn(); await new Promise((s) => setImmediate(s)); };
  return r;
}

describe('record shape and queue', () => {
  test('record carries required fields; reserved keys are renamed; msg/stack clipped', () => {
    const r = rig();
    const rec = r.tel.capture('error', 'callApi', { msg: 'm'.repeat(900), stack: 's'.repeat(3000), tag: 'x', op: 'y' });
    assert.equal(rec.kind, 'error');
    assert.equal(rec.source, 'callApi');
    assert.equal(rec.at, '2026-10-26T12:00:00.000Z');
    assert.equal(rec.clientVersion, '1.2.3');
    assert.equal(rec.online, true);
    assert.equal(rec.page, 'selection');
    assert.equal(rec.pageSession, r.tel.pageSession);
    assert.equal(rec.msg.length, 500);
    assert.equal(rec.stack.length, 1200);
    for (const k of ['version', 'env', 'op', 'parentOp', 'ts', 'tag']) assert.equal(k in rec, false, k);
    assert.equal(rec.client_version, 'ctx-version');
    assert.equal(rec.client_tag, 'x');
    assert.equal(rec.client_op, 'y');
  });

  test('queue caps at 25 records and drops records older than 7 days', () => {
    const r = rig();
    r.tel.capture('error', 'old', {});
    r.t += 8 * DAY;
    for (let i = 0; i < 30; i++) r.tel.capture('error', 's' + i, {});
    const q = r.tel.pending();
    assert.equal(q.length, 25);
    assert.equal(q[0].source, 's5');
    assert.equal(q.some((x) => x.source === 'old'), false);
  });

  test('persists in storage; unavailable or throwing storage falls back to memory', () => {
    const a = rig();
    a.tel.capture('error', 'x', {});
    assert.equal(JSON.parse(a.store.get('k')).length, 1);
    const b = rig({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } } });
    b.tel.capture('error', 'x', {});
    assert.equal(b.tel.pending().length, 1);
  });

  test('capture and captureError never throw (circular field, hostile err)', () => {
    const r = rig();
    const c = {}; c.self = c;
    assert.equal(r.tel.capture('error', 'x', { c }), null);
    assert.doesNotThrow(() => r.tel.captureError('x', { get message() { throw new Error('no'); } }));
    assert.doesNotThrow(() => r.tel.captureError('x', null));
  });
});

describe('attach / settle / release', () => {
  test('attach respects the 5-record and 2048-byte budgets and never double-carries', () => {
    const r = rig();
    for (let i = 0; i < 8; i++) r.tel.capture('error', 's' + i, {});
    const p1 = {}; const c1 = r.tel.attach(p1);
    assert.equal(c1.length, 5);
    assert.equal(p1.telemetry.records.length, 5);
    assert.equal(p1.telemetry.records[0].source, 's7');          // newest first
    const p2 = {}; const c2 = r.tel.attach(p2);
    assert.equal(c2.length, 3);
    assert.equal(c2.some((id) => c1.includes(id)), false);
    assert.deepEqual(r.tel.attach({}), []);
    const big = rig();
    for (let i = 0; i < 4; i++) big.tel.capture('error', 'b' + i, { msg: 'é'.repeat(400) });   // ~800 UTF-8 bytes each
    const pb = {}; big.tel.attach(pb);
    assert.ok(Buffer.byteLength(JSON.stringify(pb.telemetry.records)) <= 2048);
    assert.ok(pb.telemetry.records.length < 4);
  });

  test('settle dequeues exactly telemetryAck ids, ok:false bodies included', () => {
    const r = rig();
    ['a', 'b', 'c'].forEach((s) => r.tel.capture('error', s, {}));
    const carried = r.tel.attach({});
    r.tel.settle(carried, { ok: false, error: 'denied', telemetryAck: [carried[0], 'unknown'] });
    assert.equal(r.ids().length, 2);
    assert.equal(r.ids().includes(carried[0]), false);
    // released: the remaining two are carryable again
    assert.equal(r.tel.attach({}).length, 2);
  });

  test('settle without telemetryAck dequeues nothing, releases, and schedules a flush', () => {
    const r = rig();
    r.tel.capture('error', 'a', {});
    const carried = r.tel.attach({});
    r.tel.settle(carried, { ok: true });
    assert.equal(r.ids().length, 1);
    assert.equal(r.tel.attach({}).length, 1);
    assert.ok(r.timers.some((x) => !x.cleared));
  });

  test('release (transport failure) dequeues nothing', () => {
    const r = rig();
    r.tel.capture('error', 'a', {});
    const carried = r.tel.attach({});
    r.tel.release(carried);
    assert.equal(r.ids().length, 1);
    assert.equal(r.tel.attach({}).length, 1);
  });
});

describe('flush', () => {
  test('sends <=10 and dequeues on ack, resetting backoff to 30s', async () => {
    const r = rig();
    for (let i = 0; i < 12; i++) r.tel.capture('error', 's' + i, {});
    r.sendResult = (recs) => Promise.resolve({ telemetryAck: recs.map((x) => x.id) });
    await r.tel.flush();
    assert.equal(r.sent[0].length, 10);
    assert.equal(r.ids().length, 2);
    assert.equal(r.timers.filter((x) => !x.cleared).pop().ms, 30000);
  });

  test('backoff 30/60/120/300 capped, reset by an ack; a failed flush captures nothing', async () => {
    const r = rig();
    r.tel.capture('error', 'a', {});
    assert.equal(r.timers[0].ms, 30000);
    r.sendResult = () => Promise.reject(new Error('net'));
    const seen = [];
    for (let i = 0; i < 5; i++) {
      r.t += 400000;
      await r.fire();
      seen.push(r.timers.filter((x) => !x.cleared).pop().ms);
    }
    assert.deepEqual(seen, [60000, 120000, 300000, 300000, 300000]);
    assert.equal(r.ids().length, 1, 'failed flush must not add records');
    r.sendResult = (recs) => Promise.resolve({ telemetryAck: recs.map((x) => x.id) });
    r.t += 400000;
    await r.fire();
    assert.equal(r.ids().length, 0);
    r.tel.capture('error', 'b', {});
    assert.equal(r.timers.filter((x) => !x.cleared).pop().ms, 30000);
  });

  test('a response without telemetryAck backs off and keeps the queue', async () => {
    const r = rig();
    r.sendResult = () => Promise.resolve({ ok: true });
    r.tel.capture('error', 'a', {});
    r.t += 31000;
    await r.fire();
    assert.equal(r.sent.length, 1);
    assert.equal(r.ids().length, 1);
    assert.equal(r.timers.filter((x) => !x.cleared).pop().ms, 60000);
  });

  test('timer defers while something recently carried the records', async () => {
    const r = rig();
    r.tel.capture('error', 'a', {});
    r.t += 20000;
    r.tel.attach({});           // carried at +20s
    r.t += 15000;               // timer due, but only 15s since the carry
    await r.fire();
    assert.equal(r.sent.length, 0);
    assert.equal(r.timers.filter((x) => !x.cleared).pop().ms, 15000);
  });

  test('flushOnHide beacons newest <=10 and never dequeues', () => {
    const r = rig();
    for (let i = 0; i < 12; i++) r.tel.capture('error', 's' + i, {});
    assert.equal(r.tel.flushOnHide(), true);
    assert.equal(r.beacons[0].length, 10);
    assert.equal(r.beacons[0][0], 'id13');
    assert.equal(r.ids().length, 12);
  });

  test('review: flushOnHide beacons each record id at most once per page session; a failed beacon is retried', () => {
    const r = rig();
    r.tel.capture('error', 'a', {});
    r.tel.capture('error', 'b', {});
    assert.equal(r.tel.flushOnHide(), true);
    assert.equal(r.beacons[0].length, 2);
    r.tel.flushOnHide();                              // pagehide right after visibilitychange hidden
    assert.equal(r.beacons.length, 1, 'nothing new to beacon');
    r.tel.capture('error', 'c', {});
    r.tel.flushOnHide();
    assert.equal(r.beacons[1].length, 1, 'only the new record');
    assert.equal(r.ids().length, 3, 'still never dequeues');
    r.beaconResult = false;
    r.tel.capture('error', 'd', {});
    r.tel.flushOnHide();
    r.beaconResult = true;
    r.tel.flushOnHide();
    assert.equal(r.beacons[r.beacons.length - 1].length, 1, 'failed beacon did not mark the id');
  });
});

describe('installGlobalHandlers', () => {
  function fakeWin() {
    const h = {}; const dh = {};
    return { h, dh, addEventListener: (t, f) => { h[t] = f; }, document: { visibilityState: 'visible', addEventListener: (t, f) => { dh[t] = f; } } };
  }
  test('captures error and unhandledrejection once, skipping already-captured errors; online flushes; hidden beacons', async () => {
    const r = rig();
    const w = fakeWin();
    r.tel.installGlobalHandlers(w);
    w.h.error({ error: new Error('boom'), filename: 'x.js', lineno: 3, colno: 4 });
    w.h.unhandledrejection({ reason: 'plain string' });
    const captured = new Error('already');
    r.tel.captureError('callApi', captured);
    w.h.unhandledrejection({ reason: captured });
    w.h.error({ error: captured });
    assert.deepEqual(r.tel.pending().map((x) => x.source), ['window.onerror', 'unhandledrejection', 'callApi']);
    w.h.online();
    await new Promise((s) => setImmediate(s));
    assert.equal(r.sent.length, 1);
    w.document.visibilityState = 'hidden';
    w.dh.visibilitychange();
    assert.equal(r.beacons.length, 1);
  });

  test('review3: becoming visible again clears the beaconed set, so hide -> visible -> pagehide re-beacons', () => {
    const r = rig();
    const w = fakeWin();
    r.tel.installGlobalHandlers(w);
    r.tel.capture('error', 'a', {});
    w.document.visibilityState = 'hidden';
    w.dh.visibilitychange();
    assert.equal(r.beacons.length, 1);
    w.h.pagehide();
    assert.equal(r.beacons.length, 1, 'still hidden: beaconed once');
    w.document.visibilityState = 'visible';
    w.dh.visibilitychange();
    w.h.pagehide();
    assert.equal(r.beacons.length, 2, 'return then pagehide re-beacons');
  });
});
