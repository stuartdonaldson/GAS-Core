'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { claspEnv, resolveClaspAuthPath, expandHome, parseDeployments, listDeployments, resolveRevision, execWithRetry } = require('../lib/clasp.js');

test('claspEnv always sets clasp_config_auth — the #1 invariant', () => {
  const env = claspEnv({ claspAuth: '~/.clasprc-f3go30.json' }, undefined, { PATH: '/usr/bin' });
  assert.equal(env.clasp_config_auth, path.join(os.homedir(), '.clasprc-f3go30.json'));
  assert.equal(env.PATH, '/usr/bin');
});

test('claspEnv resolves a PER-TARGET auth key — RCV deploys NUUC under another Google account', () => {
  const settings = { claspAuth: '~/.clasprc-rcv.json', nuucAuth: '~/.clasprc-nuuc.json' };
  assert.match(claspEnv(settings, 'nuucAuth').clasp_config_auth, /clasprc-nuuc\.json$/);
  assert.match(claspEnv(settings, 'claspAuth').clasp_config_auth, /clasprc-rcv\.json$/);
});

test('resolveClaspAuthPath refuses to fall back to ~/.clasprc.json', () => {
  assert.throws(() => resolveClaspAuthPath({}, 'claspAuth'), /would silently fall back to ~\/\.clasprc\.json/);
});

test('expandHome only expands a leading tilde', () => {
  assert.equal(expandHome('/abs/path'), '/abs/path');
  assert.equal(expandHome('~/x'), path.join(os.homedir(), '/x'));
  assert.equal(expandHome(undefined), undefined);
});

test('listDeployments refuses an env without clasp_config_auth', () => {
  assert.throws(() => listDeployments({ cwd: '/tmp', env: { PATH: '/usr/bin' }, exec: () => '' }),
    /without clasp_config_auth/);
});

test('listDeployments passes the auth-carrying env straight through to exec', () => {
  let seen;
  listDeployments({ cwd: '/tmp', env: { clasp_config_auth: '/x.json' }, exec: (cmd, opts) => { seen = { cmd, opts }; return ''; } });
  assert.equal(seen.cmd, 'clasp deployments');
  assert.equal(seen.opts.env.clasp_config_auth, '/x.json');
});

test('parseDeployments drops @HEAD and captures id, revision and description', () => {
  const parsed = parseDeployments('- AKfycA @269 - v2.5.0.9 GO30-APP\n- AKfycHEAD @HEAD\n');
  assert.equal(parsed.length, 1);
  assert.deepEqual({ id: parsed[0].id, revision: parsed[0].revision, description: parsed[0].description },
    { id: 'AKfycA', revision: '269', description: 'v2.5.0.9 GO30-APP' });
});

test('parseDeployments tolerates a row with no description', () => {
  assert.equal(parseDeployments('- AKfycA @3').length, 1);
  assert.equal(parseDeployments('- AKfycA @3')[0].description, '');
});

test('resolveRevision parses clasp deploy stdout and never calls the fallback', () => {
  let called = false;
  const rev = resolveRevision('Deployed AKfycA @47.', 'AKfycA', () => { called = true; return ''; });
  assert.equal(rev, '47');
  assert.equal(called, false, 'the fallback thunk must not run when the parse succeeds');
});

test('resolveRevision falls back to the deployment list when the parse misses', () => {
  const rev = resolveRevision('no revision here', 'AKfycA', () => '- AKfycA @48 - desc');
  assert.equal(rev, '48');
});

test('resolveRevision returns null when both strategies miss', () => {
  assert.equal(resolveRevision('', 'AKfycA', () => '- AKfycOTHER @1 - desc'), null);
});

test('execWithRetry retries a transient failure then succeeds', () => {
  let attempts = 0;
  const out = execWithRetry('clasp deploy', {}, {
    attempts: 3, delayMs: 1, log: () => {}, sleepSync: () => {},
    exec: () => { attempts++; if (attempts < 3) throw new Error('edge not ready'); return 'ok'; },
  });
  assert.equal(out, 'ok');
  assert.equal(attempts, 3);
});

test('execWithRetry rethrows after the last attempt', () => {
  assert.throws(() => execWithRetry('clasp deploy', {}, {
    attempts: 2, delayMs: 1, log: () => {}, sleepSync: () => {}, exec: () => { throw new Error('still broken'); },
  }), /still broken/);
});
