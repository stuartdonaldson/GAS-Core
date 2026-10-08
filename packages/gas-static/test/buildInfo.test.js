'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readBuildInfo_ } = require('../lib/buildInfo.js');

/** Same fixture shape as build.test.js: a real file on disk, because the reader takes a path. */
function writeVersionFile_(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-bi-'));
  const filePath = path.join(root, 'Version.js');
  fs.writeFileSync(filePath, contents);
  return filePath;
}

const LITERAL = `const BUILD_INFO = {
  "version": "1.6.7.10",
  "buildDate": "2026-08-24T05:58:07.101Z",
  "env": "TEST",
  "webappUrl": "https://script.google.com/macros/s/AKfycbx/exec"
};
`;

test('returns every field found in the literal, buildDate included', () => {
  const info = readBuildInfo_(writeVersionFile_(LITERAL));

  assert.equal(info.version, '1.6.7.10');
  assert.equal(info.env, 'TEST');
  assert.equal(info.webappUrl, 'https://script.google.com/macros/s/AKfycbx/exec');
  assert.equal(info.buildDate, '2026-08-24T05:58:07.101Z',
    'buildDate is why PracticeMix wrote a duplicate regex — the reader must return it');
});

test('a decoy field ABOVE the literal cannot win', () => {
  // The pre-fix regex matched the first `"version": "…"` anywhere in the file, so a comment or a
  // second literal above BUILD_INFO silently supplied the answer (PLAN2 F13).
  const info = readBuildInfo_(writeVersionFile_(
    '/** Example: { "version": "0.0.0-from-a-comment", "env": "prod" } */\n' +
    'const PREVIOUS_BUILD = { "version": "9.9.9", "env": "production", "webappUrl": "https://wrong/exec" };\n' +
    LITERAL
  ));

  assert.equal(info.version, '1.6.7.10');
  assert.equal(info.env, 'TEST');
  assert.equal(info.webappUrl, 'https://script.google.com/macros/s/AKfycbx/exec');
});

test('a decoy field BELOW the literal cannot win either', () => {
  const info = readBuildInfo_(writeVersionFile_(
    LITERAL +
    'const LEGACY_INFO = { "version": "9.9.9", "env": "production" };\n'
  ));

  assert.equal(info.version, '1.6.7.10');
  assert.equal(info.env, 'TEST');
});

test('a bare-key literal (pre-package copies) still parses', () => {
  const info = readBuildInfo_(writeVersionFile_(
    'var BUILD_INFO = { version: "0.2.2.8", target: "TEST", env: "test" };\n'
  ));

  assert.equal(info.version, '0.2.2.8');
  assert.equal(info.env, 'test');
  assert.equal(info.target, 'TEST', 'GActionSheet stamps `target` alongside `env`');
});

test('a literal followed by functions that reference it stops at the closing brace', () => {
  // GActionSheet's Version.js shape: BUILD_INFO, then getWebAppUrl() and friends.
  const info = readBuildInfo_(writeVersionFile_(
    'var BUILD_INFO = { "version": "0.2.2.8", "env": "test" };\n' +
    'function getWebAppUrl() { return BUILD_INFO.webappUrl; }\n' +
    'var OVERRIDE = { "version": "0.0.0" };\n'
  ));

  assert.equal(info.version, '0.2.2.8');
  assert.equal(info.webappUrl, '', 'absent in the literal — not inherited from anywhere else');
});

test('an empty field reads as empty, not as missing', () => {
  const info = readBuildInfo_(writeVersionFile_(
    'const BUILD_INFO = { "version": "1.0.0", "webappUrl": "", "env": "test" };\n'
  ));
  assert.equal(info.webappUrl, '');
});

test('version/webappUrl/env are always present so callers need no guards', () => {
  const info = readBuildInfo_(writeVersionFile_('const BUILD_INFO = { "version": "1.0.0" };\n'));
  assert.deepEqual(Object.keys(info).sort(), ['env', 'version', 'webappUrl']);
});

test('no BUILD_INFO literal throws, naming the file and the literal', () => {
  const filePath = writeVersionFile_('const APP_VERSION = "1.0.0";\n');
  assert.throws(() => readBuildInfo_(filePath), (err) => {
    assert.match(err.message, /BUILD_INFO/);
    assert.match(err.message, /Version\.js/);
    return true;
  });
});

test('the literal name is configurable', () => {
  const info = readBuildInfo_(
    writeVersionFile_('const STAMP = { "version": "3.0.0", "env": "sit" };\n'),
    { literalName: 'STAMP' }
  );
  assert.equal(info.version, '3.0.0');
});

test('GAS-Core-wfe: nested subApps fields never override or add to top-level fields', () => {
  const info = readBuildInfo_(writeVersionFile_(`var BUILD_INFO = {
  "version": "0.1.4.4",
  "webappUrl": "https://script.google.com/macros/s/AKfycbx/exec",
  "env": "test",
  "subApps": [
    { "id": "export", "sha": "e98b4e0", "dirty": false, "version": "0.1.0" },
    {
      "id": "action",
      "sha": "bdf3d45",
      "version": "0.2.0"
    }
  ]
};
`));

  assert.equal(info.version, '0.1.4.4');
  assert.equal(info.webappUrl, 'https://script.google.com/macros/s/AKfycbx/exec');
  assert.equal(info.env, 'test');
  assert.equal('id' in info, false);
  assert.equal('sha' in info, false);
});

test('GAS-Core-wfe: bare keys, one line, and brackets inside strings are handled', () => {
  const info = readBuildInfo_(writeVersionFile_(
    `const BUILD_INFO = { version: "1.0.0", note: "a } ] b", subApps: [{ id: "x", version: "9.9.9" }], env: "prod" };\n`
  ));
  assert.equal(info.version, '1.0.0');
  assert.equal(info.note, 'a } ] b');
  assert.equal(info.env, 'prod');
  assert.equal('id' in info, false);
});
