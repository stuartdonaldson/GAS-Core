'use strict';
const { test, mock } = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const assert = require('node:assert/strict');
const { execUrl, buildPayload, redact, call } = require('../lib/webapp.js');

const SECRET = 'super-secret-value-abc123';

/**
 * call() has no transport override (GAS-Core-e5z), so tests stand in for the network one layer
 * down: https.request is replaced with a fake that records the request and answers with `reply`.
 */
function fakeHttps(reply) {
  const seen = {};
  mock.method(https, 'request', (opts, cb) => {
    seen.opts = opts;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    req.write = (b) => { seen.body = JSON.parse(b); };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.resume = () => {};
      cb(res);
      res.emit('data', Buffer.from(typeof reply === 'string' ? reply : JSON.stringify(reply)));
      res.emit('end');
    };
    return req;
  });
  return seen;
}

test('execUrl never carries a secret in the query string', () => {
  const url = execUrl('AKfycA', 'admin');
  assert.equal(url, 'https://script.google.com/macros/s/AKfycA/exec?cmd=admin');
  assert.doesNotMatch(url, /secret|token/i);
});

test('the secret travels in the POST body, never the URL', () => {
  const seen = fakeHttps({ ok: true });
  return call('AKfycA', { cmd: 'admin', action: 'listSheets', secret: SECRET }).then(() => {
    assert.doesNotMatch(seen.opts.path, new RegExp(SECRET));
    assert.equal(seen.body.adminSecret, SECRET);
  }).finally(() => mock.restoreAll());
});

test('call() refuses a postFn option (removed in 2.0.0) before any request', async () => {
  const seen = fakeHttps({ ok: true });
  let invoked = false;
  try {
    await assert.rejects(
      call('AKfycA', { action: 'listSheets', secret: SECRET, postFn: async () => { invoked = true; return { ok: true }; } }),
      /postFn transport override was removed in 2\.0\.0/
    );
    assert.equal(invoked, false);
    assert.equal(seen.body, undefined, 'no request was sent');
  } finally { mock.restoreAll(); }
});

test('buildPayload omits the auth field for ungated actions', () => {
  const gated = buildPayload({ action: 'listSheets', secret: SECRET, ungatedActions: ['bootstrapSecret', 'setWebappUrl'] });
  assert.equal(gated.adminSecret, SECRET);

  for (const action of ['bootstrapSecret', 'setWebappUrl']) {
    const payload = buildPayload({ action, secret: SECRET, ungatedActions: ['bootstrapSecret', 'setWebappUrl'] });
    assert.equal(JSON.stringify(payload).includes(SECRET), false, `${action} must not carry a secret we may not have yet`);
  }
});

test('buildPayload supports a pluggable auth field name', () => {
  assert.equal(buildPayload({ action: 'x', secret: SECRET, authField: 'testToken' }).testToken, SECRET);
  assert.equal(buildPayload({ action: 'x', secret: SECRET, authField: null }).adminSecret, undefined);
});

test('redact hides the auth field and anything secret-shaped', () => {
  const out = redact({ action: 'x', adminSecret: SECRET, apiToken: 'tok', password: 'pw', sheetName: 'Tracker' });
  assert.equal(out.adminSecret, '<redacted>');
  assert.equal(out.apiToken, '<redacted>');
  assert.equal(out.password, '<redacted>');
  assert.equal(out.sheetName, 'Tracker', 'non-secret fields survive so the log is still useful');
  assert.equal(JSON.stringify(out).includes(SECRET), false);
});

test('a non-JSON response fails loudly and quotes the RESPONSE, never the request', async () => {
  fakeHttps('<html>Go30 has moved</html>');
  await assert.rejects(
    () => call('AKfycA', { action: 'listSheets', secret: SECRET }),
    (err) => {
      assert.match(err.message, /Non-JSON response/);
      assert.match(err.message, /propagation race/, 'says the retryable cause');
      assert.equal(err.message.includes(SECRET), false, 'the failure path must not leak the secret');
      return true;
    }
  ).finally(() => mock.restoreAll());
});

test('execUrl requires a deployment ID', () => {
  assert.throws(() => execUrl(null, 'admin'), /requires a deployment ID/);
});
