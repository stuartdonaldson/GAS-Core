/**
 * Plain-Node unit tests for client-telemetry.js. Run: node --test test_client_telemetry.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createClientTelemetry } = require('./client-telemetry.js');

const DAY = 24 * 60 * 60 * 1000;

function rig(over) {
  const store = (over && over.store) || new Map();
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
    ...(r.deps || {}),
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

// ---- activity channel (GAS-Core-ccy) ----

function act(over, extra) {
  const idle = [];
  const r = rig(Object.assign({}, over, {
    deps: Object.assign({ channel: 'activity', requestIdleCallback: (fn, o) => { idle.push({ fn, o }); return idle.length; } }, extra),
  }));
  r.idle = idle;
  r.persist = () => { const q = idle.splice(0); q.forEach((x) => x.fn()); return q.length; };
  r.live = () => r.timers.filter((x) => !x.cleared);
  return r;
}
function ackAll(recs) { return Promise.resolve({ telemetryAck: recs.map((x) => x.id) }); }
const tick = () => new Promise((s) => setImmediate(s));

describe('ccy AC1: channel and per-channel limits', () => {
  test('default instance stamps no channel; explicit error/activity instances stamp channel on every record', () => {
    assert.equal('channel' in rig().tel.capture('error', 'x', {}), false);
    assert.equal(rig({ deps: { channel: 'error' } }).tel.capture('error', 'x', {}).channel, 'error');
    assert.equal(act().tel.capture('nav', 'x', { channel: 'spoof' }).channel, 'activity');
  });

  test('activity queue holds 200 records, oldest dropped, and records older than 7 days are dropped', () => {
    const a = act();
    for (let i = 0; i < 205; i++) a.tel.capture('nav', 's' + i, {});
    a.persist();
    const q = a.tel.pending();
    assert.equal(q.length, 200);
    assert.equal(q[0].source, 's5');
    assert.equal(JSON.parse(a.store.get('k')).length, 200);
    const b = act();
    b.tel.capture('nav', 'old', {});
    b.t += 8 * DAY;
    b.tel.capture('nav', 'new', {});
    b.persist();
    assert.deepEqual(b.tel.pending().map((x) => x.source), ['new']);
  });

  test('activity attach carries <=10 records / 2048 bytes; flush batch is <=25', async () => {
    const a = act();
    for (let i = 0; i < 30; i++) a.tel.capture('nav', 's' + i, {});
    const p = {};
    const c = a.tel.attach(p);
    assert.equal(c.length, 10);
    assert.ok(p.telemetry.records.every((x) => x.channel === 'activity'));
    a.tel.release(c);
    a.t += 10 * 60 * 1000;
    a.sendResult = ackAll;
    await a.tel.flush();
    assert.equal(a.sent[0].length, 25);
    const big = act();
    for (let i = 0; i < 12; i++) big.tel.capture('nav', 'b' + i, { msg: 'é'.repeat(300) });
    const pb = {};
    big.tel.attach(pb);
    assert.ok(Buffer.byteLength(JSON.stringify(pb.telemetry.records)) <= 2048);
    assert.ok(pb.telemetry.records.length < 12);
  });

  test('deps.limits overrides the channel defaults', () => {
    const a = act(undefined, { limits: { queueMax: 3, attachMax: 2 } });
    for (let i = 0; i < 5; i++) a.tel.capture('nav', 's' + i, {});
    assert.equal(a.tel.pending().length, 3);
    assert.equal(a.tel.attach({}).length, 2);
  });
});

describe('ccy AC2: activity capture is memory-only; persist is deferred', () => {
  test('capture does no storage read, no storage write and no whole-queue JSON on the calling tick', () => {
    const store = new Map();
    let reads = 0, writes = 0;
    const storage = { getItem: (k) => { reads++; return store.has(k) ? store.get(k) : null; }, setItem: (k, v) => { writes++; store.set(k, String(v)); } };
    const a = act({ storage, store });
    for (let i = 0; i < 50; i++) a.tel.capture('nav', 's' + i, {});
    a.persist();
    const r0 = reads, w0 = writes;
    const orig = JSON.stringify;
    let arrays = 0;
    JSON.stringify = function (v, ...rest) { if (Array.isArray(v)) arrays++; return orig.call(JSON, v, ...rest); };
    try { a.tel.capture('nav', 'hot', {}); } finally { JSON.stringify = orig; }
    assert.equal(reads, r0, 'no storage read');
    assert.equal(writes, w0, 'no storage write');
    assert.equal(arrays, 0, 'no whole-queue JSON');
    assert.equal(a.tel.pending().pop().source, 'hot');
    assert.equal(JSON.parse(store.get('k')).some((x) => x.source === 'hot'), false);
    a.persist();
    assert.equal(JSON.parse(store.get('k')).pop().source, 'hot');
  });

  test('captures coalesce into one deferred persist: requestIdleCallback (timeout 2s) when present, else setTimeout 2s', () => {
    const a = act();
    ['a', 'b', 'c'].forEach((s) => a.tel.capture('nav', s, {}));
    assert.equal(a.idle.length, 1);
    assert.equal(a.idle[0].o.timeout, 2000);
    assert.equal(a.store.has('k'), false);
    a.persist();
    assert.equal(JSON.parse(a.store.get('k')).length, 3);
    a.tel.capture('nav', 'd', {});
    assert.equal(a.idle.length, 1);
    const b = rig({ deps: { channel: 'activity' } });
    ['a', 'b', 'c'].forEach((s) => b.tel.capture('nav', s, {}));
    const p = b.timers.filter((x) => !x.cleared && x.ms === 2000);
    assert.equal(p.length, 1);
    assert.equal(b.store.has('k'), false);
    p[0].cleared = true; p[0].fn();
    assert.equal(JSON.parse(b.store.get('k')).length, 3);
  });

  test('flushOnHide persists before it beacons', () => {
    const store = new Map();
    let atBeacon = null;
    const a = act({ store }, { beacon: () => { atBeacon = JSON.parse(store.get('k')).length; return true; } });
    a.tel.capture('nav', 'a', {});
    a.tel.capture('nav', 'b', {});
    assert.equal(a.tel.flushOnHide(), true);
    assert.equal(atBeacon, 2);
  });

  test('the persisted activity queue is loaded at creation (survives a reload)', () => {
    const store = new Map();
    const a = act({ store });
    a.tel.capture('nav', 'a', {});
    a.tel.capture('nav', 'b', {});
    a.persist();
    assert.deepEqual(act({ store }).tel.pending().map((x) => x.source), ['a', 'b']);
  });
});

describe('ccy AC3: activity flush is low-rate', () => {
  function fakeWin() {
    const h = {}; const dh = {};
    return { h, dh, addEventListener: (t, f) => { h[t] = f; }, document: { visibilityState: 'visible', addEventListener: (t, f) => { dh[t] = f; } } };
  }

  test('below 20 records and under 5 min nothing is sent; page-load flush() and online only check; 20 records send', async () => {
    const a = act();
    const w = fakeWin();
    a.tel.installGlobalHandlers(w);
    assert.equal(w.h.error, undefined, 'activity instance does not capture window errors');
    assert.equal(w.h.unhandledrejection, undefined);
    for (let i = 0; i < 19; i++) a.tel.capture('nav', 's' + i, {});
    await a.tel.flush();
    w.h.online();
    await tick();
    assert.equal(a.sent.length, 0);
    a.tel.capture('nav', 's19', {});
    await a.fire();
    assert.equal(a.sent.length, 1);
    assert.equal(a.sent[0].length, 20);
  });

  test('an oldest unsent record of 5 min triggers a send', async () => {
    const a = act();
    a.tel.capture('nav', 'a', {});
    await a.tel.flush();
    assert.equal(a.sent.length, 0);
    assert.equal(a.live().pop().ms, 300000);
    a.t += 300000;
    await a.fire();
    assert.equal(a.sent.length, 1);
  });

  test('no send within 60s of a carrier that took activity', async () => {
    const a = act();
    a.sendResult = ackAll;
    a.tel.capture('nav', 'a', {});
    a.t += 270000;
    a.tel.release(a.tel.attach({}));           // carried at +4.5 min, transport failed
    a.t += 30000;                               // oldest is 5 min old, but carried 30s ago
    await a.fire();
    assert.equal(a.sent.length, 0);
    assert.equal(a.live().pop().ms, 30000);
    a.t += 30000;
    await a.fire();
    assert.equal(a.sent.length, 1);
  });

  test('at most one activity send per 60s', async () => {
    const a = act();
    a.sendResult = ackAll;
    for (let i = 0; i < 45; i++) a.tel.capture('nav', 's' + i, {});
    await a.fire();
    assert.equal(a.sent.length, 1);
    assert.equal(a.sent[0].length, 25);
    assert.equal(a.tel.pending().length, 20);
    await a.tel.flush();
    assert.equal(a.sent.length, 1, 'flush() inside the 60s window only checks');
    assert.equal(a.live().pop().ms, 60000);
    a.t += 60000;
    await a.fire();
    assert.equal(a.sent.length, 2);
    assert.equal(a.sent[1].length, 20);
  });

  test('failures back off 30/60/120/300 s under the 60s floor; a failed send captures nothing; an ack resets', async () => {
    const a = act();
    a.sendResult = () => Promise.reject(new Error('net'));
    for (let i = 0; i < 20; i++) a.tel.capture('nav', 's' + i, {});
    await a.fire();
    const seen = [];
    for (let i = 0; i < 5; i++) {
      const ms = a.live().pop().ms;
      seen.push(ms);
      a.t += ms;
      await a.fire();
    }
    assert.deepEqual(seen, [60000, 60000, 120000, 300000, 300000]);
    assert.equal(a.tel.pending().length, 20, 'failed send must not add records');
    a.sendResult = ackAll;
    a.t += a.live().pop().ms;
    await a.fire();
    assert.equal(a.tel.pending().length, 0);
    a.sendResult = () => Promise.reject(new Error('net'));
    a.t += 60000;
    for (let i = 0; i < 20; i++) a.tel.capture('nav', 't' + i, {});
    await a.fire();
    assert.equal(a.live().pop().ms, 60000, 'backoff was reset by the ack');
  });
});

describe('ccy AC4: error and activity instances share one carrier', () => {
  test('error records first, channel per record, each instance within its own budget; settle/release per instance', () => {
    const store = new Map();
    const e = rig({ store, deps: { channel: 'error', key: 'ke' } });
    let n = 0;
    const a = act({ store }, { key: 'ka', newId: () => 'act' + (++n) });
    for (let i = 0; i < 8; i++) e.tel.capture('error', 'e' + i, {});
    for (let i = 0; i < 15; i++) a.tel.capture('nav', 'a' + i, {});
    const payload = {};
    const ca = a.tel.attach(payload);           // activity attached first on purpose
    const ce = e.tel.attach(payload);
    const recs = payload.telemetry.records;
    assert.equal(ce.length, 5);
    assert.equal(ca.length, 10);
    assert.equal(recs.length, 15);
    assert.ok(recs.slice(0, 5).every((x) => x.channel === 'error'));
    assert.ok(recs.slice(5).every((x) => x.channel === 'activity'));
    assert.ok(Buffer.byteLength(JSON.stringify(recs.slice(5))) <= 2048);
    const body = { ok: true, telemetryAck: recs.map((x) => x.id) };
    e.tel.settle(ce, body);
    a.tel.settle(ca, body);
    assert.equal(e.tel.pending().length, 3);
    assert.equal(a.tel.pending().length, 5);
    const p2 = {};
    const ce2 = e.tel.attach(p2);
    const ca2 = a.tel.attach(p2);
    assert.equal(p2.telemetry.records.length, 8);
    e.tel.release(ce2);
    a.tel.release(ca2);
    assert.equal(e.tel.pending().length, 3);
    assert.equal(a.tel.pending().length, 5);
    assert.equal(e.tel.attach({}).length, 3);
    assert.equal(a.tel.attach({}).length, 5);
  });
});

// ---- review fixes rev 4 (GAS-Core-ccy items 9-11) ----

describe('ccy item 9: beaconedAt persisted; stale beaconed records dropped at creation', () => {
  const { TELEMETRY_BEACON_DEDUPE_TTL_MS_ } = require('./client-telemetry.js');
  for (const channel of ['error', 'activity']) {
    test(channel + ': beacon persists beaconedAt; creation drops records beaconed > 6 h ago, keeps younger and unbeaconed', () => {
      const store = new Map();
      const mk = () => (channel === 'activity' ? act({ store }) : rig({ store }));
      const a = mk();
      assert.equal(TELEMETRY_BEACON_DEDUPE_TTL_MS_, 6 * 60 * 60 * 1000);
      a.tel.capture('nav', 'old', {});
      a.tel.capture('nav', 'young', {});
      a.tel.capture('nav', 'never', {});
      const ids = a.ids();
      assert.equal(a.tel.flushOnHide(), true);
      const stored = JSON.parse(store.get('k'));
      assert.equal(stored.length, 3);
      assert.ok(stored.every((r) => typeof r.beaconedAt === 'number'), 'beaconedAt persisted');
      const byId = {};
      stored.forEach((r) => { byId[r.id] = r; });
      byId[ids[0]].beaconedAt = a.t - TELEMETRY_BEACON_DEDUPE_TTL_MS_ - 1000;      // older than the dedupe window
      byId[ids[1]].beaconedAt = a.t - TELEMETRY_BEACON_DEDUPE_TTL_MS_ + 60000;     // still deduped
      delete byId[ids[2]].beaconedAt;
      store.set('k', JSON.stringify(stored));
      const b = mk();
      assert.deepEqual(b.ids(), [ids[1], ids[2]]);
    });
  }
  test('a failed beacon does not set beaconedAt', () => {
    const store = new Map();
    const a = rig({ store, beaconResult: false });
    a.tel.capture('error', 's', {});
    a.tel.flushOnHide();
    assert.equal(JSON.parse(store.get('k'))[0].beaconedAt, undefined);
  });
});

describe('ccy item 10: an ack of none of the carried ids is a backoff failure', () => {
  test('error channel: a dedicated send acking none of its ids backs off (30 s, then 60 s)', async () => {
    const a = rig({ sendResult: () => Promise.resolve({ telemetryAck: ['other'] }) });
    a.tel.capture('error', 's', {});
    await a.fire();
    assert.equal(a.sent.length, 1);
    assert.equal(a.timers.filter((x) => !x.cleared).pop().ms, 60000, 'interval after one failure');
  });
  test('a settle acking none of the carried ids counts as a failure; acking a carried id resets', async () => {
    const a = rig();
    a.tel.capture('error', 's', {});
    const c = a.tel.attach({});
    a.tel.settle(c, { telemetryAck: ['zzz'] });
    await a.fire();                                  // fires the armed timer: carried just now, so it waits one interval
    assert.equal(a.timers.filter((x) => !x.cleared).pop().ms, 60000, 'backoff advanced');
    const c2 = a.tel.attach({});
    a.tel.settle(c2, { telemetryAck: c2 });
    assert.equal(a.tel.pending().length, 0);
    a.tel.capture('error', 's2', {});
    const c3 = a.tel.attach({});
    a.tel.settle(c3, { telemetryAck: ['zzz'] });
    await a.fire();
    assert.equal(a.timers.filter((x) => !x.cleared).pop().ms, 60000, 'reset by an ack of a carried id, then one failure (would be 120000 without the reset)');
  });
  test('activity: a send acking none of its ids is not re-sent before the backoff', async () => {
    const a = act({ sendResult: () => Promise.resolve({ telemetryAck: [] }) });
    for (let i = 0; i < 20; i++) a.tel.capture('nav', 's' + i, {});
    await a.fire();
    assert.equal(a.sent.length, 1);
    a.t += 61000;                                   // past the 60 s floor, inside the (grown) backoff? 30 s elapsed -> due
    await a.tel.flush();
    assert.equal(a.sent.length, 2, 'first failure waits 30 s, under the 60 s floor');
    a.t += 61000;                                   // second failure waits 60 s
    await a.tel.flush();
    assert.equal(a.sent.length, 3);
    a.t += 61000;                                   // third failure waits 120 s
    await a.tel.flush();
    assert.equal(a.sent.length, 3, 'backoff now exceeds the 60 s floor');
  });
  test('a settle that carried nothing does not touch backoff', () => {
    const a = rig();
    a.tel.capture('error', 's', {});
    a.tel.settle([], { telemetryAck: ['q'] });
    assert.equal(a.timers.filter((x) => !x.cleared).pop().ms, 30000);
  });
});

describe('ccy item 11: dequeue writes storage only when something was removed', () => {
  test('settle acking an unknown id performs no setItem; acking a queued id performs one', () => {
    const store = new Map();
    const writes = [];
    const st = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { writes.push(k); store.set(k, v); } };
    let n = 0;
    const t = createClientTelemetry({ storage: st, key: 'k', now: () => Date.parse('2026-10-26T12:00:00Z'), newId: () => 'q' + (++n), setTimeout: () => ({}), clearTimeout: () => {} });
    const rec = t.capture('error', 's', {});
    const before = writes.length;
    t.settle([], { telemetryAck: ['nope'] });
    assert.equal(writes.length, before);
    t.settle([], { telemetryAck: [rec.id] });
    assert.equal(writes.length, before + 1);
  });
});
