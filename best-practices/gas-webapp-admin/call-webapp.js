#!/usr/bin/env node
/**
 * NUUC-Dispatch web app caller — handles any cmd endpoint (admin, spike, ...),
 * mirroring F3Go30's tools/callWebapp.js.
 *
 * --cmd defaults to "admin". For cmd=admin the admin secret is read from
 * local.settings.json and injected into the payload automatically (except
 * for the bootstrapSecret action itself, which sets that secret).
 *
 * TEST-WEB-APP and PROD-WEB-APP are two deployments of the same script
 * project, so they share one Script Properties store — --env only picks
 * which /exec URL receives the call, not which properties get set.
 * "sit" is accepted as a synonym for "test" (matches F3Go30's env naming).
 *
 * webappTestUrl/webappProdUrl/adminSecret come from local.settings.json
 * (gitignored) — see docs/OPERATIONS.md §Configuration. Never hand-build a
 * curl/fetch call with a hardcoded deployment URL — this tool is the one
 * place that URL lives locally.
 *
 * Usage:
 *   node tools/call-webapp.js bootstrapSecret --body '{"secret":"<32+ char secret>"}'
 *   node tools/call-webapp.js setScriptProperties --body '{"properties":{"GIS_CLIENT_ID":"..."}}'
 *   node tools/call-webapp.js setScriptProperties --env prod --body '{"properties":{"AXIOM_TOKEN":"..."}}'
 *   node tools/call-webapp.js spike_verify_identity --cmd none --body '{"idToken":"<token>"}'
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'local.settings.json');

const ENV_URL_KEY = { test: 'webappTestUrl', sit: 'webappTestUrl', prod: 'webappProdUrl' };

function parseArgs(argv) {
  const args = argv.slice(2);
  const action = args.find(a => !a.startsWith('--'));
  if (!action) {
    console.error('Usage: call-webapp.js <action> [--cmd admin|none] [--env test|sit|prod] [--body \'{"key":"val"}\']');
    process.exit(1);
  }

  const cmdIdx = args.indexOf('--cmd');
  const cmd = cmdIdx !== -1 ? args[cmdIdx + 1] : 'admin';

  const envIdx = args.indexOf('--env');
  const env = envIdx !== -1 ? args[envIdx + 1] : 'test';
  if (!ENV_URL_KEY[env]) {
    console.error(`❌  Unknown env "${env}". Use test, sit, or prod.`);
    process.exit(1);
  }

  const bodyIdx = args.indexOf('--body');
  let extraBody = {};
  if (bodyIdx !== -1) {
    try {
      extraBody = JSON.parse(args[bodyIdx + 1]);
    } catch {
      console.error('❌  --body must be valid JSON.');
      process.exit(1);
    }
  }

  return { action, cmd, env, extraBody };
}

function buildPayload(action, cmd, extraBody, adminSecret) {
  if (cmd === 'admin' && action !== 'bootstrapSecret') {
    return { action, adminSecret, ...extraBody };
  }
  return { action, ...extraBody };
}

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.error(`❌  local.settings.json not found at ${SETTINGS_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return get(res.headers['location']).then(resolve, reject);
        }
        collectBody(res).then(resolve, reject);
      }
    );
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return get(res.headers['location']).then(resolve, reject);
      }
      collectBody(res).then(resolve, reject);
    });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

function collectBody(res) {
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

async function main() {
  const { action, cmd, env, extraBody } = parseArgs(process.argv);
  const settings = loadSettings();

  const webappUrl = settings[ENV_URL_KEY[env]];
  if (!webappUrl) {
    console.error(`❌  ${ENV_URL_KEY[env]} is not set in local.settings.json.`);
    process.exit(1);
  }

  let adminSecret = null;
  if (cmd === 'admin' && action !== 'bootstrapSecret') {
    adminSecret = settings.adminSecret;
    if (!adminSecret) {
      console.error('❌  adminSecret is not set in local.settings.json. Run bootstrapSecret first.');
      process.exit(1);
    }
  }

  const url = cmd === 'none' ? webappUrl : `${webappUrl}?cmd=${cmd}`;
  const payload = buildPayload(action, cmd, extraBody, adminSecret);

  console.error(`→ ${env.toUpperCase()}  cmd=${cmd}  ${action}`);

  const result = await post(url, payload);
  console.log(JSON.stringify(result, null, 2));

  if (result && result.ok === false) process.exit(1);
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, buildPayload, post, loadSettings, ENV_URL_KEY };
