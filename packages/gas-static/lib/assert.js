'use strict';

const https = require('https');
const http = require('http');

function sleep_(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function fetchJson_(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(new Error(`invalid JSON from ${url}: ${err.message}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * Polls `config.liveUrl(env)` + `version.json` until it reports the exact stamped version —
 * cheap (no HTML regex), CDN-cacheable, and answers both live questions at once: is the new
 * build served, and does it point at the deployment just deployed (`webappUrl` travels in the
 * same file). Subsumes F3Go30's wait-for-static-deploy.js and RCV's smokeTestStaticApi.js step
 * 11. Everything is injected (fetchJson/sleep) so match, mismatch and timeout are all
 * unit-testable with no network call and no wall-clock wait.
 */
async function assertPublishedBuild(config, envKey, expectedVersion, options = {}) {
  const { intervalSec = 5, timeoutSec = 60, fetchJson = fetchJson_, sleep = sleep_, log = () => {} } = options;
  const base = config.liveUrl(envKey);
  const url = `${base}${base.endsWith('/') ? '' : '/'}version.json?cachebust=${Date.now()}`;
  const startedAt = Date.now();
  let attempt = 0;
  let last = null;

  for (;;) {
    attempt++;
    try {
      last = await fetchJson(url);
    } catch (err) {
      log(`  attempt ${attempt}: fetch failed (${err.message})`);
      last = null;
    }

    if (last && last.version === expectedVersion) {
      return { ok: true, attempts: attempt, version: last.version, env: last.env, webappUrl: last.webappUrl };
    }

    const seen = last ? last.version : '(unknown)';
    log(`  attempt ${attempt}: ${envKey} serving ${seen}, waiting for ${expectedVersion}...`);
    if (Date.now() - startedAt + intervalSec * 1000 > timeoutSec * 1000) {
      throw new Error(
        `assertPublishedBuild timed out after ${attempt} attempts (${timeoutSec}s) waiting for ` +
        `${envKey} to serve v${expectedVersion} — last seen: ${last ? last.version : '(none)'}`
      );
    }
    await sleep(intervalSec * 1000);
  }
}

module.exports = { assertPublishedBuild, fetchJson_ };
