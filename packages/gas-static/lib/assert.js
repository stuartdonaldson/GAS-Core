'use strict';

const https = require('https');
const http = require('http');
const path = require('path');
const { readBuildInfo_ } = require('./buildInfo.js');

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
 * The /exec URL this build should be pointed at, read from the same BUILD_INFO the build stamped
 * into the page — i.e. the deployment that was just resolved and deployed. Best-effort: a caller
 * with no `buildInfo` webappUrl mode has nothing to default from, and says so out loud (see the
 * `log` line below) rather than quietly asserting two fields instead of three.
 */
function defaultWebappUrl_(config) {
  const spec = config.webappUrl;
  if (!spec || spec.from !== 'buildInfo' || !spec.file || !config.root) return null;
  try {
    return readBuildInfo_(path.join(config.root, spec.file)).webappUrl || null;
  } catch {
    return null;
  }
}

/**
 * Polls `config.liveUrl(env)` + `version.json` until it reports the exact stamped version —
 * cheap (no HTML regex), CDN-cacheable, and answers both live questions at once: is the new
 * build served, and does it point at the deployment just deployed (`webappUrl` travels in the
 * same file). Subsumes F3Go30's wait-for-static-deploy.js and RCV's smokeTestStaticApi.js step
 * 11. Everything is injected (fetchJson/sleep) so match, mismatch and timeout are all
 * unit-testable with no network call and no wall-clock wait.
 *
 * **All three fields version.json carries are asserted, not just `version`** (PLAN2 F6). The
 * env-agreement guard runs at *build* time only, so a `dist/prod` copied into a `test` dest, or a
 * page published from a stale `dist/`, satisfied the version-only assertion this used to make.
 *
 * The two kinds of disagreement are not the same failure and are not treated the same:
 *   - a **version** mismatch is propagation — the previous build is still being served, so poll;
 *   - an **env** or **webappUrl** mismatch on a page already serving the right version is a wrong
 *     build in the right place. Nothing about it converges, so it fails on the first read.
 *
 * @param {object} [options]
 * @param {string|null} [options.expectedEnv]  default: `envKey`. `null` opts out.
 * @param {string|null} [options.expectedWebappUrl]  default: BUILD_INFO's `webappUrl`, i.e. the
 *   deployment resolved by the deploy that is publishing this build. `null` opts out.
 * @param {number} [options.timeoutSec=300]  a CDN rebuild after push is the slow case, and a first
 *   publish to a new directory is slower still — the measured range is 35 s to ~90 s (PLAN2 F8).
 */
async function assertPublishedBuild(config, envKey, expectedVersion, options = {}) {
  const {
    intervalSec = 5, timeoutSec = 300, fetchJson = fetchJson_, sleep = sleep_, log = () => {},
  } = options;
  const expectedEnv = 'expectedEnv' in options ? options.expectedEnv : envKey;
  const expectedWebappUrl = 'expectedWebappUrl' in options
    ? options.expectedWebappUrl
    : defaultWebappUrl_(config);

  if (expectedWebappUrl == null) {
    log('  note: webappUrl is not being asserted — no buildInfo webappUrl source to compare against');
  }

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
      const wrong = [];
      if (expectedEnv != null && last.env !== expectedEnv) {
        wrong.push(`env="${last.env}", not "${expectedEnv}"`);
      }
      if (expectedWebappUrl != null && last.webappUrl !== expectedWebappUrl) {
        wrong.push(`webappUrl="${last.webappUrl}", not "${expectedWebappUrl}"`);
      }
      if (wrong.length === 0) {
        return { ok: true, attempts: attempt, version: last.version, env: last.env, webappUrl: last.webappUrl };
      }
      // Same shape as the build-time env-agreement guard's message, for the same reason: what is
      // published has to be pointing somewhere real, and this one is not.
      throw new Error(
        `gas-static: ${base} is serving v${last.version} but it is stamped ${wrong.join('; ')} — ` +
        `a build for another env or another deployment was published here. Rebuild and republish ` +
        `env '${envKey}' so the page is published pointing somewhere real.`
      );
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
