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
 * at flush() time (see `_activeExternalDriver()` below); dropping that file
 * removes the option with zero changes here.
 *
 * Setup: set script property GAS_LOGGER_FOLDER_ID to a Drive folder ID that is
 * mapped locally via Drive for Desktop (used by tests to poll log files when
 * no other driver is configured). To add Axiom as a sink, copy AxiomLogger.js
 * alongside this file and set its AXIOM_TOKEN + AXIOM_DATASET script
 * properties -- see AxiomLogger.js's header for exclusivity semantics
 * (once active, it is the SOLE sink; flush() does not also write Drive).
 *
 * Driver interface, for anyone adding a third sink:
 *   { name, isConfigured(), write(entries) -> {ok, status, body} }
 * `write()` must NEVER throw and NEVER swallow -- it reports every outcome
 * through its return value. flush() picks the first configured driver it
 * finds (checked in a fixed priority order in `_activeExternalDriver()`) and
 * falls back to the built-in Drive writer if none are configured -- exactly
 * one sink is ever active per flush(), never a dual-write. A single hardcoded
 * priority check is a deliberate simplification for now (see README.md "Sink
 * Architecture"); a full pluggable-registry version is not needed until a
 * third driver actually shows up.
 *
 * Dependency: every entry is stamped with `version` and `env` read from the
 * global BUILD_INFO if it exists (BUILD_INFO.version / BUILD_INFO.env),
 * falling back to 'unknown' -- so GasLogger works standalone in projects that
 * don't define BUILD_INFO. `env` is the canonical deployment-environment
 * discriminator for queries: see README.md "Environment Discrimination" for
 * the required value vocabulary (`dev` / `test` / `prod`) and why it is
 * stamped here rather than left to call sites.
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
 * (e.g. an addon calling its own WebApp over HTTP). getParentOp() lets a
 * multi-hop self-call chain propagate the ROOT caller's id onward, so every
 * hop correlates to the originating call rather than only its immediate
 * caller.
 *
 * Naming conventions: see README.md "Naming Conventions" for the tag-naming
 * (`domain.event[.subEvent]`) and data-key (`msg`/`err`, `ok`/`found`,
 * `<noun>Count`, reserved `version`/`env`/`op`/`parentOp`/`ts`/`tag`)
 * standards new call sites should follow.
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
 * PII / document content rule: `data` ships to the sink as-is -- nothing here
 * inspects or redacts it.
 *   - Never pass a raw email address or person's name into data -- use
 *     maskPiiForLog_() / maskRecipientListForLog_() below.
 *   - Never pass `e.message` or `String(e)` from a catch block. Some GAS API
 *     exceptions EMBED the payload the call was fetching in their message
 *     text, so a `catch (e) { log(tag, {msg: e.message}) }` on any
 *     content-reading path (Drive/Docs export, UrlFetchApp, ...) ships
 *     document content to an external sink. Use logError() below, which
 *     classifies the exception to a fixed keyword vocabulary and cannot
 *     structurally emit the message.
 *
 * Ingest health: a failed flush returns false, keeps the batch buffered for
 * the next attempt (capped at MAX_BUFFERED_ENTRIES), and records the failure
 * in the AXIOM_INGEST_DEGRADED script property, readable via
 * getAxiomHealth(). Nothing about a broken sink is silent.
 *
 * Testability: maskPiiForLog_() / maskRecipientListForLog_() /
 * classifyErrorKeyword_() are pure functions defined outside the closure
 * (module.exports'd at the bottom) so they can be unit-tested with plain Node,
 * without a GAS runtime. (Axiom's equivalent, buildAxiomRows_(), lives in
 * AxiomLogger.js alongside the rest of its driver -- see test_gas_logger.js.)
 */

/**
 * Masks a name or email so it is safe to include in a GasLogger entry (data passed
 * to GasLogger.log() must never contain a raw person's name or email address). Keeps
 * the first and last character -- an email's domain stays fully visible -- replacing
 * everything between with '...'. E.g. 'Little John' -> 'L...n', 'alice@example.com' -> 'a...e@example.com'.
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

/**
 * A FIXED VOCABULARY, not a slice of the message text. Each pattern is tested
 * against e.message internally (see classifyErrorKeyword_) but only the MATCHED
 * KEYWORD NAME from this list is ever returned -- never the substring that
 * matched, and never the message itself. Extend the list; never add a fallback
 * that echoes any part of the original text.
 */
var ERROR_KEYWORD_PATTERNS_ = [
  ['not_found', /not found|no such (file|folder|document)|does not exist/i],
  ['permission_denied', /permission|forbidden|access denied|insufficient (permission|scope)/i],
  // 'Exceeded maximum execution time' is Apps Script's own 6-minute wall.
  ['timeout', /timed? ?out|deadline exceeded|exceeded maximum execution time/i],
  // 'Service invoked too many times' / 'Service using too much computer time'
  // are the literal Apps Script daily-quota messages -- a vocabulary that only
  // knew 'too many requests' classified both as 'other'.
  ['quota_exceeded', /quota|rate limit|too many requests|invoked too many times|too much computer time/i],
  ['invalid_argument', /invalid (argument|value|request)|bad request/i],
  ['already_exists', /already exists|duplicate/i],
  ['unauthenticated', /unauthenticated|unauthorized|invalid credentials|invalid token/i],
  ['locked', /lock(ed)? (could not|failed|timeout)|could not obtain lock/i],
];

/**
 * Classifies e.message against ERROR_KEYWORD_PATTERNS_ WITHOUT ever returning
 * any part of the message itself. Reads e.message internally (necessary to
 * classify it); the only thing that ever leaves this function is one of the
 * literal keyword strings above, or 'other'.
 * @param {*} e the caught exception (or any thrown value)
 * @returns {string}
 */
function classifyErrorKeyword_(e) {
  var msg = '';
  try { msg = (e && e.message) ? String(e.message) : ''; } catch (_readErr) { msg = ''; }
  for (var i = 0; i < ERROR_KEYWORD_PATTERNS_.length; i++) {
    if (ERROR_KEYWORD_PATTERNS_[i][1].test(msg)) return ERROR_KEYWORD_PATTERNS_[i][0];
  }
  return 'other';
}

var GasLogger = (function () {
  var _folder = null;
  var _entries = [];
  var _enabled = true;
  var _currentOp = null;
  var _parentOp = null;
  var FLUSH_THRESHOLD = 25;
  var FOLDER_NAME = 'GAS-Logs'; // fallback name if GAS_LOGGER_FOLDER_ID is unset; rename per project

  // Cap on how many entries survive a failed flush before the oldest are
  // dropped -- bounds growth if the sink stays wedged for the rest of a long
  // execution (e.g. a multi-hundred-item sweep), rather than buffering without
  // limit. getAxiomHealth() surfaces the degraded state, so an eventual drop
  // here is diagnosable, not silent.
  var MAX_BUFFERED_ENTRIES = 200;

  // Script-property flag name. Deliberately NOT another GasLogger.log() call --
  // a self-report event would flow back through the same ingest path and could
  // itself be rejected by the very problem it is reporting. Script properties
  // have no such limit, so this is the one channel guaranteed to work even when
  // ingest is fully wedged. Logger.log (Stackdriver, via `clasp logs`) is the
  // other.
  var AXIOM_DEGRADED_PROP = 'AXIOM_INGEST_DEGRADED';

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

  function _setDegraded(status, bodyText, entries) {
    var tags = [];
    for (var i = 0; i < entries.length && tags.length < 5; i++) {
      if (tags.indexOf(entries[i].tag) === -1) tags.push(entries[i].tag);
    }
    var info = {
      ts: new Date().toISOString(),
      status: status,
      body: String(bodyText || '').slice(0, 300),
      sampleTags: tags,
    };
    try {
      PropertiesService.getScriptProperties().setProperty(AXIOM_DEGRADED_PROP, JSON.stringify(info));
    } catch (err) {
      Logger.log('GasLogger: failed to set ' + AXIOM_DEGRADED_PROP + ': ' + err);
    }
  }

  function _clearDegraded() {
    try {
      var props = PropertiesService.getScriptProperties();
      if (props.getProperty(AXIOM_DEGRADED_PROP)) props.deleteProperty(AXIOM_DEGRADED_PROP);
    } catch (err) {
      Logger.log('GasLogger: failed to clear ' + AXIOM_DEGRADED_PROP + ': ' + err);
    }
  }

  return {
    enable: function () { _enabled = true; },
    disable: function () { _enabled = false; },

    // Begin correlating every log() entry until endOp() is called. Returns
    // the generated op id (callers don't need it, but it's handy for tests).
    // receivedOpId (optional): a caller's own op id, propagated in as `parentOp`
    // on every entry -- this execution still mints its own fresh op either way.
    //
    // A nested startOp() call (e.g. a sweep function calling startOp() with no
    // arg from inside a doPost execution that already called
    // startOp(payload.opId)) must NOT wipe an already-established parentOp --
    // it falls back to the existing _parentOp rather than unconditionally
    // resetting to null. A genuinely top-level entry point (fired directly by a
    // trigger, no enclosing doPost) still gets parentOp=null, since there is no
    // existing _parentOp to fall back to.
    startOp: function (receivedOpId) {
      _currentOp = Utilities.getUuid();
      _parentOp = receivedOpId || _parentOp || null;
      return _currentOp;
    },

    endOp: function () { _currentOp = null; _parentOp = null; },

    // Lets a caller read its own current op id before issuing a UrlFetchApp
    // call into another execution, so it can pass it along as opId.
    getCurrentOp: function () { return _currentOp; },

    // Lets a caller read the op id IT was invoked under (its own parentOp), as
    // distinct from getCurrentOp(). A multi-hop self-call chain should
    // propagate the ROOT caller's opId onward so every hop correlates back to
    // the originating call -- pass
    // `GasLogger.getParentOp() || GasLogger.getCurrentOp()` as the outgoing
    // opId.
    getParentOp: function () { return _parentOp; },

    log: function (tag, data) {
      // `data` ships to the sink verbatim -- no PII/content scrubbing happens
      // here. See the module docstring's PII rule; use logError() in catch
      // blocks rather than passing e.message.
      //
      // version + env on every entry (not just call sites that remember to add
      // them) so queries can tell builds and environments apart without
      // touching every call site.
      var version = (typeof BUILD_INFO !== 'undefined' && BUILD_INFO.version) || 'unknown';
      var env = (typeof BUILD_INFO !== 'undefined' && BUILD_INFO.env) || 'unknown';
      var entry = { ts: new Date().toISOString(), tag: tag, version: version, env: env, data: data || {} };
      if (_currentOp) entry.op = _currentOp;
      if (_parentOp) entry.parentOp = _parentOp;
      Logger.log(JSON.stringify(entry));
      if (!_enabled) return;
      _entries.push(entry);
      if (_entries.length >= FLUSH_THRESHOLD) this.flush();
    },

    /**
     * Safe-by-construction alternative to `catch (e) { log(tag, { msg:
     * e.message }) }` -- the mistake that ships fetched document content to an
     * external sink, because some GAS API exceptions embed the payload the
     * call was fetching in their message text.
     *
     * `extra` is caller-supplied fields (never derived from `e`); the payload
     * this actually logs adds only `errorName` (e.name) and `errorKeyword`
     * (see classifyErrorKeyword_). e.message / String(e) are structurally
     * unavailable here, not merely avoided by convention.
     *
     * @param {string} tag
     * @param {*} e the caught exception (or any thrown value)
     * @param {Object} [extra] additional safe, non-exception-derived fields
     */
    logError: function (tag, e, extra) {
      var payload = {};
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
        }
      }
      var name = 'Error';
      try { name = (e && e.name) ? String(e.name) : 'Error'; } catch (_nameErr) { name = 'Error'; }
      payload.errorName = name;
      payload.errorKeyword = classifyErrorKeyword_(e);
      this.log(tag, payload);
    },

    /**
     * Writes the buffer to the active sink.
     *
     * @returns {boolean} true if the write succeeded (or there was nothing to
     *   flush), false if the external driver reported a failure. A failed flush
     *   does NOT discard the batch -- entries stay buffered for the next
     *   flush() (bounded by MAX_BUFFERED_ENTRIES), because otherwise a
     *   transient failure during an automatic threshold-triggered flush would
     *   permanently and silently drop that batch with no retry.
     */
    flush: function () {
      if (_entries.length === 0) return true;
      var driver = _activeExternalDriver();
      if (!driver) {
        _writeToFile(_entries);
        _entries = [];
        return true;
      }
      var result = driver.write(_entries) || { ok: false, status: 'no-result', body: '' };
      if (result.ok) {
        _entries = [];
        _clearDegraded();
        return true;
      }
      _setDegraded(result.status, result.body, _entries);
      if (_entries.length > MAX_BUFFERED_ENTRIES) {
        var dropped = _entries.length - MAX_BUFFERED_ENTRIES;
        Logger.log('GasLogger: dropping ' + dropped + ' oldest buffered entries after a failed '
          + 'flush (cap=' + MAX_BUFFERED_ENTRIES + ') -- ' + driver.name + ' ingest appears '
          + 'wedged, see ' + AXIOM_DEGRADED_PROP + ' / getAxiomHealth()');
        _entries = _entries.slice(dropped);
      }
      return false;
    },

    /**
     * Cheap health check for a human or test harness: null if ingest is (as far
     * as we know) fine, else {ts, status, body, sampleTags} describing the most
     * recent ingest failure. Does not itself call the sink.
     *
     * Expose this through a deployment-gated WebApp route (or a menu item) so
     * "is the log pipe broken?" is one call away instead of an unexplained
     * test timeout.
     */
    getAxiomHealth: function () {
      var raw = PropertiesService.getScriptProperties().getProperty(AXIOM_DEGRADED_PROP);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (err) {
        return { ts: null, status: 'unparseable', body: raw, sampleTags: [] };
      }
    },

    // Wraps an entry-point function (trigger, menu item, WebApp handler) with
    // startOp/endOp + flush so callers don't have to manage the lifecycle by
    // hand. On error, logs the error entry (via logError, so no exception text
    // is emitted), flushes, then rethrows -- a thrown error still surfaces as a
    // failed execution (Apps Script's trigger-failure email, the executions
    // log) while guaranteeing accumulated entries are not lost.
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
    classifyErrorKeyword_: classifyErrorKeyword_,
  };
}

/** Run from GAS editor to verify the active sink (whichever driver is configured, Drive otherwise). */
function testGasLogger() {
  GasLogger.startOp();
  GasLogger.log('test.start', { msg: 'hello from GasLogger' });
  GasLogger.log('test.done', { ok: true, value: 42 });
  GasLogger.endOp();
  var ok = GasLogger.flush();
  Logger.log('testGasLogger complete, flush ok=' + ok
    + ' — check the Drive folder for a new .log file, or the Axiom dataset Stream tab if configured. '
    + 'Health: ' + JSON.stringify(GasLogger.getAxiomHealth()));
}
