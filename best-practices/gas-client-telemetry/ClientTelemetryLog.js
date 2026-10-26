/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * ClientTelemetryLog.js -- server-side receiver for client-telemetry.js (GAS-Core
 * best-practices/gas-client-telemetry; generalised from F3Go30 script/ClientTelemetryLog.js).
 *
 * Copied VERBATIM into a project's GAS source. GAS globals style: no require of project files.
 * Defaults: logs through GasLogger.log and dedupes through CacheService.getScriptCache(); both can
 * be injected (opts.log, opts.cache) so the module unit-tests in plain Node.
 *
 * Each new record is logged once as tag 'client.<kind>' (a kind that is not /^[a-zA-Z]{1,32}$/ is
 * 'client.unknown'). Dedupe is by the client-minted record id, 6h, so a client that re-sends before
 * it sees an ack does not double-log. Every logged or already-seen id is acked; the client dequeues
 * exactly those. A key GasLogger stamps itself (version, env, op, parentOp, ts, tag) would be
 * overwritten or collide on the Axiom row, so it is renamed client_<key>.
 *
 * The caller owns identity: pass the who-fields (visitor, ip, email...) as `context`; they are
 * stamped on every logged record.
 */
var CLIENT_TELEMETRY_DEDUPE_TTL_SECONDS_ = 6 * 60 * 60;
var CLIENT_TELEMETRY_DEDUPE_KEY_PREFIX_ = 'ctlSeen:';
var CLIENT_TELEMETRY_BATCH_MAX_ = 25;
var CLIENT_TELEMETRY_RESERVED_KEYS_ = ['version', 'env', 'op', 'parentOp', 'ts', 'tag'];

function clientTelemetryDedupeKey_(id) {
  return CLIENT_TELEMETRY_DEDUPE_KEY_PREFIX_ + String(id).slice(0, 200); // CacheService keys cap at 250 chars
}

/** 'client.<kind>' for a plain alphabetic kind, else 'client.unknown'. */
function clientTelemetryTag_(kind) {
  return 'client.' + ((typeof kind === 'string' && /^[a-zA-Z]{1,32}$/.test(kind)) ? kind : 'unknown');
}

/** Copies a record (then context) into a log payload, renaming GasLogger-stamped keys to client_<key>. */
function clientTelemetryData_(rec, context) {
  var data = {};
  [rec, context].forEach(function (src) {
    Object.keys(src || {}).forEach(function (k) {
      data[CLIENT_TELEMETRY_RESERVED_KEYS_.indexOf(k) === -1 ? k : 'client_' + k] = src[k];
    });
  });
  return data;
}

/**
 * Logs each not-yet-seen record, skipping records already seen or without an id. The batch is
 * untrusted client input: capped at 25, never trusted for shape. A cache failure degrades to "no
 * dedupe", never to dropping records.
 * @param {Array<Object>} records
 * @param {Object=} context - fields stamped on every logged row (who fields).
 * @param {{log: function(string, Object), cache: Object}=} opts - injected log / cache (tests).
 * @returns {{logged: number, skipped: number, ackIds: Array<string>}}
 */
function handleClientTelemetryBatch_(records, context, opts) {
  opts = opts || {};
  var list = Array.isArray(records) ? records.slice(0, CLIENT_TELEMETRY_BATCH_MAX_) : [];
  var log = opts.log || function (tag, data) { GasLogger.log(tag, data); };
  var cache = null;
  var seen = {};
  try {
    cache = opts.cache || CacheService.getScriptCache();
    var keys = list.filter(function (r) { return r && r.id; }).map(function (r) { return clientTelemetryDedupeKey_(r.id); });
    seen = (keys.length && cache.getAll(keys)) || {};
  } catch (e) { cache = null; seen = {}; }
  var logged = 0, skipped = 0;
  var ackIds = [];
  var toPut = {};
  list.forEach(function (rec) {
    if (!rec || typeof rec !== 'object' || !rec.id) { skipped++; return; }
    var key = clientTelemetryDedupeKey_(rec.id);
    if (seen[key] || toPut[key]) { skipped++; ackIds.push(String(rec.id)); return; }
    try {
      log(clientTelemetryTag_(rec.kind), clientTelemetryData_(rec, context));
    } catch (e) { skipped++; return; }     // not logged => not acked => the client retries
    toPut[key] = '1';
    ackIds.push(String(rec.id));
    logged++;
  });
  if (cache && Object.keys(toPut).length) {
    try { cache.putAll(toPut, CLIENT_TELEMETRY_DEDUPE_TTL_SECONDS_); } catch (e) { /* costs at most one re-log */ }
  }
  return { logged: logged, skipped: skipped, ackIds: ackIds };
}

/**
 * Ingests payload.telemetry.records carried by an ordinary request. Returns the ids to ack, or null
 * when the request carried none. Never throws: on failure it acks nothing ([]) so the records ride
 * the next request. Not for the dedicated 'clientTelemetry' action (records at top level): use
 * handleClientTelemetryPost_.
 */
function logPiggybackedClientTelemetry_(payload, context, opts) {
  var records = payload && payload.telemetry && payload.telemetry.records;
  if (!Array.isArray(records) || !records.length) return null;
  try {
    return handleClientTelemetryBatch_(records, context, opts).ackIds;
  } catch (e) {
    return [];
  }
}

/** Handler for the dedicated 'clientTelemetry' action (payload.records at top level). Never throws. */
function handleClientTelemetryPost_(payload, context, opts) {
  try {
    var r = handleClientTelemetryBatch_(payload && payload.records, context, opts);
    return { ok: true, result: { logged: r.logged, skipped: r.skipped }, telemetryAck: r.ackIds };
  } catch (e) {
    return { ok: true, result: { logged: 0, skipped: 0 }, telemetryAck: [] };
  }
}

/** Merges telemetryAck into a JSON response object (ok:true or ok:false alike) when ids is non-null. */
function attachTelemetryAck_(response, ids) {
  if (!ids || !response || typeof response !== 'object') return response;
  return Object.assign({}, response, { telemetryAck: ids });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handleClientTelemetryBatch_: handleClientTelemetryBatch_,
    handleClientTelemetryPost_: handleClientTelemetryPost_,
    logPiggybackedClientTelemetry_: logPiggybackedClientTelemetry_,
    attachTelemetryAck_: attachTelemetryAck_,
    clientTelemetryTag_: clientTelemetryTag_
  };
}
