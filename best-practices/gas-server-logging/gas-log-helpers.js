/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * GasLog test helpers — driver-agnostic. Reads GAS-side structured log entries
 * from whichever sink GasLogger.js is actually flushing to.
 *
 * This file owns the file (Drive-mapped NDJSON) driver directly, since it has
 * no external service and no API-specific logic worth splitting out. Every
 * other driver (currently just Axiom) lives in its own module — see
 * axiom-log-helpers.js — and is selected here purely by calling its
 * `isConfigured()`. Adding a third provider later means writing one more
 * driver module and one more line in `_selectDriver()` below, not touching
 * every function's internals.
 *
 * Driver interface: { name, isConfigured(), clear(), waitFor(matchFn, timeoutMs,
 * afterMs), queryAll(afterMs) }. Axiom's driver additionally exposes
 * assertAbsence()/probeLatency() because sound absence-checking needs a
 * strategy specific to that backend's ingest latency — see README.md
 * "Sentinel-Watermark Waits".
 *
 * GasLogger.js's flush() writes to exactly one sink at a time (Axiom once
 * configured, Drive otherwise) — no dual-write, no silent fallback on Axiom
 * failure. So local.settings.json's driver selection here MUST match whatever
 * the live GAS script is actually configured with, or these helpers will poll
 * a sink nothing is writing to and every wait will time out.
 *
 * Configuration:
 *   File driver  → local.settings.json: { "gasLogDir": "/path/to/drive/folder" }
 *                   or env var GAS_LOG_DIR
 *   Axiom driver → local.settings.json: { "axiomDataset": "...", "axiomQueryToken": "..." }
 *                   (+ webappTestUrl/webappSecret for sentinel probing)
 *
 * Requires Node 18+ (uses the built-in global `fetch`).
 */

const fs = require('fs');
const path = require('path');
const { createAxiomDriver } = require('./axiom-log-helpers');

function _loadLocalSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

const _settings = _loadLocalSettings();

/** Local filesystem path where Google Drive for Desktop maps the GAS log folder. */
const GAS_LOG_DIR = _settings.gasLogDir || process.env.GAS_LOG_DIR;

// ---------------------------------------------------------------------------
// File driver (built-in default — no external service, so it lives here
// rather than in its own module).
// ---------------------------------------------------------------------------

function _readFileEntries() {
  const entries = [];
  if (!GAS_LOG_DIR || !fs.existsSync(GAS_LOG_DIR)) return entries;
  for (const f of fs.readdirSync(GAS_LOG_DIR)) {
    if (!f.endsWith('.log')) continue;
    try {
      const lines = fs.readFileSync(path.join(GAS_LOG_DIR, f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch (_) {}
      }
    } catch (_) {}
  }
  return entries;
}

const _fileDriver = {
  name: 'file',
  isConfigured: () => !!GAS_LOG_DIR,

  /** Deletes existing .log files (legacy behavior) and returns a fence. */
  clear: () => {
    if (GAS_LOG_DIR && fs.existsSync(GAS_LOG_DIR)) {
      for (const f of fs.readdirSync(GAS_LOG_DIR)) {
        if (f.endsWith('.log')) fs.unlinkSync(path.join(GAS_LOG_DIR, f));
      }
    }
    return Date.now() - 2000; // small buffer for clock skew / in-flight writes
  },

  waitFor: async (matchFn, timeoutMs, afterMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = _readFileEntries()
        .filter((e) => !afterMs || new Date(e.ts).getTime() >= afterMs)
        .find(matchFn);
      if (match) return match;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`GasLog: no matching entry within ${timeoutMs}ms (file driver)`);
  },

  queryAll: async (afterMs) =>
    _readFileEntries().filter((e) => !afterMs || new Date(e.ts).getTime() >= afterMs),

  /**
   * The Drive write is effectively synchronous from this process's
   * perspective, so a short bare wait is a sound absence check here (unlike
   * Axiom, which needs the sentinel-watermark strategy for the same purpose).
   */
  assertAbsence: async (matchFn, what, afterMs) => {
    try {
      const entry = await _fileDriver.waitFor(matchFn, 8000, afterMs);
      throw new Error(`GasLog: unexpected entry found (${what}): ${JSON.stringify(entry)}`);
    } catch (err) {
      if (err.message.startsWith('GasLog: unexpected entry found')) throw err;
      // timeout — no matching entry, as expected
    }
  },
};

const _axiomDriver = createAxiomDriver(_settings);

/** First configured driver wins — mirrors GasLogger.js's own "exactly one active sink" policy. */
function _selectDriver() {
  if (_axiomDriver.isConfigured()) return _axiomDriver;
  return _fileDriver;
}

// ---------------------------------------------------------------------------
// Public API — driver-agnostic; every call site uses these unchanged
// regardless of which driver is active.
// ---------------------------------------------------------------------------

/**
 * Returns a fence (epoch ms). Pass to waitForGasLog/countGasLogEntries as
 * `afterMs` to ignore stale entries from a previous or concurrent GAS run.
 */
function clearGasLogs() {
  return _selectDriver().clear();
}

/**
 * Poll until a log entry matching matchFn is found, or throw on timeout.
 *
 * @param {function} matchFn   - Predicate: (entry) => boolean. Entry shape: { ts, tag, op, parentOp, data }
 * @param {number}   timeoutMs - How long to poll before throwing (default: 15000)
 * @param {number}   afterMs   - Ignore entries older than this fence (from clearGasLogs())
 * @returns {object}           - The first matching log entry
 *
 * @example
 *   const fence = clearGasLogs();
 *   await page.goto('');
 *   const entry = await waitForGasLog(e => e.tag === 'doGet.start', 15000, fence);
 *   expect(entry.data.route).toBeTruthy();
 */
async function waitForGasLog(matchFn, timeoutMs = 15000, afterMs = 0) {
  return _selectDriver().waitFor(matchFn, timeoutMs, afterMs);
}

/**
 * Count log entries matching a tag, from entries at/after startMs (epoch ms).
 * Useful for regression tests asserting server-side call counts.
 */
async function countGasLogEntries(tag, startMs = 0) {
  const entries = await _selectDriver().queryAll(startMs);
  return entries.filter((e) => e.tag === tag).length;
}

/**
 * Assert a matching log entry appears within timeoutMs of afterMs. Thin
 * wrapper over waitForGasLog that throws with a labeled message on timeout.
 */
async function assertGasLog(matchFn, what, afterMs = 0, timeoutMs = 60000) {
  try {
    return await waitForGasLog(matchFn, timeoutMs, afterMs);
  } catch (err) {
    throw new Error(`GasLog: expected entry not found (${what}): ${err.message}`);
  }
}

/**
 * Assert no matching log entry appears at/after afterMs. Delegates to the
 * active driver's own absence-checking strategy — see README.md
 * "Sentinel-Watermark Waits" for why that strategy differs by driver.
 */
async function assertNoGasLog(matchFn, what, afterMs = 0) {
  return _selectDriver().assertAbsence(matchFn, what, afterMs);
}

/**
 * Round-trip ms from a WebApp axiom_probe POST to the entry being queryable
 * in Axiom. Axiom-only — throws if the active driver is not Axiom. Doubles as
 * a health-check and as a calibration number for sizing wait windows
 * elsewhere. Call once per test session, not per-assertion.
 */
async function axiomProbeLatency(timeoutMs = 30000) {
  const driver = _selectDriver();
  if (driver.name !== 'axiom' || !driver.probeLatency) {
    throw new Error('axiomProbeLatency requires axiomDataset/axiomQueryToken in local.settings.json');
  }
  return driver.probeLatency(timeoutMs);
}

module.exports = {
  GAS_LOG_DIR,
  clearGasLogs,
  waitForGasLog,
  countGasLogEntries,
  assertGasLog,
  assertNoGasLog,
  axiomProbeLatency,
};
