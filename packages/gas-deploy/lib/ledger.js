'use strict';

/**
 * Deployment ledger (RECOMMENDATION.md finding #7).
 *
 * Lineage A appended one JSON line per deploy to `deployment-ledger/<target>.jsonl`; lineage B
 * lost it entirely. It is the only record of *when a given revision went out and who ran it* —
 * `clasp deployments` shows the current state, never the history.
 *
 * Append-only, one line per deploy, and a write failure never fails a deploy: the deploy already
 * succeeded by the time this runs, so refusing to record it would be strictly worse than
 * recording nothing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function writeLedgerEntry(root, targetKey, entry, { dir = 'deployment-ledger', log = console.log, stamp = true } = {}) {
  try {
    const ledgerDir = path.join(root, dir);
    fs.mkdirSync(ledgerDir, { recursive: true });
    // `stamp: false` means the consumer shaped the whole record (its ledger predates the package
    // and has readers expecting the old key names) — write exactly what it returned, adding
    // nothing, so the file stays one schema from its first line to its last.
    const record = stamp ? { at: new Date().toISOString(), user: os.userInfo().username, ...entry } : { ...entry };
    fs.appendFileSync(path.join(ledgerDir, `${targetKey}.jsonl`), JSON.stringify(record) + '\n', 'utf8');
    return record;
  } catch (err) {
    log(`⚠️  Could not write the deployment ledger entry (${err.message}) — the deploy itself succeeded.`);
    return null;
  }
}

/** Latest-deploy pointer, overwritten each time — what CI and smoke tests read. */
function writeDeployMetadata(root, entry, { file = '.deploy-metadata.json', log = console.log, stamp = true } = {}) {
  try {
    const record = stamp ? { at: new Date().toISOString(), ...entry } : { ...entry };
    fs.writeFileSync(path.join(root, file), JSON.stringify(record, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    log(`⚠️  Could not write ${file} (${err.message}) — the deploy itself succeeded.`);
    return false;
  }
}

module.exports = { writeLedgerEntry, writeDeployMetadata };
