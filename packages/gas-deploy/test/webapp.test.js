'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execUrl, buildPayload, redact, call } = require('../lib/webapp.js');

const SECRET = 'super-secret-value-abc123';

test('execUrl never carries a secret in the query string', () => {
  const url = execUrl('AKfycA', 'admin');
  assert.equal(url, 'https://script.google.com/macros/s/AKfycA/exec?cmd=admin');
  assert.doesNotMatch(url, /secret|token/i);
});

test('the secret travels in the POST body, never the URL', () => {
  let seenUrl, seenBody;
  const postFn = async (url, body) => { seenUrl = url; seenBody = body; return { ok: true }; };
  return call('AKfycA', { cmd: 'admin', action: 'listSheets', secret: SECRET, postFn }).then(() => {
    assert.doesNotMatch(seenUrl, new RegExp(SECRET));
    assert.equal(seenBody.adminSecret, SECRET);
  });
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
  const postFn = async () => '<html>Go30 has moved</html>';
  await assert.rejects(
    () => call('AKfycA', { action: 'listSheets', secret: SECRET, postFn }),
    (err) => {
      assert.match(err.message, /Non-JSON response/);
      assert.match(err.message, /propagation race/, 'says the retryable cause');
      assert.equal(err.message.includes(SECRET), false, 'the failure path must not leak the secret');
      return true;
    }
  );
});

test('execUrl requires a deployment ID', () => {
  assert.throws(() => execUrl(null, 'admin'), /requires a deployment ID/);
});
