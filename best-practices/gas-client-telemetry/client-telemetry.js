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
 * records, backed off 30/60/120/300 s, reset by any ack. flushOnHide() uses a beacon, which has no
 * response and therefore never dequeues. Nothing in this module throws, and a failed flush never
 * captures a record (that would feed itself).
 *
 * deps: storage {getItem,setItem}|null, key, now()->ms, newId()->string, setTimeout, clearTimeout,
 *       context()->object, send(records)->Promise<body>, beacon(records)->boolean,
 *       clientVersion (string|function, optional), isOnline() (optional).
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

function createClientTelemetry(deps) {
  deps = deps || {};
  var pageSession = safe_(function () { return deps.newId(); }, 'ps-' + Math.random().toString(16).slice(2));
  var mem = [];                 // in-memory queue: the fallback when storage is unavailable
  var inFlight = {};            // id -> true while a request or flush carries the record
  var backoffIndex = 0;
  var lastCarriedAt = 0;
  var timer = null;
  var flushing = false;

  function safe_(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function nowMs_() { return safe_(function () { return deps.now(); }, Date.now()); }
  function intervalMs_() { return TELEMETRY_BACKOFF_SECONDS_[backoffIndex] * 1000; }

  function load_() {
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
  function save_(list) {
    mem = list;
    try { if (deps.storage && deps.key) deps.storage.setItem(deps.key, JSON.stringify(list)); } catch (e) { /* in-memory only */ }
  }
  function prune_(list) {
    var cutoff = nowMs_() - TELEMETRY_QUEUE_MAX_AGE_MS_;
    var kept = list.filter(function (r) {
      var t = Date.parse(r.at);
      return isNaN(t) || t >= cutoff;
    });
    return kept.length > TELEMETRY_QUEUE_MAX_ ? kept.slice(kept.length - TELEMETRY_QUEUE_MAX_) : kept;
  }
  function dequeue_(ids) {
    if (!ids || !ids.length) return;
    var set = {};
    ids.forEach(function (id) { set[String(id)] = true; });
    save_(load_().filter(function (r) { return !set[String(r.id)]; }));
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

  /** Arms the single flush timer (if the queue is non-empty and none is armed). */
  function schedule_() {
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
  function bumpBackoff_() { if (backoffIndex < TELEMETRY_BACKOFF_SECONDS_.length - 1) backoffIndex++; }

  function doFlush_() {
    if (flushing || typeof deps.send !== 'function') return Promise.resolve();
    var batch = load_().filter(function (r) { return !inFlight[r.id]; }).slice(-TELEMETRY_FLUSH_BATCH_MAX_);
    if (!batch.length) return Promise.resolve();
    var ids = batch.map(function (r) { return r.id; });
    ids.forEach(function (id) { inFlight[id] = true; });
    flushing = true;
    lastCarriedAt = nowMs_();
    var p;
    try { p = Promise.resolve(deps.send(batch)); } catch (e) { p = Promise.reject(e); }
    return p.then(function (body) {
      if (body && Array.isArray(body.telemetryAck)) { dequeue_(body.telemetryAck); backoffIndex = 0; }
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
            if (k === 'id' || k === 'at' || k === 'kind' || k === 'source' || k === 'pageSession') return;
            rec[TELEMETRY_RESERVED_KEYS_.indexOf(k) === -1 ? k : 'client_' + k] = o[k];
          });
        });
        if (rec.msg !== undefined) rec.msg = clip_(String(rec.msg), TELEMETRY_MSG_MAX_);
        if (rec.stack !== undefined) rec.stack = clip_(String(rec.stack), TELEMETRY_STACK_MAX_);
        rec = JSON.parse(JSON.stringify(rec));   // plain data only; a circular field drops the record, not the page
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

    /** Adds payload.telemetry.records (<=5 records, <=2048 bytes, newest first, none already in flight). Returns carried ids. */
    attach: function (payload) {
      try {
        if (!payload || typeof payload !== 'object') return [];
        var queue = load_().filter(function (r) { return !inFlight[r.id]; }).reverse();
        var picked = [];
        var bytes = 2;
        queue.forEach(function (r) {
          if (picked.length >= TELEMETRY_ATTACH_MAX_) return;
          var size = utf8Bytes_(JSON.stringify(r)) + 1;
          if (bytes + size > TELEMETRY_ATTACH_MAX_BYTES_) return;     // too big for the piggyback; flush() carries it
          picked.push(r);
          bytes += size;
        });
        if (!picked.length) return [];
        payload.telemetry = { records: picked };
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
        if (body && Array.isArray(body.telemetryAck)) {
          dequeue_(body.telemetryAck);
          backoffIndex = 0;
        }
        schedule_();
      } catch (e) { /* never throws */ }
    },

    /** Sends one batch of <=10 now (page load, 'online'); resolves when settled. Never rejects. */
    flush: function () {
      try { return doFlush_().then(function () {}, function () {}); } catch (e) { return Promise.resolve(); }
    },

    /** Page hidden/unloading: beacon the newest <=10 records. A beacon has no response, so nothing is dequeued. */
    flushOnHide: function () {
      try {
        var batch = load_().slice(-TELEMETRY_FLUSH_BATCH_MAX_).reverse();
        if (!batch.length) return false;
        if (typeof deps.beacon === 'function' && deps.beacon(batch)) return true;
        api.flush();
        return false;
      } catch (e) { return false; }
    },

    /** error + unhandledrejection capture, flush on 'online', beacon on visibilitychange hidden / pagehide. */
    installGlobalHandlers: function (win) {
      try {
        if (!win || typeof win.addEventListener !== 'function') return;
        win.addEventListener('error', function (e) {
          var err = (e && e.error) || new Error((e && e.message) || 'window error');
          if (err && err[TELEMETRY_CAPTURED_FLAG_]) return;
          api.captureError('window.onerror', err, e && e.filename ? { file: String(e.filename).slice(-200), line: e.lineno, col: e.colno } : {});
        });
        win.addEventListener('unhandledrejection', function (e) {
          var reason = e && e.reason;
          if (reason && reason[TELEMETRY_CAPTURED_FLAG_]) return;      // already captured where it was thrown
          api.captureError('unhandledrejection', reason instanceof Error ? reason : new Error(String(reason)));
        });
        win.addEventListener('online', function () { api.flush(); });
        win.addEventListener('pagehide', function () { api.flushOnHide(); });
        if (win.document && typeof win.document.addEventListener === 'function') {
          win.document.addEventListener('visibilitychange', function () {
            if (win.document.visibilityState === 'hidden') api.flushOnHide();
          });
        }
      } catch (e) { /* never throws */ }
    },

    /** Test/diagnostic view of the persisted queue. */
    pending: function () { return load_(); }
  };
  return api;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createClientTelemetry: createClientTelemetry };
