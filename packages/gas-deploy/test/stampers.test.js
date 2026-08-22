'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { constStamper, buildInfoStamper } = require('../lib/stampers.js');
const { computeVersion, bumpPatchVersion, bumpBuildNumber, resetBuildNumber, replaceConst } = require('../lib/version.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-test-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('constStamper rewrites the three consts and preserves surrounding comments', () => {
  withTempDir((root) => {
    const file = 'version.js';
    fs.writeFileSync(path.join(root, file), [
      '/** do not hand-edit */',
      "const APP_VERSION       = '0.0.0';",
      "const APP_VERSION_DATE  = '2000-01-01T00:00:00.000Z';",
      "const APP_DEPLOY_TARGET = 'SIT';",
      "const APP_AUTHOR        = 'Someone';",
      '',
    ].join('\n'), 'utf8');

    const stamp = constStamper({ file });
    const out = stamp({ root, label: 'PROD', version: '1.2.3', now: '2026-08-22T00:00:00.000Z', log: () => {} });

    assert.deepEqual(out, { version: '1.2.3', now: '2026-08-22T00:00:00.000Z', label: 'PROD' });
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(src, /const APP_VERSION\s+= '1\.2\.3';/);
    assert.match(src, /const APP_DEPLOY_TARGET = 'PROD';/);
    assert.match(src, /do not hand-edit/, 'comments survive');
    assert.match(src, /APP_AUTHOR\s+= 'Someone'/, 'unrelated consts survive');
  });
});

test('constStamper appends a const that is missing rather than failing', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'v.js'), "const APP_VERSION = '0.0.0';\n", 'utf8');
    constStamper({ file: 'v.js' })({ root, label: 'TEST', version: '9.9.9', now: 'NOW', log: () => {} });
    assert.match(fs.readFileSync(path.join(root, 'v.js'), 'utf8'), /const APP_DEPLOY_TARGET\s+= 'TEST';/);
  });
});

test('buildInfoStamper rewrites the whole BUILD_INFO object literal', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'Version.js'), [
      '// generated',
      'const BUILD_INFO = {',
      '  "version": "0.0.1",',
      '  "date": "old",',
      '  "target": "TEST"',
      '};',
      '',
      'function other_() { return 1; }',
    ].join('\n'), 'utf8');

    buildInfoStamper({ file: 'Version.js' })({ root, label: 'PROD', version: '2.0.0', now: 'NOW', webAppUrl: 'https://x/exec', log: () => {} });

    const src = fs.readFileSync(path.join(root, 'Version.js'), 'utf8');
    const literal = JSON.parse(src.match(/const BUILD_INFO = (\{[\s\S]*?\n\});/)[1]);
    assert.deepEqual(literal, { version: '2.0.0', date: 'NOW', target: 'PROD', webAppUrl: 'https://x/exec' });
    assert.match(src, /function other_/, 'the rest of the file survives');
  });
});

test('buildInfoStamper works on an html-hosted literal and appends when absent', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'version.html'), '<script>\nconst BUILD_INFO = {\n  "version": "0"\n};\n</script>\n', 'utf8');
    buildInfoStamper({ file: 'version.html' })({ root, label: 'TEST', version: '3.1.4', now: 'NOW', log: () => {} });
    assert.match(fs.readFileSync(path.join(root, 'version.html'), 'utf8'), /"version": "3\.1\.4"/);

    fs.writeFileSync(path.join(root, 'empty.js'), '// nothing here\n', 'utf8');
    buildInfoStamper({ file: 'empty.js' })({ root, label: 'TEST', version: '1.0.0', now: 'NOW', log: () => {} });
    assert.match(fs.readFileSync(path.join(root, 'empty.js'), 'utf8'), /const BUILD_INFO = \{/);
  });
});

test('stampers require a file', () => {
  assert.throws(() => constStamper(), /requires a \{ file \}/);
  assert.throws(() => buildInfoStamper({}), /requires a \{ file \}/);
});

test('computeVersion: build counter for test targets, patch+reset for stable ones', () => {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '0.1.6', build: 1 }), 'utf8');

    assert.equal(computeVersion(pkgPath, { counter: 'build', log: () => {} }), '0.1.6.2');
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version, '0.1.6', 'version untouched by a build bump');

    assert.equal(computeVersion(pkgPath, { counter: 'version', log: () => {} }), '0.1.7');
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).build, 0, 'build reset by a stable deploy');
  });
});

test('computeVersion honours skipBump (the release:* --skip-bump handoff)', () => {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '0.1.6', build: 4 }), 'utf8');
    assert.equal(computeVersion(pkgPath, { counter: 'build', skipBump: true, log: () => {} }), '0.1.6.4');
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).build, 4, 'counter untouched');
  });
});

test('bump helpers are idempotent across calls and leave the other counter alone', () => {
  withTempDir((dir) => {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'x', version: '0.0.1', build: 7 }), 'utf8');
    bumpPatchVersion(pkgPath); bumpPatchVersion(pkgPath);
    assert.equal(bumpPatchVersion(pkgPath), '0.0.4');
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).build, 7);
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name, 'x');
    bumpBuildNumber(pkgPath);
    assert.equal(bumpBuildNumber(pkgPath), 9);
    resetBuildNumber(pkgPath);
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).build, 0);
  });
});

test('replaceConst rewrites in place, appends when missing', () => {
  assert.match(replaceConst("const A = '1';\n", 'A', "'2'"), /const A = '2';/);
  assert.match(replaceConst("const A = '1';\n", 'B', "'x'"), /const B\s+= 'x';/);
});
