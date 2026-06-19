'use strict';

/**
 * examples/demos/libsheets-basic/acceptance.test.js
 *
 * Tier 2 acceptance check for the `libsheets-basic` demo
 * (docs/test-harness-design.md §4.5 — "run before bumping a library's version
 * tag"). It reuses best-practices/gas-acceptance-testing's entry-point-as-call-
 * site discipline: the demo's real doGet() web-app route IS the call-site, hit
 * over HTTP against the bound test Sheet host.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEPLOYMENT IDENTITY FIRST (the critical pattern for a reused host).
 * ─────────────────────────────────────────────────────────────────────────
 * The Sheet host is a REUSED slot: every `push-demo` overwrites it, so an old
 * demo can still be loaded after a failed push or an un-reloaded editor. This
 * check therefore asserts `?action=info` reports the EXPECTED demo + version
 * BEFORE it asserts any behavior — catching "we're testing the wrong code"
 * before it masquerades as a behavior pass/fail. This identity-before-behavior
 * ordering is the one substantive difference from a dedicated-per-demo harness.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two execution modes:
 * ─────────────────────────────────────────────────────────────────────────
 *  1. LIVE (Tier 2 proper): set HARNESS_EXEC_URL to the deployed web-app
 *     `/exec` URL of the host the demo was just pushed to. The suite hits the
 *     real doGet() route. There is no Tier 2 CI yet (design §7.2 — manual,
 *     pre-tag), so this mode is opt-in via the env var and SKIPS otherwise so
 *     it never breaks the Tier 1 `node --test` PR gate.
 *  2. SANDBOX (always-on): with no URL set, the harness wrapper + stamped
 *     deploy-info + demo manifest are loaded into a plain-Node global scope and
 *     the identity/routing logic is asserted directly. This verifies the
 *     ?action=info contract and the identity-first ordering without a live
 *     deployment, so the pattern is regression-protected on every PR.
 *
 * Run (sandbox):  node --test examples/demos/libsheets-basic/acceptance.test.js
 * Run (live):     HARNESS_EXEC_URL='https://script.google.com/.../exec' \
 *                   node --test examples/demos/libsheets-basic/acceptance.test.js
 *
 * GAS gotchas honored (gas-acceptance-testing): the demo function flushes its
 * writes before returning its DemoResult (the synchronous response IS the
 * completion signal — no sleep-then-assert), and a programmatic doGet write
 * runs as the deployer and does NOT fire installable triggers, so this check
 * asserts only on the DemoResult the entry point returns, not on trigger
 * side effects.
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEMO_NAME = 'libsheets-basic';
const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'demo.config.json'), 'utf8')
);
const EXPECTED_VERSION = CONFIG.version;
const EXEC_URL = process.env.HARNESS_EXEC_URL;

/**
 * GET <url> and parse the JSON body. Node 18+ has global fetch.
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function getJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Expected JSON from ${url} but got non-JSON (HTTP ${res.status}). ` +
      `A non-JSON body usually means a stale deployment or an auth/redirect ` +
      `page (gas-acceptance-testing Trade-offs: "deploy discipline is ` +
      `mandatory"). First 200 chars: ${text.slice(0, 200)}`
    );
  }
}

if (EXEC_URL) {
  describe('libsheets-basic — Tier 2 LIVE acceptance (deployed host)', () => {
    test('STEP 1 — deployment identity: the EXPECTED demo + version is loaded', async () => {
      const info = await getJson(EXEC_URL + '?action=info');
      assert.equal(info.status, 'ok', 'action=info must return status:ok');
      assert.equal(
        info.demo, DEMO_NAME,
        `WRONG DEMO loaded in the reused host: expected '${DEMO_NAME}', got ` +
        `'${info.demo}'. The push likely failed or the host was not reloaded. ` +
        `Re-push before trusting any behavior result below.`
      );
      assert.equal(
        info.version, EXPECTED_VERSION,
        `WRONG VERSION loaded: expected '${EXPECTED_VERSION}', got ` +
        `'${info.version}'. A stale revision is deployed.`
      );
      assert.ok(
        info.uses.includes('LibSheets'),
        `Identity must report LibSheets in uses[]; got ${JSON.stringify(info.uses)}`
      );
      assert.ok(info.stamped, 'Identity must be push-stamped, not a fallback');
    });

    test('STEP 2 — behavior: the demo runs and returns DemoResult status:ok', async () => {
      // Identity (STEP 1) already proved the right code is loaded; only now do
      // we trust a behavior result. The demo function flushes before returning,
      // so the synchronous response IS the completion signal.
      const result = await getJson(
        EXEC_URL + '?demo=' + encodeURIComponent('LibSheets: Sheet Management Demo')
      );
      assert.equal(
        result.status, 'ok',
        `Demo did not succeed: ${JSON.stringify(result)}`
      );
      assert.equal(result.feature, 'sheetManagement');
    });
  });
} else {
  describe('libsheets-basic — Tier 2 SANDBOX acceptance (no live URL)', () => {
    let harness;
    let buildDir;

    before(() => {
      // Assemble the exact files push-demo.sh would push, including the
      // generated harness-deploy-info.js identity stamp, into a temp build dir
      // via a dry-run, then load them into one shared global scope (mirroring
      // the GAS V8 single-global-scope model).
      buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libsheets-basic-acc-'));
      execFileSync(
        'bash',
        [
          path.join(REPO_ROOT, 'scripts/push-demo.sh'),
          DEMO_NAME, '--dry-run', '--build-dir', buildDir,
        ],
        { stdio: 'pipe' }
      );

      // Minimal ContentService shim so harness.doGet() can build a JSON
      // response in plain Node (GAS provides this global; Node does not).
      global.ContentService = {
        MimeType: { JSON: 'application/json' },
        createTextOutput(content) {
          return {
            _content: content,
            setMimeType() { return this; },
            getContent() { return this._content; },
          };
        },
      };

      global.HARNESS_DEPLOY_INFO =
        require(path.join(buildDir, 'harness-deploy-info.js')).HARNESS_DEPLOY_INFO;
      global.LIBSHEETS_DEMOS =
        require(path.join(buildDir, 'libSheetsDemo.js')).LIBSHEETS_DEMOS;
      harness = require(path.join(buildDir, 'harness.js'));
    });

    test('STEP 1 — deployment identity reports the EXPECTED demo + version', () => {
      const info = harness.harness_deploymentInfo_.call(global);
      assert.equal(info.status, 'ok');
      assert.equal(info.demo, DEMO_NAME);
      assert.equal(info.version, EXPECTED_VERSION);
      assert.deepEqual(info.uses, ['LibSheets']);
      assert.equal(info.host, 'sheet');
      assert.ok(info.stamped, 'deploy-info stamp must be present');
    });

    test('STEP 1b — identity discovers the demo from the loaded manifest', () => {
      const info = harness.harness_deploymentInfo_.call(global);
      assert.ok(
        info.demos.includes('LibSheets: Sheet Management Demo'),
        `expected the manifest demo to be discoverable; got ${JSON.stringify(info.demos)}`
      );
    });

    test('STEP 2 — doGet(?action=info) returns the identity body as JSON FIRST', () => {
      // Proves the route ordering: action=info is handled before demo dispatch,
      // so an identity probe never accidentally runs a demo.
      const out = harness.doGet.call(global, { parameter: { action: 'info' } });
      const body = JSON.parse(out.getContent ? out.getContent() : out._content);
      assert.equal(body.demo, DEMO_NAME);
      assert.equal(body.version, EXPECTED_VERSION);
    });
  });
}
