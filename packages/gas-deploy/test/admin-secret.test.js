'use strict';

/**
 * GAS-Core-8w0: the admin secret is a declared option, not an omission.
 *   (a) declared + missing value  -> named config error BEFORE any request
 *   (b) cmd=version is unconditionally ungated
 *   (c) default ADMIN_SHARED_SECRET / adminSecret, both pluggable (GActionSheet: WEBAPP_SECRET / testToken)
 */

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = require('../bin/call-webapp.js');
const { buildPayload, resolveAdmin, DEFAULT_ADMIN } = require('../lib/webapp.js');
const { assertAdminSecretPresent_ } = require('../lib/project.js');

const SECRET = 'sit-admin-secret-value-123';

function fakeHttps() {
  const seen = { requests: 0 };
  mock.method(https, 'request', (opts, cb) => {
    seen.requests++;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    req.write = (b) => { seen.body = JSON.parse(b); seen.path = opts.path; };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.resume = () => {};
      cb(res);
      res.emit('data', Buffer.from(JSON.stringify({ ok: true })));
      res.emit('end');
    };
    return req;
  });
  return seen;
}

/** Runs cli.run() against a temp project; `execCalls` proves whether clasp was touched. */
async function runCli({ settings, config = {}, argv }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-admin-'));
  const origErr = console.error; const origLog = console.log;
  console.error = () => {}; console.log = () => {};
  const execCalls = [];
  const savedExit = process.exitCode;
  try {
    fs.writeFileSync(path.join(dir, 'local.settings.json'), JSON.stringify(settings), 'utf8');
    return await cli.run({
      root: dir,
      resolveFromLiveList: false,
      exec: (c) => { execCalls.push(c); return ''; },
      envMap: { sit: { deploymentIdKey: 'sitDeploymentId', secretKey: 'sitAdminSecret' } },
      ...config,
    }, ['node', 'x', ...argv]).then((r) => ({ r, execCalls }), (err) => ({ err, execCalls }));
  } finally {
    console.error = origErr; console.log = origLog;
    process.exitCode = savedExit;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BASE_SETTINGS = { sitDeploymentId: 'AKfycSIT', sitAdminSecret: SECRET };

test('(a) a declared admin secret that is missing is a named config error before any request', async () => {
  const seen = fakeHttps();
  try {
    const { err, execCalls } = await runCli({
      settings: { sitDeploymentId: 'AKfycSIT' },
      argv: ['listSheets', '--env', 'sit'],
    });
    assert.ok(err, 'must reject');
    assert.match(err.message, /Env "sit" declares an admin secret/);
    assert.match(err.message, /sitAdminSecret/, 'names the key');
    assert.match(err.message, /local\.settings\.json/, 'names the file');
    assert.match(err.message, /adminSecret/, 'names the auth field');
    assert.match(err.message, /ADMIN_SHARED_SECRET/, 'names the server-side property');
    assert.equal(seen.requests, 0, 'no request went out');
    assert.deepEqual(execCalls, [], 'not even clasp was invoked');
  } finally { mock.restoreAll(); }
});

test('(a) an empty or placeholder secret value counts as missing', () => {
  const target = { secretKey: 'k' };
  for (const v of ['', '<set me>']) {
    assert.throws(() => assertAdminSecretPresent_(DEFAULT_ADMIN, 'sit', target, { k: v }, { cmd: 'admin', action: 'x' }), /declares an admin secret/);
  }
});

test('(a) a present secret is sent in the body under the default field', async () => {
  const seen = fakeHttps();
  try {
    const { err } = await runCli({ settings: BASE_SETTINGS, argv: ['listSheets', '--env', 'sit'] });
    assert.equal(err, undefined);
    assert.equal(seen.body.adminSecret, SECRET);
    assert.doesNotMatch(seen.path, new RegExp(SECRET));
  } finally { mock.restoreAll(); }
});

test('(a) calls that never carry the secret do not require it: ungated actions and unsecured cmds', async () => {
  const seen = fakeHttps();
  try {
    const noSecret = { sitDeploymentId: 'AKfycSIT' };
    let out = await runCli({ settings: noSecret, config: { ungatedActions: ['bootstrapSecret'] }, argv: ['bootstrapSecret', '--env', 'sit'] });
    assert.equal(out.err, undefined, 'bootstrapSecret runs before any secret exists');
    assert.equal(seen.body.adminSecret, undefined);

    out = await runCli({ settings: noSecret, config: { securedCmds: ['admin'] }, argv: ['checkin', '--cmd', 'signup', '--env', 'sit'] });
    assert.equal(out.err, undefined, 'a cmd outside securedCmds never carried the secret');
  } finally { mock.restoreAll(); }
});

test('(b) cmd=version never carries the secret and never needs it, even with no securedCmds', async () => {
  const seen = fakeHttps();
  try {
    // securedCmds omitted: in 1.x that meant "every cmd is secured", which is how RCV leaked adminSecret.
    let out = await runCli({ settings: BASE_SETTINGS, argv: ['version', '--cmd', 'version', '--env', 'sit'] });
    assert.equal(out.err, undefined);
    assert.equal(seen.body.adminSecret, undefined, 'the secret must not ride on cmd=version');
    assert.equal(JSON.stringify(seen.body).includes(SECRET), false);

    // …and a missing secret is not an error for it.
    out = await runCli({ settings: { sitDeploymentId: 'AKfycSIT' }, argv: ['version', '--cmd', 'version', '--env', 'sit'] });
    assert.equal(out.err, undefined);

    // …even if a project lists version in securedCmds.
    out = await runCli({ settings: BASE_SETTINGS, config: { securedCmds: ['admin', 'version'] }, argv: ['version', '--cmd', 'version', '--env', 'sit'] });
    assert.equal(out.err, undefined);
    assert.equal(seen.body.adminSecret, undefined);
  } finally { mock.restoreAll(); }
});

test('(b) buildPayload treats cmd=version as ungated at the lowest layer too', () => {
  assert.equal(buildPayload({ action: 'x', secret: SECRET, cmd: 'version' }).adminSecret, undefined);
  assert.equal(buildPayload({ action: 'x', secret: SECRET, cmd: 'admin' }).adminSecret, SECRET);
});

test('(c) the default is ADMIN_SHARED_SECRET / adminSecret', () => {
  assert.deepEqual({ ...resolveAdmin({}) }, { secretProperty: 'ADMIN_SHARED_SECRET', authField: 'adminSecret' });
});

test('(c) both are pluggable: GActionSheet uses WEBAPP_SECRET / testToken', async () => {
  assert.deepEqual(resolveAdmin({ admin: { secretProperty: 'WEBAPP_SECRET', authField: 'testToken' } }),
    { secretProperty: 'WEBAPP_SECRET', authField: 'testToken' });
  // the 1.x top-level authField spelling is still honoured
  assert.equal(resolveAdmin({ authField: 'secret' }).authField, 'secret');

  const seen = fakeHttps();
  try {
    const admin = { secretProperty: 'WEBAPP_SECRET', authField: 'testToken' };
    const ok = await runCli({ settings: BASE_SETTINGS, config: { admin }, argv: ['listSheets', '--env', 'sit'] });
    assert.equal(ok.err, undefined);
    assert.equal(seen.body.testToken, SECRET);
    assert.equal(seen.body.adminSecret, undefined);

    const missing = await runCli({ settings: { sitDeploymentId: 'AKfycSIT' }, config: { admin }, argv: ['listSheets', '--env', 'sit'] });
    assert.match(missing.err.message, /testToken/);
    assert.match(missing.err.message, /WEBAPP_SECRET/);
  } finally { mock.restoreAll(); }
});

test('an env with no declared secretKey is not an admin env: nothing is required of it', async () => {
  const seen = fakeHttps();
  try {
    const out = await runCli({
      settings: { sitDeploymentId: 'AKfycSIT' },
      config: { envMap: { sit: { deploymentIdKey: 'sitDeploymentId' } } },
      argv: ['listSheets', '--env', 'sit'],
    });
    assert.equal(out.err, undefined);
    assert.equal(seen.body.adminSecret, undefined);
  } finally { mock.restoreAll(); }
});
