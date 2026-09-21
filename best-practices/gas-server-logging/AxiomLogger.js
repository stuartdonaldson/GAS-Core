/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * Axiom sink driver for GasLogger. Optional — copy this file alongside
 * GasLogger.js only if you want Axiom as a sink; without it, GasLogger.js
 * falls back to its built-in Drive driver with zero code changes. Everything
 * Axiom-API-specific (config lookup, row-shaping, the ingest POST) lives here
 * — GasLogger.js itself has no Axiom-specific code, just a generic driver
 * discovery check (see GasLogger.js's `_activeExternalDriver()`).
 *
 * Setup: set script properties AXIOM_TOKEN (an INGEST-only token) and
 * AXIOM_DATASET. Once both are set, this driver becomes GasLogger's active
 * sink — flush() POSTs to Axiom EXCLUSIVELY, it does not also write to Drive.
 * A broken Axiom pipe is meant to surface (as a degraded-health flag and a
 * failed flush() return), not be silently absorbed by a Drive-file fallback.
 * See README.md "Why Axiom-exclusive, not best-effort."
 *
 * Discovery: GasLogger.js's flush() checks `typeof AxiomLogger !== 'undefined'
 * && AxiomLogger.isConfigured()` at flush-time (not load-time), so it doesn't
 * matter which order clasp loads the two files in — Apps Script bundles every
 * .js file into one global scope with no explicit load-order guarantee, so a
 * load-time registration call (e.g. `GasLogger.registerDriver(AxiomLogger)`
 * at the bottom of this file) would be a footgun: if this file happened to
 * load before GasLogger.js, GasLogger wouldn't exist yet. A well-known global
 * name checked lazily sidesteps that entirely.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THIS FILE EXISTS TO ENFORCE. Both were learned the hard way; a
 * project that "simplifies" either one re-opens a production incident.
 * ---------------------------------------------------------------------------
 *
 * 1. NEVER SPREAD `e.data` AS TOP-LEVEL ROW KEYS.
 *    Axiom caps a dataset at 257 fields. Every distinct key that has EVER
 *    appeared at the top level of an ingested row mints a permanent column.
 *    Spreading a free-form payload (`Object.assign(row, e.data)`) across a few
 *    hundred call sites — never mind a dynamic-key payload like
 *    `{ ['markedBy' + docId]: ... }` — walks a dataset into that cap, after
 *    which Axiom SILENTLY DROPS the new field at ingest. Every row here nests
 *    its payload under ONE `data` field, with a small fixed list of
 *    query-shaping keys (AXIOM_HOISTED_KEYS, below) hoisted back out. A column
 *    with many VALUES is fine; a payload that mints a column per VALUE is not.
 *    The dataset's `data` field must be configured as a MAP FIELD in Axiom's
 *    dataset settings (a one-time web-UI action) for the nesting to actually
 *    collapse into one field. See README.md "One-Time Setup".
 *
 * 2. NEVER SWALLOW AN INGEST FAILURE.
 *    write() reports every outcome through its RETURN VALUE and never throws.
 *    An earlier version of this file logged a non-2xx to `Logger.log()` and
 *    returned undefined, so a caller had no way to know its entries never
 *    landed — which is precisely how rule 1's silent column-drop stayed
 *    invisible. GasLogger.js turns a `{ok:false}` into a retained buffer, an
 *    AXIOM_INGEST_DEGRADED script property, and a falsy flush() return.
 *
 * ---------------------------------------------------------------------------
 * Per-project configuration: define AXIOM_HOISTED_KEYS (below) and the `app`
 * value. Everything else is repo-independent — do not fork this file.
 */

/**
 * Payload keys promoted out of the nested `data` map into real top-level Axiom
 * columns, because they are what cross-event queries filter and group by.
 *
 * PER-PROJECT: keep this list SHORT (a handful) and stable, and pick keys whose
 * *name* is fixed even though their *value* varies widely — an entity id, an
 * actor, a tenant. Never hoist a key whose name is computed at runtime.
 * Existing choices, for reference:
 *   GActionSheet: docId, docIds, eu
 *   NDocs:        teamId, resourceId, actorEmail
 *
 * `env`, `version`, `app`, `side`, `op`, `parentOp` are stamped unconditionally
 * by buildAxiomRows_ and must NOT be listed here.
 */
var AXIOM_HOISTED_KEYS = [];

/**
 * Short, stable identifier for this Apps Script project, stamped as the `app`
 * column on every row. Even with the one-dataset-per-repo convention (README
 * "Dataset Convention"), this is what makes a row self-describing when someone
 * pastes it into a ticket or queries two datasets side by side.
 * PER-PROJECT: set to the repo name, lowercased.
 */
var AXIOM_APP_NAME = 'unknown-app';

/**
 * Maps GasLogger entries to Axiom ingest rows. Pure -- no GAS globals -- so
 * it's unit-testable in Node (see test_gas_logger.js).
 *
 * @param {Array<Object>} entries Entries as built by GasLogger.log()
 *   ({ts, tag, version, env, op?, parentOp?, data}).
 * @param {Object} [opts] {app, hoistedKeys} — defaults to AXIOM_APP_NAME /
 *   AXIOM_HOISTED_KEYS; parameterized only so tests can drive it directly.
 * @returns {Array<Object>} Axiom rows:
 *   {_time, name, side, app, version, env, op?, parentOp?, <hoisted...>, data}.
 */
function buildAxiomRows_(entries, opts) {
  opts = opts || {};
  var app = opts.app || (typeof AXIOM_APP_NAME !== 'undefined' ? AXIOM_APP_NAME : 'unknown-app');
  var hoisted = opts.hoistedKeys || (typeof AXIOM_HOISTED_KEYS !== 'undefined' ? AXIOM_HOISTED_KEYS : []);
  return (entries || []).map(function (e) {
    var payload = e.data || {};
    var row = {
      _time: e.ts,
      name: e.tag,
      side: 'gas',
      app: app,
      version: e.version || 'unknown',
      env: e.env || 'unknown',
    };
    if (e.op) row.op = e.op;
    if (e.parentOp) row.parentOp = e.parentOp;

    // Rule 1 (see file header): the payload nests under ONE `data` field.
    var rest = {};
    var hoistedAny = false;
    for (var k in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      if (hoisted.indexOf(k) !== -1) {
        row[k] = payload[k];
        hoistedAny = true;
      } else {
        rest[k] = payload[k];
      }
    }
    row.data = hoistedAny ? rest : payload;
    return row;
  });
}

var AxiomLogger = (function () {
  var _config = null;

  function _getConfig() {
    if (_config) return _config;
    var props = PropertiesService.getScriptProperties();
    _config = {
      token: props.getProperty('AXIOM_TOKEN'),
      dataset: props.getProperty('AXIOM_DATASET'),
    };
    return _config;
  }

  return {
    name: 'axiom',

    isConfigured: function () {
      var config = _getConfig();
      return !!(config.token && config.dataset);
    },

    /**
     * POSTs `entries` to the Axiom ingest endpoint.
     *
     * NEVER THROWS and NEVER SWALLOWS (rule 2, file header): every outcome —
     * success, non-2xx, thrown network error — is reported through the return
     * value so GasLogger.js can retain the batch for retry, set the
     * AXIOM_INGEST_DEGRADED health flag, and return a falsy flush(). Any
     * future edit here must preserve that contract; a `catch {}` that returns
     * nothing re-creates the silent-drop failure mode this file documents.
     *
     * @param {Array<Object>} entries
     * @returns {{ok: boolean, status: (number|string), body: string}}
     */
    write: function (entries) {
      var config = _getConfig();
      try {
        var rows = buildAxiomRows_(entries);
        var resp = UrlFetchApp.fetch(
          'https://api.axiom.co/v1/datasets/' + config.dataset + '/ingest',
          {
            method: 'post',
            contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + config.token },
            payload: JSON.stringify(rows),
            muteHttpExceptions: true,
          }
        );
        var status = resp.getResponseCode();
        if (status >= 300) {
          var bodyText = resp.getContentText();
          // Visible in `clasp logs` (Stackdriver) as well — but Logger.log is
          // NOT the signal; the return value is. Never recurse through
          // GasLogger.log() here: a self-report event would flow back through
          // this same path and could be rejected by the very problem it is
          // reporting.
          Logger.log('AxiomLogger: ingest non-2xx ' + status + ': ' + bodyText);
          return { ok: false, status: status, body: bodyText };
        }
        return { ok: true, status: status, body: '' };
      } catch (err) {
        Logger.log('AxiomLogger: POST threw: ' + err);
        return { ok: false, status: 'exception', body: String(err) };
      }
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildAxiomRows_: buildAxiomRows_ };
}
