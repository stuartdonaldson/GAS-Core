/**
 * GasLog test helpers — read GasLogger NDJSON files from the locally-mapped Drive folder.
 *
 * These helpers are extracted from AudioTrackCombiner/tests/test-utils.js for reuse.
 * Drop this file into your test directory and configure GAS_LOG_DIR.
 *
 * Configuration (pick one):
 *   1. local.settings.json  →  { "gasLogDir": "/path/to/drive/folder" }
 *   2. Environment variable →  GAS_LOG_DIR=/path/to/drive/folder
 */

const fs = require('fs');
const path = require('path');

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

/**
 * Delete all .log files in the GAS log directory.
 * Call before each test (or test group) to prevent stale file matches.
 */
function clearGasLogs() {
  if (GAS_LOG_DIR && fs.existsSync(GAS_LOG_DIR)) {
    for (const f of fs.readdirSync(GAS_LOG_DIR)) {
      if (f.endsWith('.log')) {
        fs.unlinkSync(path.join(GAS_LOG_DIR, f));
      }
    }
  }
}

/**
 * Poll the GAS log directory until a log entry matches matchFn, or timeout.
 *
 * @param {function} matchFn     - Predicate: (entry) => boolean. Entry shape: { ts, tag, data }
 * @param {number}   timeoutMs   - How long to poll before throwing (default: 15000)
 * @returns {object}             - The first matching log entry
 * @throws {Error}               - If no match found within timeoutMs
 *
 * @example
 *   const entry = await waitForGasLog(e => e.tag === 'doGet' && e.data.folderId === id);
 *   expect(entry.data.folderId).toBe(expectedId);
 */
async function waitForGasLog(matchFn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (GAS_LOG_DIR && fs.existsSync(GAS_LOG_DIR)) {
      for (const f of fs.readdirSync(GAS_LOG_DIR)) {
        if (!f.endsWith('.log')) continue;
        try {
          const lines = fs.readFileSync(path.join(GAS_LOG_DIR, f), 'utf8')
            .split('\n')
            .filter(Boolean);
          const entries = lines.map(l => JSON.parse(l));
          const match = entries.find(matchFn);
          if (match) return match;
        } catch (_) {}
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`GasLog: no matching entry within ${timeoutMs}ms`);
}

/**
 * Count log entries matching a tag from files written after startMs (epoch ms).
 * Useful for regression tests asserting server-side call counts.
 *
 * @param {string} tag       - The tag to count (e.g. 'doGet')
 * @param {number} startMs   - Only count entries from files with timestamp >= startMs
 * @returns {number}
 */
function countGasLogEntries(tag, startMs = 0) {
  let count = 0;
  if (!GAS_LOG_DIR || !fs.existsSync(GAS_LOG_DIR)) return count;
  for (const fname of fs.readdirSync(GAS_LOG_DIR)) {
    if (!fname.endsWith('.log')) continue;
    const prefix = fname.split('-')[0];
    if (isNaN(prefix) || parseInt(prefix, 10) < startMs) continue;
    try {
      const content = fs.readFileSync(path.join(GAS_LOG_DIR, fname), 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line.trim());
          if (obj.tag === tag) count++;
        } catch (_) {}
      }
    } catch (_) {}
  }
  return count;
}

module.exports = { GAS_LOG_DIR, clearGasLogs, waitForGasLog, countGasLogEntries };
