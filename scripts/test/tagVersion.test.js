'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTag, checkTagVersion } = require('../lib/tagVersion.js');

test('parseTag extracts package name and version from a gas-<name>-v<version> tag', () => {
  assert.deepEqual(parseTag('gas-static-v1.1.0'), { pkgName: 'gas-static', version: '1.1.0' });
  assert.deepEqual(parseTag('gas-deploy-v1.2.1'), { pkgName: 'gas-deploy', version: '1.2.1' });
});

test('parseTag returns null for a tag that does not match the gas-*-v* shape', () => {
  assert.equal(parseTag('v1.2.1'), null);
  assert.equal(parseTag('gas-static-1.1.0'), null);
  assert.equal(parseTag('random-tag'), null);
});

test('checkTagVersion passes when the tag matches packages/<name>/package.json version', () => {
  const readPackageVersion = (pkgName) => {
    assert.equal(pkgName, 'gas-static');
    return '1.1.0';
  };
  const result = checkTagVersion('gas-static-v1.1.0', { readPackageVersion });
  assert.equal(result.ok, true);
});

test('checkTagVersion refuses a tag whose version disagrees with the package.json', () => {
  const readPackageVersion = () => '1.1.0';
  const result = checkTagVersion('gas-static-v1.2.0', { readPackageVersion });
  assert.equal(result.ok, false);
  assert.match(result.message, /gas-static-v1\.2\.0/);
  assert.match(result.message, /1\.1\.0/);
});

test('checkTagVersion refuses a tag that does not match the gas-*-v* shape', () => {
  const result = checkTagVersion('not-a-package-tag', { readPackageVersion: () => '1.0.0' });
  assert.equal(result.ok, false);
  assert.match(result.message, /does not match/);
});

test('checkTagVersion refuses a tag naming a package with no package.json', () => {
  const readPackageVersion = () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  const result = checkTagVersion('gas-nope-v1.0.0', { readPackageVersion });
  assert.equal(result.ok, false);
  assert.match(result.message, /packages\/gas-nope/);
});
