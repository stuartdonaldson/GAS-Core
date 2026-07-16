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
 * discovery check (see GasLogger.js's `_activeDriver()`).
 *
 * Setup: set script properties AXIOM_TOKEN (an ingest token) and AXIOM_DATASET.
 * Once both are set, this driver becomes GasLogger's active sink — flush()
 * POSTs to Axiom EXCLUSIVELY, it does not also write to Drive, even if the
 * POST fails. A broken Axiom pipe is meant to surface as a test timeout
 * (polling Axiom for an entry that never lands), not be silently absorbed by
 * a Drive-file fallback. See README.md "Why Axiom-exclusive, not best-effort."
 *
 * Discovery: GasLogger.js's flush() checks `typeof AxiomLogger !== 'undefined'
 * && AxiomLogger.isConfigured()` at flush-time (not load-time), so it doesn't
 * matter which order clasp loads the two files in — Apps Script bundles every
 * .js file into one global scope with no explicit load-order guarantee, so a
 * load-time registration call (e.g. `GasLogger.registerDriver(AxiomLogger)`
 * at the bottom of this file) would be a footgun: if this file happened to
 * load before GasLogger.js, GasLogger wouldn't exist yet. A well-known global
 * name checked lazily sidesteps that entirely.
 */

/**
 * Maps GasLogger entries to Axiom ingest rows. Pure -- no GAS globals -- so
 * it's unit-testable in Node (see test_gas_logger.js).
 * @param {Array<Object>} entries - Entries as built by GasLogger.log() (ts, tag, version, op?, parentOp?, data).
 * @returns {Array<Object>} Axiom rows: { _time, name, side, version, op?, parentOp?, ...data }.
 */
function buildAxiomRows_(entries) {
  return (entries || []).map(function (e) {
    var row = Object.assign({ _time: e.ts, name: e.tag, side: 'gas', version: e.version }, e.data || {});
    if (e.op) row.op = e.op;
    if (e.parentOp) row.parentOp = e.parentOp;
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
        if (resp.getResponseCode() >= 300) {
          // Visible in `clasp logs` (Stackdriver) only -- never recurse through
          // GasLogger.log() itself. Intentionally NOT written to Drive either --
          // a broken Axiom pipe is meant to surface as a test timeout, not be
          // silently absorbed by a file fallback.
          Logger.log('AxiomLogger: ingest non-2xx ' + resp.getResponseCode() + ': ' + resp.getContentText());
        }
      } catch (err) {
        Logger.log('AxiomLogger: POST threw: ' + err);
      }
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildAxiomRows_: buildAxiomRows_ };
}
