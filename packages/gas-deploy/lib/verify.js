'use strict';

/**
 * Deploy verification (RECOMMENDATION.md §3.2, finding #13) — the single most valuable thing
 * this package adds.
 *
 * Every pre-package variant reported success when `clasp deploy` exited 0. That proves a version
 * was *created*, not that the /exec URL is serving it. This closes the gap on real failure modes
 * seen in these projects: a deployment silently converted to a library because appsscript.json
 * lost its `webapp` section, an edge that has not propagated, a push that landed in the wrong
 * script project because clasp fell back to the wrong credentials (#1), and a named deployment
 * left pointing at an older version.
 *
 * The contract each consumer's webapp exposes — no secret required, so it answers on an
 * ANYONE_ANONYMOUS deployment and before any secret is bootstrapped:
 *
 *   GET/POST ?cmd=version -> { ok, version, versionDate, target, deploymentId }
 *
 * This file is Node-side only. The route itself is per-project GAS code (each consumer adds its
 * own `handleVersionRequest_`), because only the project knows where its stamper wrote.
 */

const { execUrl, post } = require('./webapp.js');

function sleep_(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Polls cmd=version until the webapp reports the exact version AND target just stamped.
 *
 * The **target** half is what catches a deploy landing in the wrong environment — nothing before
 * this could detect that. It matters most where several targets share one version counter (RCV's
 * SIT/PROD/NUUC), because there a version match alone proves nothing about *which* environment
 * answered.
 *
 * Polls rather than checking once for the same reason execWithRetry exists: the ~5s
 * edge-propagation race (#9). Everything is injected (postFn/sleep/log) so match, mismatch and
 * timeout are all unit-testable with no network call and no wall-clock wait.
 *
 * **Settling (`settleReads`, default 2).** A single agreeing read is not proof the fleet has
 * turned over. Three PracticeMix stages independently watched `cmd=version` answer with the new
 * version while one action still ran old code — converging in ~1 min / 3 retries for a code
 * change and ~90 s for a manifest change (PLAN2 F8). So success requires N *consecutive*
 * agreeing reads, spaced by the poll interval, and a disagreeing read in between resets the
 * count. `settleReads: 1` restores the pre-F8 single-read behaviour.
 */
async function assertDeployedVersion(deploymentId, expectedVersion, expectedTarget, options = {}) {
  const {
    postFn = post, intervalSec = 5, timeoutSec = 60, settleReads = 2, sleep = sleep_, log = () => {},
  } = options;
  const url = execUrl(deploymentId, 'version');
  const startedAt = Date.now();
  let attempt = 0;
  let streak = 0;
  let lastResult = null;
  let lastMatch = null;

  for (;;) {
    attempt++;
    try {
      lastResult = await postFn(url, { action: 'version' });
    } catch (err) {
      log(`  attempt ${attempt}: request failed (${err.message})`);
      lastResult = null;
    }

    const matched = !!(lastResult && lastResult.ok
      && lastResult.version === expectedVersion && lastResult.target === expectedTarget);

    if (matched) {
      lastMatch = lastResult;
      streak++;
      if (streak >= settleReads) {
        return {
          ok: true, attempts: attempt, settled: streak,
          version: lastMatch.version, target: lastMatch.target, deploymentId: lastMatch.deploymentId,
        };
      }
      log(`  attempt ${attempt}: ${expectedVersion} confirmed (${streak}/${settleReads}) — re-reading to confirm the fleet has settled`);
    } else {
      // Losing the streak is the signal, not noise: it means part of the fleet is still on the
      // previous code (PLAN2 F8). Start counting again.
      if (streak > 0) log(`  attempt ${attempt}: the fleet answered with an older version again — settle count reset`);
      streak = 0;
    }

    if (!matched) {
      const seen = lastResult && typeof lastResult === 'object'
        ? `version=${lastResult.version || '(none)'} target=${lastResult.target || '(none)'}`
        : '(no response)';
      log(`  attempt ${attempt}: expected version=${expectedVersion} target=${expectedTarget}, got ${seen}`);
    }

    if (Date.now() - startedAt + intervalSec * 1000 > timeoutSec * 1000) {
      const seen = lastResult && typeof lastResult === 'object'
        ? `version=${lastResult.version || '(none)'} target=${lastResult.target || '(none)'}`
        : '(no response)';
      const why = lastMatch
        ? `it answered with version=${expectedVersion} target=${expectedTarget} but never settled ` +
          `(${settleReads} consecutive agreeing reads required), last seen ${seen}`
        : `expected version=${expectedVersion} target=${expectedTarget}, last seen ${seen}`;
      throw new Error(`assertDeployedVersion timed out after ${attempt} attempts (${timeoutSec}s): ${why}`);
    }
    await sleep(intervalSec * 1000);
  }
}

/**
 * Single, non-polling cmd=version query for `--summary`: "what is deployed right now?" has no
 * propagation to wait out — nothing was just deployed — it needs one honest read or a clear
 * "unreachable".
 *
 * **Never throws, returns null on any failure.** That contract is what makes `--summary` safe to
 * run against a project that has not deployed a cmd=version route yet, which is how every
 * consumer's first adoption goes.
 */
async function queryLiveVersion(deploymentId, options = {}) {
  const { postFn = post } = options;
  try {
    const result = await postFn(execUrl(deploymentId, 'version'), { action: 'version' });
    if (result && result.ok) return { version: result.version, target: result.target };
  } catch {
    // fall through
  }
  return null;
}

/** Generic post-deploy reachability check (#8) — for projects with no cmd=version route yet. */
async function pingWebapp(deploymentId, options = {}) {
  const { postFn = post, cmd = 'version' } = options;
  try {
    const result = await postFn(execUrl(deploymentId, cmd), { action: 'ping' });
    return { reachable: true, jsonResponse: typeof result === 'object', result };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}

module.exports = { assertDeployedVersion, queryLiveVersion, pingWebapp };
