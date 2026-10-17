'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildEnv } = require('../lib/build.js');

function makeProject_() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-'));
  fs.mkdirSync(path.join(root, 'static-pages', 'src', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'static-pages', 'src', 'index.html'),
    'var STATIC_BUILD_VERSION_ = null;\nvar STATIC_WEBAPP_URL_ = null;\n<div>hi</div>\n'
  );
  fs.writeFileSync(path.join(root, 'static-pages', 'src', 'assets', 'favicon.ico'), 'ICO');
  return root;
}

function writeBuildInfo_(root, { version = '1.0.0', webappUrl = 'https://script.google.com/macros/s/AKfy/exec', target = 'TEST', env = 'test' } = {}) {
  // `target` is the deploy-contract field the guard reads; `env` is the lowercase logging
  // discriminator it must NOT read (GAS-Core-3v2).
  fs.writeFileSync(
    path.join(root, 'src', 'Version.js'),
    `const BUILD_INFO = { "version": "${version}", "webappUrl": "${webappUrl}", "target": "${target}", "env": "${env}" };\n`
  );
}

function baseConfig_(root) {
  return {
    root,
    srcDir: 'static-pages/src',
    distDir: 'static-pages/dist',
    webappUrl: { from: 'buildInfo', file: 'src/Version.js' },
    envs: {
      sit: { deployTarget: 'TEST', repoKey: 'staticRepoPath', dest: 'pub/app-sit', label: 'SIT' },
      prod: { deployTarget: 'PRODUCTION', repoKey: 'staticRepoPath', dest: 'pub/app', label: 'PROD' },
    },
  };
}

test('missing placeholder throws and writes nothing', () => {
  const root = makeProject_();
  fs.writeFileSync(path.join(root, 'static-pages', 'src', 'index.html'), 'var STATIC_BUILD_VERSION_ = null;\n<div>no webapp placeholder</div>\n');
  writeBuildInfo_(root, { target: 'TEST' });
  const config = baseConfig_(root);

  assert.throws(() => buildEnv(config, 'sit'), /expected placeholder not found: var STATIC_WEBAPP_URL_ = null;/);
  assert.equal(fs.existsSync(path.join(root, 'static-pages', 'dist')), false, 'a failed build must not create dist/');
});

test('env-agreement mismatch throws and writes nothing', () => {
  const root = makeProject_();
  writeBuildInfo_(root, { target: 'PRODUCTION', env: 'prod' }); // Version.js stamped for prod, building sit
  const config = baseConfig_(root);

  assert.throws(() => buildEnv(config, 'sit'), /stamped for target="PRODUCTION", not "TEST"/);
  assert.equal(fs.existsSync(path.join(root, 'static-pages', 'dist')), false, 'an env-agreement mismatch must write nothing');
});

test('missing webappUrl in BUILD_INFO throws', () => {
  const root = makeProject_();
  writeBuildInfo_(root, { target: 'TEST', webappUrl: '' });
  const config = baseConfig_(root);

  assert.throws(() => buildEnv(config, 'sit'), /has no webappUrl stamped yet/);
});

test('a matching build stamps both placeholders, copies assets, and writes version.json', () => {
  const root = makeProject_();
  writeBuildInfo_(root, { version: '2.5.0.9', webappUrl: 'https://script.google.com/macros/s/AKfycbx/exec', target: 'TEST' });
  const config = baseConfig_(root);

  const result = buildEnv(config, 'sit');

  const out = fs.readFileSync(path.join(root, 'static-pages', 'dist', 'sit', 'index.html'), 'utf8');
  assert.match(out, /var STATIC_BUILD_VERSION_ = "2\.5\.0\.9";/);
  assert.match(out, /var STATIC_WEBAPP_URL_ = "https:\/\/script\.google\.com\/macros\/s\/AKfycbx\/exec";/);
  assert.equal(fs.existsSync(path.join(root, 'static-pages', 'dist', 'sit', 'assets', 'favicon.ico')), true);

  const versionJson = JSON.parse(fs.readFileSync(path.join(root, 'static-pages', 'dist', 'sit', 'version.json'), 'utf8'));
  assert.equal(versionJson.version, '2.5.0.9');
  assert.equal(versionJson.env, 'sit');
  assert.equal(versionJson.webappUrl, 'https://script.google.com/macros/s/AKfycbx/exec');
  assert.ok(versionJson.builtAt);

  assert.equal(result.version, '2.5.0.9');
  assert.equal(result.env, 'sit');
});

test('extra placeholders are stamped as raw tokens, not JS-declaration-wrapped', () => {
  const root = makeProject_();
  fs.writeFileSync(
    path.join(root, 'static-pages', 'src', 'index.html'),
    'var STATIC_BUILD_VERSION_ = null;\nvar STATIC_WEBAPP_URL_ = null;\n<html data-theme="STATIC_THEME_">\n'
  );
  writeBuildInfo_(root, { target: 'TEST' });
  const config = { ...baseConfig_(root), placeholders: { STATIC_THEME_: (ctx) => (ctx.env === 'sit' ? 'f3' : 'legacy') } };

  buildEnv(config, 'sit');

  const out = fs.readFileSync(path.join(root, 'static-pages', 'dist', 'sit', 'index.html'), 'utf8');
  assert.match(out, /data-theme="f3"/);
});

test('GAS-Core-3v2: the guard defaults to BUILD_INFO.target, not BUILD_INFO.env', () => {
  const root = makeProject_();
  // env says "prod" (logging vocabulary) while target says TEST: the guard must follow target.
  writeBuildInfo_(root, { target: 'TEST', env: 'prod' });
  assert.doesNotThrow(() => buildEnv(baseConfig_(root), 'sit'));
});

test('GAS-Core-3v2: a lowercase logging env that equals deployTarget cannot satisfy the guard', () => {
  const root = makeProject_();
  writeBuildInfo_(root, { target: 'PRODUCTION', env: 'TEST' });
  assert.throws(() => buildEnv(baseConfig_(root), 'sit'), /stamped for target="PRODUCTION", not "TEST"/);
});

test('GAS-Core-3v2: a BUILD_INFO with no target stamped fails the guard, naming the empty target', () => {
  const root = makeProject_();
  fs.writeFileSync(
    path.join(root, 'src', 'Version.js'),
    'const BUILD_INFO = { "version": "1.0.0", "webappUrl": "https://x/exec", "env": "TEST" };\n'
  );
  assert.throws(() => buildEnv(baseConfig_(root), 'sit'), /stamped for target="", not "TEST"/);
  assert.equal(fs.existsSync(path.join(root, 'static-pages', 'dist')), false);
});

test('GAS-Core-3v2: envField is still honoured as an explicit override', () => {
  const root = makeProject_();
  writeBuildInfo_(root, { target: 'PRODUCTION', env: 'TEST' });
  const config = baseConfig_(root);
  config.webappUrl.envField = 'env';
  assert.doesNotThrow(() => buildEnv(config, 'sit'));
});
