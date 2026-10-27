/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * client-telemetry.js -- browser-side error/event queue delivered to the server log until the
 * server acknowledges it (GAS-Core best-practices/gas-client-telemetry; origin: F3Go30).
 *
 * Copied VERBATIM into a page's own <script> block and required unchanged by node tests. ES5-style,
 * pure dependency injection: nothing here touches window/localStorage/fetch directly.
 *
 * Protocol in one paragraph: capture() queues a record (persisted under deps.key, capped 25 records
 * / 7 days, in-memory when storage is unavailable). attach(payload) piggybacks up to 5 records /
 * 2048 bytes onto an ordinary request; the server logs them and answers with telemetryAck: [ids];
 * settle() dequeues exactly those ids. A transport failure (release) or a response without
 * telemetryAck dequeues nothing. flush() is the background path: a dedicated send() of <=10
 * records, backed off 30/60/120/300 s, reset by any ack. flushOnHide() uses a beacon (each record id at most
 * once per page session), which has no response and therefore never dequeues. Nothing in this module throws, and a failed flush never
 * captures a record (that would feed itself).
 *
 * Channels: deps.channel 'error' (default) or 'activity'. An activity instance has its own queue
 * (200 records / 7 days, attach <=10 / 2048 bytes, flush <=25; deps.limits overrides any of
 * queueMax, maxAgeMs, attachMax, attachMaxBytes, flushBatchMax). Its capture() appends in memory only;
 * storage is read once at creation and written later, coalesced (requestIdleCallback, else
 * setTimeout 2 s), and again before a hide beacon. Its flush is low-rate: no send within 60 s of a
 * carry or a send, then only when >=20 records are unsent or the oldest is 5 min old; flush() and
 * 'online' only check. An instance given deps.channel stamps it on every record; an error and an
 * activity instance can attach() to the same payload (error records first, each within its own budget).
 *
 * deps: storage {getItem,setItem}|null, key, now()->ms, newId()->string, setTimeout, clearTimeout,
 *       context()->object, send(records)->Promise<body>, beacon(records)->boolean,
 *       clientVersion (string|function, optional), isOnline() (optional),
 *       channel ('error'|'activity', optional), limits (object, optional),
 *       requestIdleCallback (optional; activity persist, else the global one, else setTimeout).
 */
var TELEMETRY_QUEUE_MAX_ = 25;
var TELEMETRY_QUEUE_MAX_AGE_MS_ = 7 * 24 * 60 * 60 * 1000;
var TELEMETRY_ATTACH_MAX_ = 5;
var TELEMETRY_ATTACH_MAX_BYTES_ = 2048;
var TELEMETRY_FLUSH_BATCH_MAX_ = 10;
var TELEMETRY_BACKOFF_SECONDS_ = [30, 60, 120, 300];
var TELEMETRY_MSG_MAX_ = 500;
var TELEMETRY_STACK_MAX_ = 1200;
// Keys GasLogger stamps on every row; a record may not carry them (the server renames to client_<key>).
var TELEMETRY_RESERVED_KEYS_ = ['version', 'env', 'op', 'parentOp', 'ts', 'tag'];
var TELEMETRY_CAPTURED_FLAG_ = '__telemetryCaptured';
var TELEMETRY_ACTIVITY_LIMITS_ = { queueMax: 200, maxAgeMs: TELEMETRY_QUEUE_MAX_AGE_MS_, attachMax: 10, attachMaxBytes: 2048, flushBatchMax: 25 };
var TELEMETRY_ACTIVITY_QUIET_MS_ = 60 * 1000;          // no activity send within 60 s of a carry or a send
var TELEMETRY_ACTIVITY_FLUSH_COUNT_ = 20;              // send once this many records are unsent...
var TELEMETRY_ACTIVITY_FLUSH_AGE_MS_ = 5 * 60 * 1000;  // ...or the oldest unsent record is this old
var TELEMETRY_PERSIST_DELAY_MS_ = 2000;
// Server dedupe window of ClientTelemetryLog.js (CLIENT_TELEMETRY_DEDUPE_TTL_SECONDS_ = 6 h, a CacheService TTL).
// Keep in step with that constant: a beaconed record older than this would no longer be deduped, so it is dropped.
var TELEMETRY_BEACON_DEDUPE_TTL_MS_ = 6 * 60 * 60 * 1000;

function createClientTelemetry(deps) {
  deps = deps || {};
  var pageSession = safe_(function () { return deps.newId(); }, 'ps-' + Math.random().toString(16).slice(2));
  var activity = deps.channel === 'activity';
  var stampChannel = deps.channel !== undefined && deps.channel !== null;   // default instance: records as before
  var channel = activity ? 'activity' : 'error';
  var limits = limits_();
  var mem = [];                 // in-memory queue: the fallback when storage is unavailable (activity: authoritative)
  var dirty = false;            // activity: mem changed since the last persist
  var persistPending = false;   // activity: a deferred persist is scheduled
  var retryAt = 0;              // activity: no send before this (failure backoff)
  var timerAt = 0;              // activity: when the armed timer is due
  var inFlight = {};            // id -> true while a request or flush carries the record
  var backoffIndex = 0;
  var lastCarriedAt = 0;
  var timer = null;
  var flushing = false;
  var beaconed = {};            // id -> true once beaconed this page session (a beacon never dequeues)

  function safe_(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function nowMs_() { return safe_(function () { return deps.now(); }, Date.now()); }
  function intervalMs_() { return TELEMETRY_BACKOFF_SECONDS_[backoffIndex] * 1000; }

  /** Channel defaults, each overridable by a positive number in deps.limits. */
  function limits_() {
    var base = activity ? TELEMETRY_ACTIVITY_LIMITS_ : {
      queueMax: TELEMETRY_QUEUE_MAX_, maxAgeMs: TELEMETRY_QUEUE_MAX_AGE_MS_, attachMax: TELEMETRY_ATTACH_MAX_,
      attachMaxBytes: TELEMETRY_ATTACH_MAX_BYTES_, flushBatchMax: TELEMETRY_FLUSH_BATCH_MAX_
    };
    var out = {};
    Object.keys(base).forEach(function (k) {
      var v = deps.limits && typeof deps.limits === 'object' ? deps.limits[k] : undefined;
      out[k] = (typeof v === 'number' && v > 0) ? v : base[k];
    });
    return out;
  }

  function read_() {
    var list = null;
    try {
      if (deps.storage && deps.key) {
        var raw = deps.storage.getItem(deps.key);
        list = raw ? JSON.parse(raw) : [];
      }
    } catch (e) { list = null; }
    if (!Array.isArray(list)) list = mem;
    return list.filter(function (r) { return r && typeof r === 'object' && r.id; });
  }
  /** Error channel: storage on every call. Activity: the in-memory queue (storage was read once at creation). */
  function load_() { return activity ? mem : read_(); }
  function save_(list) {
    mem = list;
    if (activity) { dirty = true; schedulePersist_(); return; }
    write_(list);
  }
  function write_(list) {
    try { if (deps.storage && deps.key) deps.storage.setItem(deps.key, JSON.stringify(list)); } catch (e) { /* in-memory only */ }
  }
  function pruneAge_(list) {
    var cutoff = nowMs_() - limits.maxAgeMs;
    return list.filter(function (r) {
      var t = Date.parse(r.at);
      return isNaN(t) || t >= cutoff;
    });
  }
  function prune_(list) {
    var kept = pruneAge_(list);
    return kept.length > limits.queueMax ? kept.slice(kept.length - limits.queueMax) : kept;
  }

  /** Activity: writes the queue (age-pruned) if it changed since the last persist. */
  function persist_() {
    persistPending = false;
    if (!dirty) return;
    dirty = false;
    mem = pruneAge_(mem);
    write_(mem);
  }
  /** Activity: one deferred persist per batch of changes, off the calling tick. */
  function schedulePersist_() {
    if (persistPending) return;
    persistPending = true;
    try {
      var ric = typeof deps.requestIdleCallback === 'function' ? deps.requestIdleCallback
        : (typeof requestIdleCallback === 'function' ? requestIdleCallback : null);
      if (ric) ric(persist_, { timeout: TELEMETRY_PERSIST_DELAY_MS_ });
      else if (typeof deps.setTimeout === 'function') deps.setTimeout(persist_, TELEMETRY_PERSIST_DELAY_MS_);
      else persist_();      // no way to defer: persist now rather than never
    } catch (e) { persistPending = false; }
  }
  function dequeue_(ids) {
    if (!ids || !ids.length) return;
    var set = {};
    ids.forEach(function (id) { set[String(id)] = true; });
    var before = load_();
    var after = before.filter(function (r) { return !set[String(r.id)]; });
    if (after.length !== before.length) save_(after);
  }
  /** Drops records a beacon accepted more than the server dedupe window ago (they could no longer be deduped). */
  function dropStaleBeaconed_(list) {
    var cutoff = nowMs_() - TELEMETRY_BEACON_DEDUPE_TTL_MS_;
    return list.filter(function (r) { return typeof r.beaconedAt !== 'number' || r.beaconedAt >= cutoff; });
  }
  /** Persists beaconedAt on the records a beacon accepted. */
  function markBeaconed_(batch) {
    var at = nowMs_();
    var set = {};
    batch.forEach(function (r) { set[r.id] = true; });
    if (activity) {
      mem.forEach(function (r) { if (set[r.id]) r.beaconedAt = at; });
      dirty = true;
      persist_();
      return;
    }
    var list = load_();
    list.forEach(function (r) { if (set[r.id]) r.beaconedAt = at; });
    write_(list);
    mem = list;
  }
  function utf8Bytes_(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  function clip_(v, max) { return typeof v === 'string' ? v.slice(0, max) : v; }
  function mark_(err) { try { if (err && typeof err === 'object') err[TELEMETRY_CAPTURED_FLAG_] = true; } catch (e) { /* frozen */ } }

  function release_(ids) { (ids || []).forEach(function (id) { delete inFlight[id]; }); }
  function unsent_() { return load_().filter(function (r) { return !inFlight[r.id]; }); }

  /** Activity: the earliest time a send may go (ms), or -1 when nothing is unsent. */
  function activityDueAt_() {
    var unsent = unsent_();
    if (!unsent.length) return -1;
    var due = 0;
    if (unsent.length < TELEMETRY_ACTIVITY_FLUSH_COUNT_) {
      var t = Date.parse(unsent[0].at);
      due = isNaN(t) ? 0 : t + TELEMETRY_ACTIVITY_FLUSH_AGE_MS_;
    }
    if (lastCarriedAt) due = Math.max(due, lastCarriedAt + TELEMETRY_ACTIVITY_QUIET_MS_);
    return Math.max(due, retryAt);
  }
  /** Arms the single flush timer (if the queue is non-empty and none is armed). */
  function schedule_() {
    if (activity) { armActivity_(); return; }
    if (timer !== null || typeof deps.setTimeout !== 'function') return;
    if (!load_().length) return;
    function arm_(ms) {
      timer = deps.setTimeout(function () {
        timer = null;
        var wait = lastCarriedAt + intervalMs_() - nowMs_();   // something carried recently: let it ack first
        if (lastCarriedAt && wait > 0) { arm_(wait); return; }
        doFlush_();
      }, ms);
    }
    arm_(intervalMs_());
  }
  /** Activity: arms the single timer for when a send becomes due, or pulls an armed one forward. */
  function armActivity_() {
    if (typeof deps.setTimeout !== 'function') return;
    var due = activityDueAt_();
    if (due < 0) return;
    var now = nowMs_();
    var at = Math.max(due, now);
    if (timer !== null) {
      if (timerAt <= at) return;
      safe_(function () { deps.clearTimeout(timer); }, null);
    }
    timerAt = at;
    timer = deps.setTimeout(function () { timer = null; checkActivity_(); }, at - now);
  }
  /** Activity flush check (timer, flush(), 'online'): sends only when due, else re-arms. */
  function checkActivity_() {
    var due = activityDueAt_();
    if (due < 0 || flushing) return Promise.resolve();   // a running send re-checks when it settles
    if (due <= nowMs_()) return doFlush_();
    armActivity_();
    return Promise.resolve();
  }
  function bumpBackoff_() {
    if (activity) retryAt = nowMs_() + intervalMs_();   // 30/60/120/300 s, under the 60 s send floor
    if (backoffIndex < TELEMETRY_BACKOFF_SECONDS_.length - 1) backoffIndex++;
  }
  /** Dequeues the acked ids. An ack of none of the ids this instance carried counts as a failure for backoff. */
  function acked_(ids, carried) {
    dequeue_(ids);
    var set = {};
    (ids || []).forEach(function (id) { set[String(id)] = true; });
    var mine = (carried || []).some(function (id) { return set[String(id)]; });
    if (mine) { backoffIndex = 0; retryAt = 0; }
    else if (carried && carried.length) bumpBackoff_();
  }

  function doFlush_() {
    if (flushing || typeof deps.send !== 'function') return Promise.resolve();
    var batch = unsent_().slice(-limits.flushBatchMax);
    if (!batch.length) return Promise.resolve();
    var ids = batch.map(function (r) { return r.id; });
    ids.forEach(function (id) { inFlight[id] = true; });
    flushing = true;
    lastCarriedAt = nowMs_();
    var p;
    try { p = Promise.resolve(deps.send(batch)); } catch (e) { p = Promise.reject(e); }
    return p.then(function (body) {
      if (body && Array.isArray(body.telemetryAck)) acked_(body.telemetryAck, ids);
      else bumpBackoff_();
    }, function () {
      bumpBackoff_();     // never captures: a failing flush must not feed the queue it is draining
    }).then(function () {
      flushing = false;
      release_(ids);
      schedule_();
    });
  }

  var api = {
    pageSession: pageSession,

    /** Queues one record. Never throws. Returns the record (or null on failure). */
    capture: function (kind, source, fields) {
      try {
        var rec = {
          id: deps.newId(),
          at: new Date(nowMs_()).toISOString(),
          kind: String(kind),
          source: String(source),
          pageSession: pageSession,
          clientVersion: typeof deps.clientVersion === 'function' ? safe_(deps.clientVersion, '') : (deps.clientVersion || ''),
          online: typeof deps.isOnline === 'function' ? safe_(deps.isOnline, null) : null
        };
        var extras = [typeof deps.context === 'function' ? safe_(deps.context, {}) : {}, fields || {}];
        extras.forEach(function (o) {
          Object.keys(o || {}).forEach(function (k) {
            if (k === 'id' || k === 'at' || k === 'kind' || k === 'source' || k === 'pageSession' || (stampChannel && k === 'channel')) return;
            rec[TELEMETRY_RESERVED_KEYS_.indexOf(k) === -1 ? k : 'client_' + k] = o[k];
          });
        });
        if (rec.msg !== undefined) rec.msg = clip_(String(rec.msg), TELEMETRY_MSG_MAX_);
        if (rec.stack !== undefined) rec.stack = clip_(String(rec.stack), TELEMETRY_STACK_MAX_);
        if (stampChannel) rec.channel = channel;
        rec = JSON.parse(JSON.stringify(rec));   // plain data only; a circular field drops the record, not the page
        if (activity) {
          // Hot path: append in memory; no storage read, no whole-queue JSON. Persist is deferred.
          mem.push(rec);
          if (mem.length > limits.queueMax) mem.splice(0, mem.length - limits.queueMax);
          dirty = true;
          schedulePersist_();
          if (timer === null || mem.length >= TELEMETRY_ACTIVITY_FLUSH_COUNT_) schedule_();
          return rec;
        }
        save_(prune_(load_().concat([rec])));
        schedule_();
        return rec;
      } catch (e) { return null; }
    },

    /** capture('error', ...) from an Error (or anything thrown); marks it so it is captured once. */
    captureError: function (source, err, fields) {
      try {
        var f = { msg: (err && err.message) ? err.message : String(err) };
        if (err && err.stack) f.stack = String(err.stack);
        mark_(err);
        var extra = fields || {};
        Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
        return api.capture('error', source, f);
      } catch (e) { return null; }
    },

    /**
     * Adds to payload.telemetry.records (error <=5 records / activity <=10, <=2048 bytes, newest first,
     * none already in flight). Returns carried ids. Records another instance already attached are kept;
     * the budget counts only this instance's own records. Error records go before them, activity after.
     */
    attach: function (payload) {
      try {
        if (!payload || typeof payload !== 'object') return [];
        var queue = unsent_().reverse();
        var picked = [];
        var bytes = 2;
        queue.forEach(function (r) {
          if (picked.length >= limits.attachMax) return;
          var size = utf8Bytes_(JSON.stringify(r)) + 1;
          if (bytes + size > limits.attachMaxBytes) return;     // too big for the piggyback; flush() carries it
          picked.push(r);
          bytes += size;
        });
        if (!picked.length) return [];
        var t = payload.telemetry;
        var existing = (t && typeof t === 'object' && Array.isArray(t.records)) ? t.records : [];
        payload.telemetry = { records: activity ? existing.concat(picked) : picked.concat(existing) };
        lastCarriedAt = nowMs_();
        var ids = picked.map(function (r) { return r.id; });
        ids.forEach(function (id) { inFlight[id] = true; });
        return ids;
      } catch (e) { return []; }
    },

    /** Transport failure: nothing was acked, so nothing is dequeued; the records become carryable again. */
    release: function (carried) {
      try { release_(carried); schedule_(); } catch (e) { /* never throws */ }
    },

    /** A parsed response body: dequeue exactly body.telemetryAck; without one, release and schedule a flush. */
    settle: function (carried, body) {
      try {
        release_(carried);
        if (body && Array.isArray(body.telemetryAck)) acked_(body.telemetryAck, carried);
        schedule_();
      } catch (e) { /* never throws */ }
    },

    /**
     * Error channel: sends one batch of <=10 now (page load, 'online'). Activity: a flush check, which
     * sends <=25 only when due (else arms the timer). Resolves when settled. Never rejects.
     */
    flush: function () {
      try { return (activity ? checkActivity_() : doFlush_()).then(function () {}, function () {}); } catch (e) { return Promise.resolve(); }
    },

    /**
     * Page hidden/unloading: beacon the newest <=10 (activity: 25) records not yet beaconed this page
     * session. A beacon has no response, so nothing is dequeued. Activity persists first.
     */
    flushOnHide: function () {
      try {
        if (activity) persist_();
        var batch = load_().filter(function (r) { return !beaconed[r.id]; }).slice(-limits.flushBatchMax).reverse();
        if (!batch.length) return false;
        if (typeof deps.beacon === 'function' && deps.beacon(batch)) {
          batch.forEach(function (r) { beaconed[r.id] = true; });
          markBeaconed_(batch);
          return true;
        }
        api.flush();
        return false;
      } catch (e) { return false; }
    },

    /** error + unhandledrejection capture (error channel only), flush on 'online', beacon on visibilitychange hidden / pagehide. */
    installGlobalHandlers: function (win) {
      try {
        if (!win || typeof win.addEventListener !== 'function') return;
        if (!activity) win.addEventListener('error', function (e) {
          var err = (e && e.error) || new Error((e && e.message) || 'window error');
          if (err && err[TELEMETRY_CAPTURED_FLAG_]) return;
          api.captureError('window.onerror', err, e && e.filename ? { file: String(e.filename).slice(-200), line: e.lineno, col: e.colno } : {});
        });
        if (!activity) win.addEventListener('unhandledrejection', function (e) {
          var reason = e && e.reason;
          if (reason && reason[TELEMETRY_CAPTURED_FLAG_]) return;      // already captured where it was thrown
          api.captureError('unhandledrejection', reason instanceof Error ? reason : new Error(String(reason)));
        });
        win.addEventListener('online', function () { api.flush(); });
        win.addEventListener('pagehide', function () { api.flushOnHide(); });
        if (win.document && typeof win.document.addEventListener === 'function') {
          win.document.addEventListener('visibilitychange', function () {
            if (win.document.visibilityState === 'hidden') api.flushOnHide();
            else if (win.document.visibilityState === 'visible') beaconed = {};   // back on screen: a later hide re-beacons
          });
        }
      } catch (e) { /* never throws */ }
    },

    /** Test/diagnostic view of the persisted queue. */
    pending: function () { return load_().slice(); }
  };
  if (activity) mem = dropStaleBeaconed_(pruneAge_(read_())).slice(-limits.queueMax);   // the only storage read of an activity instance
  else {
    var stored = read_();
    var fresh = dropStaleBeaconed_(stored);
    if (fresh.length !== stored.length) write_(fresh);
    mem = fresh;
  }
  return api;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createClientTelemetry: createClientTelemetry, TELEMETRY_BEACON_DEDUPE_TTL_MS_: TELEMETRY_BEACON_DEDUPE_TTL_MS_ };
