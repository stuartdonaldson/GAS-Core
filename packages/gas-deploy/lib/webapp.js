'use strict';

/**
 * The one HTTP client for a deployed Apps Script web app (RECOMMENDATION.md §3.3, finding #14).
 *
 * Five projects had five copies of this, whose docstrings already cross-referenced each other as
 * "mirrors X's". They all solved the same four problems, and this file takes the best answer to
 * each:
 *
 *   - **POST→GET redirect.** GAS answers a POST with a 302 to a GET-only echo endpoint. Follow
 *     it as GET; never pin the method through the redirect.
 *   - **Secrets never leak.** A secret goes in the POST *body* only — never in argv, never in the
 *     query string, never printed, not even on failure. Query strings land in access logs and
 *     argv lands in shell history and `ps`; that is the entire reason these tools exist rather
 *     than a curl one-liner.
 *   - **URL derived from the live deployment list**, not a stored value that can go stale
 *     (PracticeMix's caller is the model). See lib/resolvers.js for why "stored" is still the
 *     first thing tried — it is validated against the live list before use.
 *   - **Non-JSON means failure.** A string response means the request never reached the intended
 *     cmd handler — nearly always the deployment-propagation race right after `clasp deploy`,
 *     where a POST lands as a stray GET on doGet and gets HTML back. Callers must be able to
 *     retry on it, so it rejects rather than resolving with garbage.
 */

const https = require('https');

const DEFAULT_TIMEOUT_MS = 120000;

function collectBody_(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(text)); } catch { resolve(text); }
    });
    res.on('error', reject);
  });
}

function get(url, { timeoutMs = DEFAULT_TIMEOUT_MS, agent } = {}) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const req = https.get(url, { agent }, res => {
      if (timedOut) return;
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return get(res.headers.location, { timeoutMs, agent }).then(resolve, reject);
      }
      collectBody_(res).then(resolve, reject);
    });
    req.setTimeout(timeoutMs, () => { timedOut = true; req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

/** POSTs a JSON body to a GAS /exec URL, following the 302 as a GET. */
function post(url, body, { timeoutMs = DEFAULT_TIMEOUT_MS, agent } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    let timedOut = false;

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(bodyStr) },
        agent,
      },
      res => {
        if (timedOut) return;
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return get(res.headers.location, { timeoutMs, agent }).then(resolve, reject);
        }
        collectBody_(res).then(resolve, reject);
      }
    );
    req.setTimeout(timeoutMs, () => { timedOut = true; req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/** Builds the /exec URL for a deployment. `cmd` goes in the query string; secrets never do. */
function execUrl(deploymentId, cmd) {
  if (!deploymentId) throw new Error('execUrl requires a deployment ID');
  return `https://script.google.com/macros/s/${deploymentId}/exec` + (cmd ? `?cmd=${encodeURIComponent(cmd)}` : '');
}

/**
 * Builds the POST payload, injecting the auth field only for gated actions.
 *
 * `authField` is pluggable because the five callers disagreed: `adminSecret` (F3Go30, RCV),
 * `testToken` and `secret` (GActionSheet, PracticeMix), or none. `ungatedActions` are the ones
 * the server answers *before* its secret gate — bootstrapping the secret, and stamping the
 * deployment's own URL — which must never carry a secret we may not have yet.
 */
function buildPayload({ action, extraBody = {}, secret, authField = 'adminSecret', ungatedActions = [] }) {
  const ungated = new Set(ungatedActions);
  if (!authField || ungated.has(action) || !secret) return { action, ...extraBody };
  return { action, [authField]: secret, ...extraBody };
}

/**
 * Redacts an outgoing payload for logging. Nothing in this package prints a payload without
 * passing it through here — a failure path that dumps the request is the classic way a secret
 * ends up in a CI log.
 */
function redact(payload, authField = 'adminSecret') {
  const out = { ...payload };
  for (const key of Object.keys(out)) {
    if (key === authField || /secret|token|password|key$/i.test(key)) out[key] = '<redacted>';
  }
  return out;
}

/**
 * One call against a deployed webapp. Rejects on a non-JSON response so a caller can retry the
 * propagation race; the diagnostic quotes the response, never the request.
 */
async function call(deploymentId, { cmd = 'admin', action, extraBody, secret, authField, ungatedActions, timeoutMs, postFn = post } = {}) {
  const url = execUrl(deploymentId, cmd);
  const payload = buildPayload({ action, extraBody, secret, authField, ungatedActions });
  const result = await postFn(url, payload, { timeoutMs });

  if (typeof result === 'string') {
    throw new Error(
      `Non-JSON response for cmd=${cmd} ${action} (likely a deployment-propagation race — ` +
      `retry usually succeeds). First 200 chars: ${result.slice(0, 200).replace(/\s+/g, ' ')}`
    );
  }
  return result;
}

module.exports = { post, get, execUrl, buildPayload, redact, call };
