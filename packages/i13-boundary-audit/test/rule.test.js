'use strict';

/**
 * End-to-end tests running the actual ESLint rule (not just config-building) — the level at
 * which the original design (stacked `no-restricted-globals` blocks) silently failed to flag
 * more than one governed identifier on the same file. See
 * lib/rules/boundaryOwnership.js's doc comment for the story; these tests are the regression net
 * for it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Linter } = require('eslint');

const { buildI13Blocks } = require('../lib/ownership.js');

function lint(code, filename, i13Config, baseDir) {
  const linter = new Linter();
  const [block] = buildI13Blocks(i13Config, { baseDir });
  const config = {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { PropertiesService: 'readonly', UrlFetchApp: 'readonly', ScriptApp: 'readonly' },
    },
    plugins: block.plugins,
    rules: block.rules,
  };
  return linter.verify(code, config, filename);
}

test('flags a non-owner file naming a governed identifier', () => {
  const messages = lint(
    'function f() { PropertiesService.getScriptProperties(); }',
    'Gate.js',
    { ownership: { PropertiesService: ['Admin.js'] } },
    '.'
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /PropertiesService/);
  assert.match(messages[0].message, /Admin\.js/);
});

test('does not flag the declared owner file', () => {
  const messages = lint(
    'function f() { PropertiesService.getScriptProperties(); }',
    'Admin.js',
    { ownership: { PropertiesService: ['Admin.js'] } },
    '.'
  );
  assert.equal(messages.length, 0);
});

test('a declared exception suppresses the finding for its file only', () => {
  const config = {
    ownership: { PropertiesService: ['Admin.js'] },
    exceptions: [{ identifier: 'PropertiesService', file: 'Gate.js', reason: 'x' }],
  };
  assert.equal(
    lint('PropertiesService.getScriptProperties();', 'Gate.js', config, '.').length,
    0
  );
  assert.equal(
    lint('PropertiesService.getScriptProperties();', 'H_Admin.js', config, '.').length,
    1
  );
});

// The regression this file exists for: TWO governed identifiers, checked against a file that
// owns neither. Stacked no-restricted-globals blocks reported only the LAST-declared
// identifier here; the custom rule must report both.
test('multiple governed identifiers are all enforced on the same non-owner file', () => {
  const config = {
    ownership: {
      PropertiesService: ['Admin.js'],
      UrlFetchApp: ['AxiomLogger.js'],
    },
  };
  const messages = lint(
    'function f() {\n' +
      '  PropertiesService.getScriptProperties();\n' +
      '  UrlFetchApp.fetch("https://example.com");\n' +
      '}',
    'Gate.js',
    config,
    '.'
  );
  assert.equal(messages.length, 2);
  const identifiers = messages.map((m) => (m.message.match(/"([A-Za-z]+)"/) || [])[1]).sort();
  assert.deepEqual(identifiers, ['PropertiesService', 'UrlFetchApp']);
});

test('an ungoverned identifier (not a key of ownership) is never flagged', () => {
  const messages = lint(
    'ScriptApp.getService();',
    'Gate.js',
    { ownership: { PropertiesService: ['Admin.js'] } },
    '.'
  );
  assert.equal(messages.length, 0);
});
