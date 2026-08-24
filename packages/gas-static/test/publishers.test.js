'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseOwnershipMap_,
  loadOwnershipMap_,
  assertSafeDest_,
  assertRegisteredDest_,
} = require('../lib/publishers.js');

function makeHostRepo_(manifestBody) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-host-'));
  fs.mkdirSync(path.join(repoRoot, '.git'));
  if (manifestBody !== null) fs.writeFileSync(path.join(repoRoot, 'PUBLISHERS.md'), manifestBody);
  return repoRoot;
}

const MANIFEST = `# Publishers

Prose a human reads first.

\`\`\`json
{
  "pub/app-sit": { "project": "DemoApp", "env": "test", "url": "https://example.github.io/Static/pub/app-sit/" },
  "pub/app": { "project": "DemoApp", "env": "prod", "url": "https://example.github.io/Static/pub/app/" },
  "pub/other": { "project": "OtherApp", "env": "prod", "url": "https://example.github.io/Static/pub/other/" }
}
\`\`\`

More prose.
`;

test('parseOwnershipMap_ reads the first fenced json block', () => {
  const map = parseOwnershipMap_(MANIFEST);
  assert.deepEqual(Object.keys(map).sort(), ['pub/app', 'pub/app-sit', 'pub/other']);
  assert.equal(map['pub/app-sit'].project, 'DemoApp');
});

test('parseOwnershipMap_ throws when there is no fenced json block', () => {
  assert.throws(() => parseOwnershipMap_('# Publishers\n\nnothing machine-readable here\n'), /no fenced ```json block/);
});

test('parseOwnershipMap_ throws on invalid JSON', () => {
  assert.throws(() => parseOwnershipMap_('```json\n{ nope }\n```\n'), /not valid JSON/);
});

test('parseOwnershipMap_ throws when an entry has no project', () => {
  assert.throws(() => parseOwnershipMap_('```json\n{ "pub/x": { "env": "prod" } }\n```\n'), /"pub\/x".*project/);
});

test('loadOwnershipMap_ returns null when the host repo has no PUBLISHERS.md', () => {
  const repoRoot = makeHostRepo_(null);
  assert.equal(loadOwnershipMap_(repoRoot), null);
});

test('loadOwnershipMap_ returns the manifest path and map', () => {
  const repoRoot = makeHostRepo_(MANIFEST);
  const loaded = loadOwnershipMap_(repoRoot);
  assert.equal(loaded.manifestPath, path.join(repoRoot, 'PUBLISHERS.md'));
  assert.equal(loaded.map['pub/app'].project, 'DemoApp');
});

test('structural backstop refuses every unsafe dest shape', () => {
  const repoRoot = makeHostRepo_(null);
  const cases = [
    ['', /dest is empty/],
    [undefined, /dest is empty/],
    ['/etc', /must be relative/],
    ['pub/../../elsewhere', /must not contain '\.\.'/],
    ['../elsewhere', /must not contain '\.\.'/],
    ['.', /the host repo root itself/],
    ['./', /the host repo root itself/],
    ['.git', /'\.git'/],
    ['pub/.git/hooks', /'\.git'/],
  ];
  for (const [dest, re] of cases) {
    assert.throws(() => assertSafeDest_(repoRoot, dest), re, `dest ${JSON.stringify(dest)} must be refused`);
  }
});

test('structural backstop accepts an ordinary nested dest', () => {
  const repoRoot = makeHostRepo_(null);
  assert.equal(assertSafeDest_(repoRoot, 'pub/app-sit'), path.join(repoRoot, 'pub/app-sit'));
});

test('an unregistered dest is refused, naming the dest and the manifest', () => {
  const repoRoot = makeHostRepo_(MANIFEST);
  assert.throws(
    () => assertRegisteredDest_({ repoRoot, dest: 'pub', projectName: 'DemoApp' }),
    (err) => /not registered/.test(err.message) && /pub/.test(err.message) && /PUBLISHERS\.md/.test(err.message)
  );
});

test("a dest registered to another project is refused, naming both dest and owner", () => {
  const repoRoot = makeHostRepo_(MANIFEST);
  assert.throws(
    () => assertRegisteredDest_({ repoRoot, dest: 'pub/other', projectName: 'DemoApp' }),
    (err) => /pub\/other/.test(err.message) && /OtherApp/.test(err.message) && /DemoApp/.test(err.message)
  );
});

test('a consumer that declares no projectName is refused when a manifest exists', () => {
  const repoRoot = makeHostRepo_(MANIFEST);
  assert.throws(
    () => assertRegisteredDest_({ repoRoot, dest: 'pub/app-sit', projectName: undefined }),
    /projectName/
  );
});

test('a registered dest owned by this project passes and returns its entry', () => {
  const repoRoot = makeHostRepo_(MANIFEST);
  const result = assertRegisteredDest_({ repoRoot, dest: 'pub/app-sit', projectName: 'DemoApp' });
  assert.equal(result.registered, true);
  assert.equal(result.entry.url, 'https://example.github.io/Static/pub/app-sit/');
});

test('a trailing slash on dest does not defeat the lookup', () => {
  const repoRoot = makeHostRepo_(MANIFEST);
  const result = assertRegisteredDest_({ repoRoot, dest: 'pub/app-sit/', projectName: 'DemoApp' });
  assert.equal(result.registered, true);
});

test('a missing manifest warns and falls back to the structural checks only', () => {
  const repoRoot = makeHostRepo_(null);
  const warnings = [];
  const result = assertRegisteredDest_({ repoRoot, dest: 'pub/app-sit', projectName: 'DemoApp', warn: (m) => warnings.push(m) });
  assert.equal(result.registered, false);
  assert.equal(result.reason, 'no-manifest');
  assert.ok(warnings[0].includes('PUBLISHERS.md'));
  assert.throws(() => assertRegisteredDest_({ repoRoot, dest: '../escape', projectName: 'DemoApp', warn: () => {} }), /'\.\.'/);
});

test('a malformed manifest warns and falls back to the structural checks only', () => {
  const repoRoot = makeHostRepo_('```json\n{ broken\n```\n');
  const warnings = [];
  const result = assertRegisteredDest_({ repoRoot, dest: 'pub/app-sit', projectName: 'DemoApp', warn: (m) => warnings.push(m) });
  assert.equal(result.registered, false);
  assert.equal(result.reason, 'malformed-manifest');
  assert.ok(warnings.join(' ').includes('not valid JSON'));
});
