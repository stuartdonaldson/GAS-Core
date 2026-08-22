'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../bin/call-webapp.js');

test('parseArgs finds the action past value-carrying flags', () => {
  assert.equal(cli.parseArgs(['node', 'x', '--env', 'sit', 'listSheets']).action, 'listSheets',
    '"sit" must not be mistaken for the action');
  const parsed = cli.parseArgs(['node', 'x', 'getSheet', '--cmd', 'signup', '--body', '{"a":1}', '--ns', 'smoke-1']);
  assert.equal(parsed.cmd, 'signup');
  assert.deepEqual(parsed.extraBody, { ns: 'smoke-1', a: 1 });
});

test('--body wins over --ns when both set ns', () => {
  const parsed = cli.parseArgs(['node', 'x', 'a', '--ns', 'from-flag', '--body', '{"ns":"from-body"}']);
  assert.equal(parsed.extraBody.ns, 'from-body');
});

test('sit/test and prod/production are accepted as synonyms', () => {
  assert.equal(cli.normalizeEnv('sit', { test: {} }), 'test');
  assert.equal(cli.normalizeEnv('test', { sit: {} }), 'sit');
  assert.equal(cli.normalizeEnv('production', { prod: {} }), 'prod');
  assert.throws(() => cli.normalizeEnv('staging', { sit: {} }), /Unknown env "staging"/);
});

test('the deployment URL is resolved from the LIVE deployment list, not the stored value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-cw-'));
  try {
    const settings = { sitScriptId: 'S1', claspAuth: '/tmp/c.json', sitDeploymentId: 'AKfycOLD' };
    const config = {
      root: dir,
      envMap: { sit: { deploymentIdKey: 'sitDeploymentId', scriptIdKey: 'sitScriptId', anchor: 'TEST-WEB-APP' } },
    };
    // The live list disagrees with the recorded value: the live one must win.
    const exec = () => '- AKfycLIVE @9 - TEST-WEB-APP v1';
    assert.equal(cli.resolveEnvDeploymentId(config, 'sit', settings, { exec }), 'AKfycLIVE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to the recorded ID when the live list is unreachable', () => {
  const config = { root: '/nonexistent', envMap: { sit: { deploymentIdKey: 'sitDeploymentId', scriptIdKey: 'sitScriptId' } } };
  // No clasp auth in settings ⇒ claspEnv throws ⇒ the recorded value is used rather than failing.
  assert.equal(cli.resolveEnvDeploymentId(config, 'sit', { sitScriptId: 'S1', sitDeploymentId: 'AKfycSTORED' }), 'AKfycSTORED');
});

test('an unset/placeholder recorded ID reports which key to populate', () => {
  const config = { root: '/nonexistent', envMap: { sit: { deploymentIdKey: 'sitDeploymentId' } } };
  assert.throws(() => cli.resolveEnvDeploymentId(config, 'sit', {}), /sitDeploymentId is not set in local\.settings\.json/);
  assert.throws(() => cli.resolveEnvDeploymentId(config, 'sit', { sitDeploymentId: '<id>' }), /is not set/);
});

test('the POST→GET redirect is followed, and the method is never pinned through it', () => {
  // GAS answers a POST with a 302 to a GET-only echo endpoint; re-POSTing there returns HTML.
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'webapp.js'), 'utf8');
  const postBody = src.slice(src.indexOf('function post('), src.indexOf('function execUrl('));
  assert.match(postBody, /statusCode === 301 \|\| res\.statusCode === 302/);
  assert.match(postBody, /return get\(res\.headers\.location/, 'the redirect must be followed as GET, not POST');
  // and get() follows a chained redirect too
  const getBody = src.slice(src.indexOf('function get('), src.indexOf('function post('));
  assert.match(getBody, /return get\(res\.headers\.location/);
});
