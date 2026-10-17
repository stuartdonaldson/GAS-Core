'use strict';

/**
 * Tier 1 (plain Node) tests for libIdentity.js. GAS services are shimmed in a vm
 * sandbox; tokens are minted here with node:crypto (the issuer is not part of this
 * library). Verify-side fail-closed matrix ported from
 * NUUC-Dispatch/test/assertion.test.js (AC5 + ND-egp), plus declared-posture tests.
 *
 * Run: node --test libs/LibIdentity/test/libIdentity.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const AUD = 'gactionsheet';
const KID = 'ASSERTION_KEY_GACTIONSHEET_1';
const SECRET = 'dGVzdC1zZWNyZXQtMzItYnl0ZXMtd29ydGgtb2YtcmFuZG9t';
const NOW = 1753400000;
const TTL = 3888000;
const CLAIMS = { sub: '108234567890', email: 'visitor@example.com', email_verified: true };

const TARGETS = [
  { aud: AUD, kid: KID, secret: SECRET },
  { aud: 'nuuts-shell-test', kid: 'ASSERTION_KEY_NUUTS_SHELL_TEST_1', secret: 'shell-test-secret-value-aaaaaaaaaaaa' },
  { aud: 'nuuts-shell', kid: 'ASSERTION_KEY_NUUTS_SHELL_1', secret: 'shell-prod-secret-value-bbbbbbbbbbbbb' },
  { aud: 'practicemix-test', kid: 'ASSERTION_KEY_PRACTICEMIX_TEST_1', secret: 'pmix-test-secret-value-cccccccccccccc' },
  { aud: 'practicemix', kid: 'ASSERTION_KEY_PRACTICEMIX_1', secret: 'pmix-prod-secret-value-dddddddddddddd' },
];
const REGISTRY = Object.fromEntries(TARGETS.map((t) => [t.aud, t.kid]));

// ---- harness ----

function toSignedBytes(buf) { return Array.from(buf, (b) => (b > 127 ? b - 256 : b)); }
function toBuffer(bytes) { return Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))); }

function makeSandbox() {
  const scriptProps = new Map();
  const reads = [];
  const sandbox = {
    Utilities: {
      computeHmacSha256Signature(value, key) {
        if (typeof value !== 'string' || typeof key !== 'string') throw new Error('shim: (string,string) only');
        return toSignedBytes(crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(Buffer.from(value, 'utf8')).digest());
      },
      base64EncodeWebSafe(data) {
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuffer(data);
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); // GAS keeps '='
      },
      base64DecodeWebSafe(str) {
        if (!/^[A-Za-z0-9\-_=]*$/.test(str)) throw new Error('bad web-safe base64');
        return toSignedBytes(Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      },
      newBlob(bytes) { const buf = toBuffer(bytes); return { getDataAsString: () => buf.toString('utf8') }; },
    },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: (k) => { reads.push(k); return scriptProps.has(k) ? scriptProps.get(k) : null; } };
      },
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'libIdentity.js'), 'utf8'), ctx, { filename: 'libIdentity.js' });
  for (const t of TARGETS) scriptProps.set(t.kid, t.secret);
  return { sandbox, scriptProps, reads };
}

function b64u(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hmac(input, key) {
  return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(input).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mint({ kid = KID, secret = SECRET, aud = AUD, alg = 'HS256', claims = CLAIMS, iss = 'nuuc-dispatch', iat = NOW, exp = NOW + TTL, payload } = {}) {
  const header = b64u({ alg, typ: 'JWT', kid });
  const body = b64u(payload || { iss, sub: claims.sub, email: claims.email, email_verified: claims.email_verified, aud, iat, exp });
  return `${header}.${body}.${hmac(`${header}.${body}`, secret)}`;
}
function verify(h, token, aud = AUD, extra = {}) {
  return h.sandbox.LibIdentity_verify(token, aud, { targets: REGISTRY, failure: 'deny', nowSeconds: NOW + 10, ...extra });
}

// ---- ported verify-side fail-closed matrix (AC5) ----

test('accepts a valid unexpired assertion and returns identity claims', () => {
  const h = makeSandbox();
  const res = verify(h, mint(), AUD, { nowSeconds: NOW + 1800 });
  assert.equal(res.valid, true);
  assert.equal(res.sub, CLAIMS.sub);
  assert.equal(res.email, CLAIMS.email);
  assert.equal(res.email_verified, true);
});

test('rejects a tampered signature', () => {
  const h = makeSandbox();
  const [hd, p, sig] = mint().split('.');
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.equal(verify(h, `${hd}.${p}.${flipped}`).valid, false);
});

test('rejects a tampered payload', () => {
  const h = makeSandbox();
  const [hd, p, sig] = mint().split('.');
  const orig = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.equal(verify(h, `${hd}.${b64u({ ...orig, sub: 'attacker' })}.${sig}`).valid, false);
});

test('rejects a wrong expected aud', () => {
  const h = makeSandbox();
  assert.equal(verify(h, mint(), 'other-app').valid, false);
});

test('rejects an expired assertion, accepts inside the TTL boundary', () => {
  const h = makeSandbox();
  const t = mint();
  assert.equal(verify(h, t, AUD, { nowSeconds: NOW + TTL + 1 }).valid, false);
  assert.equal(verify(h, t, AUD, { nowSeconds: NOW + TTL - 1 }).valid, true);
});

test('rejects an unknown kid even when signed with a correct HMAC', () => {
  const h = makeSandbox();
  assert.equal(verify(h, mint({ kid: 'ASSERTION_KEY_NOPE_9' })).valid, false);
});

test('rejects alg != HS256 even with a correct HMAC', () => {
  const h = makeSandbox();
  for (const alg of ['none', 'HS512', 'RS256']) {
    const res = verify(h, mint({ alg }));
    assert.equal(res.valid, false, `alg ${alg}`);
    assert.equal(res.reason, 'bad_alg');
  }
});

test('fails closed on malformed input without throwing', () => {
  const h = makeSandbox();
  for (const junk of ['', 'garbage', 'a.b', 'a.b.c.d', '!!.@@.##', null, undefined, 42]) {
    let res;
    assert.doesNotThrow(() => { res = verify(h, junk); }, `must not throw on ${String(junk)}`);
    assert.equal(res.valid, false, `must reject ${String(junk)}`);
  }
});

test('each target token verifies with its own aud and fails with another aud', () => {
  const h = makeSandbox();
  for (const t of TARGETS) {
    const other = TARGETS.find((x) => x !== t);
    const token = mint({ aud: t.aud, kid: t.kid, secret: t.secret });
    const ok = verify(h, token, t.aud);
    assert.equal(ok.valid, true, t.aud);
    assert.equal(ok.sub, CLAIMS.sub);
    assert.equal(verify(h, token, other.aud).valid, false);
  }
});

test('kid WEBAPP_URL signed with the WEBAPP_URL value -> bad_kid, property never read', () => {
  const h = makeSandbox();
  const url = 'https://script.google.com/macros/s/AKfycbxEXAMPLE/exec';
  h.scriptProps.set('WEBAPP_URL', url);
  h.reads.length = 0;
  for (const t of TARGETS) {
    const res = verify(h, mint({ kid: 'WEBAPP_URL', secret: url, aud: t.aud }), t.aud);
    assert.equal(res.valid, false);
    assert.equal(res.reason, 'bad_kid', t.aud);
  }
  assert.equal(h.reads.includes('WEBAPP_URL'), false);
  assert.deepEqual(h.reads, [], 'no Script Property read before the kid check');
});

test('token re-labelled with another target kid (validly signed) -> bad_kid, property not read', () => {
  const h = makeSandbox();
  const [a, b] = [TARGETS[1], TARGETS[2]];
  h.reads.length = 0;
  for (const secret of [b.secret, a.secret]) {
    const res = verify(h, mint({ kid: b.kid, secret, aud: a.aud }), a.aud);
    assert.equal(res.valid, false);
    assert.equal(res.reason, 'bad_kid');
  }
  assert.deepEqual(h.reads, []);
});

test('legacy gactionsheet token relabelled with a Shell kid -> bad_kid', () => {
  const h = makeSandbox();
  const res = verify(h, mint({ kid: TARGETS[1].kid, secret: TARGETS[1].secret, aud: AUD }));
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'bad_kid');
});

test('unknown or inherited-property expectedAud -> unknown_aud with no property read', () => {
  const h = makeSandbox();
  const token = mint({ aud: TARGETS[1].aud, kid: TARGETS[1].kid, secret: TARGETS[1].secret });
  h.reads.length = 0;
  for (const aud of ['not-a-registered-app', 'toString', 'constructor', '__proto__', '', undefined, null]) {
    const res = h.sandbox.LibIdentity_verify(token, aud, { targets: REGISTRY, failure: 'deny', nowSeconds: NOW + 10 });
    assert.equal(res.valid, false, String(aud));
    assert.equal(res.reason, 'unknown_aud', String(aud));
  }
  assert.deepEqual(h.reads, []);
});

test('own-kid token with property deleted -> unknown_kid', () => {
  const h = makeSandbox();
  const t = TARGETS[2];
  const token = mint({ aud: t.aud, kid: t.kid, secret: t.secret });
  h.scriptProps.delete(t.kid);
  const res = verify(h, token, t.aud);
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'unknown_kid');
});

test('reads only its own pinned kid for a valid token (positive control)', () => {
  const h = makeSandbox();
  h.reads.length = 0;
  assert.equal(verify(h, mint()).valid, true);
  assert.deepEqual(h.reads, [KID]);
});

// ---- additions beyond the reference ----

test('rejects wrong issuer, and honours a declared issuer', () => {
  const h = makeSandbox();
  const res = verify(h, mint({ iss: 'someone-else' }));
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'bad_iss');
  assert.equal(verify(h, mint({ iss: 'someone-else' }), AUD, { issuer: 'someone-else' }).valid, true);
});

test('rejects missing or non-numeric exp, and missing sub/email', () => {
  const h = makeSandbox();
  const base = { iss: 'nuuc-dispatch', sub: 's', email: 'e@x', email_verified: true, aud: AUD, iat: NOW };
  assert.equal(verify(h, mint({ payload: base })).reason, 'expired');
  assert.equal(verify(h, mint({ payload: { ...base, exp: String(NOW + 100) } })).reason, 'expired');
  assert.equal(verify(h, mint({ payload: { ...base, exp: NOW + 100, sub: '' } })).reason, 'missing_identity');
  assert.equal(verify(h, mint({ payload: { ...base, exp: NOW + 100, email: undefined } })).reason, 'missing_identity');
  assert.equal(verify(h, mint({ payload: { ...base, exp: NOW + 100, sub: 42 } })).reason, 'missing_identity');
});

test('email_verified is only true for a literal true', () => {
  const h = makeSandbox();
  const res = verify(h, mint({ claims: { ...CLAIMS, email_verified: 'true' } }));
  assert.equal(res.valid, true);
  assert.equal(res.email_verified, false);
});

test('an unexpected runtime error during verification denies (verify_error)', () => {
  const h = makeSandbox();
  const token = mint();
  h.sandbox.Utilities.computeHmacSha256Signature = () => { throw new Error('service down'); };
  const res = verify(h, token);
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'verify_error');
});

// ---- declared failure posture ----

test("failure:'throw' throws LibIdentityError with .reason on every rejection and returns on success", () => {
  const h = makeSandbox();
  const opts = { targets: REGISTRY, failure: 'throw', nowSeconds: NOW + 10 };
  assert.equal(h.sandbox.LibIdentity_verify(mint(), AUD, opts).valid, true);
  for (const [token, reason] of [[mint({ alg: 'none' }), 'bad_alg'], ['garbage', 'malformed'], [mint({ kid: 'X' }), 'bad_kid']]) {
    assert.throws(() => h.sandbox.LibIdentity_verify(token, AUD, opts), (e) => e.name === 'LibIdentityError' && e.reason === reason);
  }
});

test('undeclared, misspelled or permissive posture is a config error, never a pass', () => {
  const h = makeSandbox();
  const token = mint();
  for (const failure of [undefined, null, '', 'allow', 'open', 'DENY', true, false, 0]) {
    assert.throws(
      () => h.sandbox.LibIdentity_verify(token, AUD, { targets: REGISTRY, failure, nowSeconds: NOW + 10 }),
      (e) => e.name === 'LibIdentityError' && e.reason === 'bad_config',
      `failure=${String(failure)}`
    );
  }
  assert.throws(() => h.sandbox.LibIdentity_verify(token, AUD), (e) => e.reason === 'bad_config');
  assert.throws(() => h.sandbox.LibIdentity_verify(token, AUD, null), (e) => e.reason === 'bad_config');
  assert.throws(() => h.sandbox.LibIdentity_verify(token, AUD, { failure: 'deny' }), (e) => e.reason === 'bad_config');
});

test("failure:'deny' never throws, even on hostile input", () => {
  const h = makeSandbox();
  for (const junk of ['', null, undefined, {}, [], 'a.b.c', '....']) {
    assert.doesNotThrow(() => verify(h, junk));
    assert.equal(verify(h, junk).valid, false);
  }
});

test('module export exposes only the verifier', () => {
  assert.deepEqual(Object.keys(require('../libIdentity.js')), ['LibIdentity_verify']);
});
