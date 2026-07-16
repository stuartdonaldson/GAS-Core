/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * Structured server-side logger. Buffers entries in memory and flushes to
 * whichever sink driver is active, on demand or when the buffer threshold is
 * reached. GasLogger.js itself only knows one driver, its own built-in Drive
 * (NDJSON) writer -- it is the always-available, zero-external-dependency
 * fallback. Any other driver (currently: Axiom, in AxiomLogger.js) is a
 * separate file that GasLogger.js discovers lazily by well-known global name
 * at flush() time (see `_activeDriver()` below); dropping that file removes
 * the option with zero changes here.
 *
 * Setup: set script property GAS_LOGGER_FOLDER_ID to a Drive folder ID that is
 * mapped locally via Drive for Desktop (used by tests to poll log files when
 * no other driver is configured). To add Axiom as a sink, copy AxiomLogger.js
 * alongside this file and set its AXIOM_TOKEN + AXIOM_DATASET script
 * properties -- see AxiomLogger.js's header for exclusivity semantics
 * (once active, it is the SOLE sink; flush() does not also write Drive).
 *
 * Driver interface, for anyone adding a third sink: { name, isConfigured(),
 * write(entries) }. flush() picks the first configured driver it finds
 * (checked in a fixed priority order in `_activeDriver()`) and falls back to
 * the built-in Drive writer if none are configured -- exactly one sink is
 * ever active per flush(), never a dual-write. A single hardcoded priority
 * check is a deliberate simplification for now (see README.md "Sink
 * Architecture"); a full pluggable-registry version is not needed until a
 * third driver actually shows up.
 *
 * Dependency: every entry is stamped with a `version` field read from the global
 * BUILD_INFO.version if it exists, falling back to 'unknown' otherwise -- so
 * GasLogger works standalone in projects that don't define BUILD_INFO.
 *
 * Usage:
 *   GasLogger.run(function () {              // preferred -- see "Entry-point wrapper" below
 *     GasLogger.log('sync.complete', { docId: id, changesCount: 3 });
 *   });
 *
 *   // or manually:
 *   GasLogger.log('sync.complete', { docId: id, changesCount: 3 });
 *   GasLogger.flush();  // call in a finally block at the end of every entry point
 *
 * Correlation: startOp()/endOp() stamp an `op` field (a uuid) onto every log()
 * entry made between the two calls, so a single top-level invocation's
 * sub-events share one queryable id instead of relying on time-proximity.
 * Module-level state is safe here because each GAS execution gets its own
 * isolated global scope -- concurrent invocations never share this variable.
 *
 * Cross-execution correlation: startOp(receivedOpId) never adopts the caller's
 * op id as this execution's own -- that would collapse concurrent/replayed
 * invocations under one id. Instead this execution still mints its own fresh
 * op, and (if a receivedOpId was passed in) stamps it onto every entry as a
 * separate `parentOp` field. getCurrentOp() lets a caller read its own op id
 * before issuing a UrlFetchApp call so it can pass it along to the next hop
 * (e.g. an addon calling its own WebApp over HTTP).
 *
 * Naming conventions: see README.md "Naming Conventions" for the tag-naming
 * (`domain.event[.subEvent]`) and data-key (`msg`/`err`, `ok`/`found`,
 * `<noun>Count`, reserved `version`/`op`/`parentOp`/`ts`/`tag`) standards new
 * call sites should follow.
 *
 * Entry-point wrapper: GasLogger.run(fn) wraps a trigger/menu/WebApp handler so
 * startOp/endOp/flush happen automatically -- it starts an op, runs fn(), and
 * in a finally block ends the op and flushes, so accumulated entries are never
 * lost even if fn() throws or returns early. Apps Script has no execution-end
 * hook, so any entry point relying on a hand-written `flush()` at every return
 * path is one missed return statement away from silently dropping entries; run()
 * makes that failure mode structurally impossible for the wrapped function.
 * On a thrown error, run() also logs it (tag 'error') via logError() before
 * rethrowing, so the failure is captured in the same sink as everything else.
 *
 * PII rule: never pass a raw email address or person's name into data -- use
 * maskPiiForLog_() / maskRecipientListForLog_() below when an address or name
 * must appear in a log entry.
 *
 * Testability: maskPiiForLog_() and maskRecipientListForLog_() are pure
 * functions defined outside the closure (module.exports'd at the bottom) so
 * they can be unit-tested with plain Node, without a GAS runtime. (Axiom's
 * equivalent, buildAxiomRows_(), lives in AxiomLogger.js alongside the rest of
 * its driver -- see test_gas_logger.js for both.)
 */

/**
 * Masks a name or email so it is safe to include in a GasLogger entry (data passed
 * to GasLogger.log() must never contain a raw person's name or email address). Keeps
 * the first and last character -- an email's domain stays fully visible -- replacing
 * everything between with '...'. E.g. 'Little John' -> 'L...n', 'a@example.com' -> 'a@example.com'.
 * @param {string} value
 * @returns {string}
 */
function maskPiiForLog_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  var atIndex = text.indexOf('@');
  if (atIndex > 0) {
    return maskMiddleChars_(text.slice(0, atIndex)) + text.slice(atIndex);
  }
  return maskMiddleChars_(text);
}

function maskMiddleChars_(s) {
  if (s.length <= 1) return s;
  return s[0] + '...' + s[s.length - 1];
}

/**
 * Masks each address in a comma-separated recipient list, handling the optional
 * 'Display Name <email>' form.
 * @param {string} recipientList
 * @returns {string}
 */
function maskRecipientListForLog_(recipientList) {
  return String(recipientList || '').split(',').map(function (entry) {
    var trimmed = entry.trim();
    if (!trimmed) return '';
    var match = trimmed.match(/^(.*)<(.+)>$/);
    if (match) {
      var name = match[1].trim();
      var email = match[2].trim();
      return (name ? maskPiiForLog_(name) + ' ' : '') + '<' + maskPiiForLog_(email) + '>';
    }
    return maskPiiForLog_(trimmed);
  }).filter(function (entry) {
    return !!entry;
  }).join(',');
}

var GasLogger = (function () {
  var _folder = null;
  var _entries = [];
  var _enabled = true;
  var _currentOp = null;
  var _parentOp = null;
  var FLUSH_THRESHOLD = 25;
  var FOLDER_NAME = 'GAS-Logs'; // fallback name if GAS_LOGGER_FOLDER_ID is unset; rename per project

  // Checked by well-known global name at flush() time -- see file header for
  // why this is a lazy check rather than a load-time registration call. To
  // add another sink ahead of the built-in Drive one: drop in the driver
  // file, then add one more `typeof X !== 'undefined' && X.isConfigured()`
  // check here, in priority order.
  function _activeExternalDriver() {
    if (typeof AxiomLogger !== 'undefined' && AxiomLogger.isConfigured()) return AxiomLogger;
    return null;
  }

  function _getFolder() {
    if (_folder) return _folder;
    var folderId = PropertiesService.getScriptProperties().getProperty('GAS_LOGGER_FOLDER_ID');
    if (folderId) {
      _folder = DriveApp.getFolderById(folderId);
      return _folder;
    }
    var root = DriveApp.getRootFolder();
    var iter = root.getFoldersByName(FOLDER_NAME);
    _folder = iter.hasNext() ? iter.next() : root.createFolder(FOLDER_NAME);
    return _folder;
  }

  // Built-in default driver -- always available, no external dependency.
  function _writeToFile(entries) {
    var name = new Date().getTime() + '-' + Utilities.getUuid() + '.log';
    _getFolder().createFile(
      name,
      entries.map(function (e) { return JSON.stringify(e); }).join('\n'),
      MimeType.PLAIN_TEXT
    );
  }

  return {
    enable: function () { _enabled = true; },
    disable: function () { _enabled = false; },

    // Begin correlating every log() entry until endOp() is called. Returns
    // the generated op id (callers don't need it, but it's handy for tests).
    // receivedOpId (optional): a caller's own op id, propagated in as `parentOp`
    // on every entry -- this execution still mints its own fresh op either way.
    startOp: function (receivedOpId) {
      _currentOp = Utilities.getUuid();
      _parentOp = receivedOpId || null;
      return _currentOp;
    },

    endOp: function () { _currentOp = null; _parentOp = null; },

    // Lets a caller read its own current op id before issuing a UrlFetchApp
    // call into another execution, so it can pass it along as opId.
    getCurrentOp: function () { return _currentOp; },

    log: function (tag, data) {
      // version on every entry (not just call sites that remember to add it) so
      // Axiom queries can tell test/prod apart by which BUILD_INFO.version is
      // actually running, without touching every call site.
      var version = (typeof BUILD_INFO !== 'undefined' && BUILD_INFO.version) || 'unknown';
      var entry = { ts: new Date().toISOString(), tag: tag, version: version, data: data || {} };
      if (_currentOp) entry.op = _currentOp;
      if (_parentOp) entry.parentOp = _parentOp;
      Logger.log(JSON.stringify(entry));
      if (!_enabled) return;
      _entries.push(entry);
      if (_entries.length >= FLUSH_THRESHOLD) this.flush();
    },

    flush: function () {
      if (_entries.length === 0) return;
      var driver = _activeExternalDriver();
      if (driver) {
        driver.write(_entries);
      } else {
        _writeToFile(_entries);
      }
      _entries = [];
    },

    // Standardizes a caught-exception log entry so every hand-rolled try/catch
    // (e.g. an action dispatcher that must return a JSON error response instead
    // of rethrowing, so it can't just let run()'s own catch handle it) logs the
    // same shape: message + stack, plus whatever call-site context is useful.
    logError: function (tag, err, extra) {
      var data = Object.assign({ message: err && err.message, stack: err && err.stack }, extra || {});
      this.log(tag, data);
    },

    // Wraps an entry-point function (trigger, menu item, WebApp handler) with
    // startOp/endOp + flush so callers don't have to manage the lifecycle by
    // hand. On error, logs the error entry, flushes, then rethrows -- a thrown
    // error still surfaces as a failed execution (Apps Script's trigger-failure
    // email, the executions log, etc.) while guaranteeing accumulated entries
    // are not lost.
    run: function (fn) {
      this.startOp();
      try {
        return fn();
      } catch (err) {
        this.logError('error', err);
        throw err;
      } finally {
        this.endOp();
        this.flush();
      }
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    maskPiiForLog_: maskPiiForLog_,
    maskRecipientListForLog_: maskRecipientListForLog_,
  };
}

/** Run from GAS editor to verify the active sink (whichever driver is configured, Drive otherwise). */
function testGasLogger() {
  GasLogger.startOp();
  GasLogger.log('test.start', { msg: 'hello from GasLogger' });
  GasLogger.log('test.done', { ok: true, value: 42 });
  GasLogger.endOp();
  GasLogger.flush();
  Logger.log('testGasLogger complete — check Drive folder for a new .log file, or the Axiom dataset Stream tab if configured');
}
