/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * Axiom query driver for gas-log-helpers.js. Everything Axiom-API-specific
 * (querying, row-reshaping, sentinel probing, the absence-assertion strategy)
 * lives here — gas-log-helpers.js only knows this module exposes the driver
 * interface { name, isConfigured, clear, waitFor, queryAll, assertAbsence }.
 * It has no Axiom API knowledge of its own, so adding a different query
 * provider later means writing one more file shaped like this one, not
 * editing gas-log-helpers.js's internals.
 *
 * Configuration (local.settings.json): axiomDataset, axiomQueryToken (a
 * READ-ONLY query token — never the ingest AXIOM_TOKEN GasLogger.js/
 * AxiomLogger.js use server-side). Sentinel-watermark probing additionally
 * needs webappTestUrl + webappSecret — see README.md "Sentinel-Watermark
 * Waits" for why a bare timeout is unsound for asserting absence against
 * Axiom's variable ingest latency, and what the WebApp probe route must do.
 *
 * Requires Node 18+ (uses the built-in global `fetch`).
 */

/**
 * @param {Object} settings - Parsed local.settings.json (or equivalent).
 * @returns {Object} Driver: { name, isConfigured, clear, waitFor, queryAll, assertAbsence }
 */
function createAxiomDriver(settings) {
  const dataset = settings.axiomDataset;
  const token = settings.axiomQueryToken;

  /**
   * Query Axiom for GAS-side entries since `afterMs` (epoch ms). Reshapes rows
   * back to { ts, tag, version, op, parentOp, data } — the same shape every
   * other driver's entries take — so matchFn predicates work unchanged
   * regardless of which driver is active.
   */
  async function queryAll(afterMs, limit = 500) {
    const start = new Date(afterMs).toISOString();
    const now = new Date().toISOString();
    const apl = `['${dataset}'] | where side == 'gas' | order by _time asc | limit ${limit}`;
    const resp = await fetch('https://api.axiom.co/v1/datasets/_apl?format=legacy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apl, startTime: start, endTime: now }),
    });
    if (!resp.ok) {
      throw new Error(`Axiom query failed (${resp.status}): ${(await resp.text()).slice(0, 500)}`);
    }
    const result = await resp.json();
    return (result.matches || []).map((m) => {
      const data = { ...(m.data || {}) };
      const tag = data.name;
      delete data.name;
      const version = data.version;
      delete data.version;
      const op = data.op;
      delete data.op;
      const parentOp = data.parentOp;
      delete data.parentOp;
      delete data.side;
      return { ts: m._time, tag, version, op, parentOp, data };
    });
  }

  async function waitFor(matchFn, timeoutMs, afterMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entries = await queryAll(afterMs);
      const match = entries.find(matchFn);
      if (match) return match;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`GasLog: no matching entry within ${timeoutMs}ms (axiom driver)`);
  }

  async function postProbe(sentinel) {
    const url = settings.webappTestUrl;
    const secret = settings.webappSecret;
    if (!url || !secret) {
      throw new Error('axiom driver: webappTestUrl/webappSecret required in local.settings.json for sentinel probing');
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'axiom_probe', secret, sentinel }),
    });
    if (!resp.ok) {
      throw new Error(`axiom_probe POST failed (${resp.status}): ${(await resp.text()).slice(0, 500)}`);
    }
  }

  /**
   * Round-trip ms from a WebApp axiom_probe POST to the entry being queryable
   * in Axiom. Doubles as a health-check (throws if Axiom is configured but the
   * pipe is broken) and as a calibration number for sizing wait windows
   * elsewhere. Call once per test session, not per-assertion.
   */
  async function probeLatency(timeoutMs = 30000) {
    const sentinel = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fence = Date.now() - 2000;
    const t0 = Date.now();
    await postProbe(sentinel);
    await waitFor((e) => e.tag === 'test.axiom_probe' && e.data && e.data.sentinel === sentinel, timeoutMs, fence);
    return Date.now() - t0;
  }

  /**
   * Sentinel-watermark absence check: a bare timeout is unsound against
   * Axiom's variable ingest-to-queryable latency (a real, delayed entry could
   * still be in flight when the timeout expires, producing a false pass).
   * POST a fresh sentinel now, wait until IT is observably queryable —
   * proving ingest has caught up to "now" — then check the suspect tag is
   * absent from everything observed up to that point.
   */
  async function assertAbsence(matchFn, what, afterMs) {
    const sentinel = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await postProbe(sentinel);
    try {
      await waitFor((e) => e.tag === 'test.axiom_probe' && e.data && e.data.sentinel === sentinel, 30000, afterMs);
    } catch (err) {
      throw new Error(
        `GasLog: sentinel-watermark probe never landed in Axiom within 30s — cannot soundly assert absence (${what})`
      );
    }
    const entries = await queryAll(afterMs);
    const bad = entries.find(matchFn);
    if (bad) {
      throw new Error(`GasLog: unexpected entry found (${what}): ${JSON.stringify(bad)}`);
    }
  }

  return {
    name: 'axiom',
    isConfigured: () => !!(dataset && token),
    clear: () => Date.now() - 2000, // nothing to delete server-side; just returns a fence
    waitFor,
    queryAll,
    assertAbsence,
    probeLatency,
  };
}

module.exports = { createAxiomDriver };
