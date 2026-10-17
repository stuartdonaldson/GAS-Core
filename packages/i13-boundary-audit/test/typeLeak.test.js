'use strict';

/**
 * Tier A (JSDoc surface) and Tier B (intra-file return taint) of the I13 type-leak check
 * (GAS-Core-0ws). The false-positive cases (AC4) are the larger half of this file on purpose: a
 * rule that fires on legitimate internal use gets switched off.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Linter } = require('eslint');

const { buildI13Blocks, validateConfig } = require('../lib/ownership.js');

const BASE = {
  ownership: { SpreadsheetApp: ['SheetAdapter.js'], DriveApp: ['DriveAdapter.js'] },
  platformTypes: ['Sheet', 'Spreadsheet', 'Range', 'Folder', 'File', 'Blob'],
  publicSurface: { 'SheetAdapter.js': 'SheetAdapter_*', 'DriveAdapter.js': 'DriveAdapter_*' },
};

function lint(code, config = BASE, filename = 'SheetAdapter.js', declareGlobals = true) {
  const linter = new Linter();
  const blocks = buildI13Blocks(config, { baseDir: '.' });
  if (blocks.length === 0) return [];
  const [block] = blocks;
  const globals = declareGlobals
    ? { SpreadsheetApp: 'readonly', DriveApp: 'readonly', PropertiesService: 'readonly' }
    : {};
  return linter
    .verify(
      code,
      {
        languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals },
        plugins: block.plugins,
        rules: block.rules,
      },
      filename
    )
    .filter((m) => m.ruleId === 'i13/type-leak');
}

// ---------------------------------------------------------------- Tier A: true positives

test('A: @returns naming a platform type on a surface function is flagged, at the tag line', () => {
  const m = lint('\n/** @returns {Sheet} */\nfunction SheetAdapter_sheet() { return 1; }\n');
  assert.equal(m.length, 1);
  assert.equal(m[0].line, 2);
  assert.match(m[0].message, /"Sheet"/);
  assert.match(m[0].message, /SheetAdapter_sheet/);
});

test('A: @param naming a platform type is flagged', () => {
  const m = lint('/**\n * @param {Range} range\n */\nfunction SheetAdapter_write(range) {}\n');
  assert.equal(m.length, 1);
  assert.equal(m[0].line, 2);
});

test('A: platform type inside unions, generics, arrays, records and namespaces is flagged', () => {
  for (const type of [
    'Sheet|null',
    'Array<Sheet>',
    'Sheet[]',
    '{sheet: Sheet, n: number}',
    'GoogleAppsScript.Spreadsheet.Sheet',
    '?Folder',
  ]) {
    const m = lint(`/** @returns {${type}} */\nfunction SheetAdapter_x() {}\n`);
    assert.equal(m.length, 1, `expected a finding for {${type}}`);
  }
});

test('A: assigned function expressions and arrows on the surface are checked', () => {
  assert.equal(lint('/** @returns {Range} */\nvar SheetAdapter_a = function () {};').length, 1);
  assert.equal(lint('/** @returns {Range} */\nconst SheetAdapter_b = () => 1;').length, 1);
});

test('A: works with no Tier B possible (no ownership map, only types + surface)', () => {
  const config = { platformTypes: ['Sheet'], publicSurface: { 'SheetAdapter.js': 'SheetAdapter_*' } };
  assert.equal(lint('/** @returns {Sheet} */\nfunction SheetAdapter_s() {}', config).length, 1);
});

test('A: requireReturns flags a value-returning surface function with no @returns', () => {
  const config = { ...BASE, requireReturns: true };
  const m = lint('function SheetAdapter_a() { return 1; }', config);
  assert.equal(m.length, 1);
  assert.match(m[0].message, /no @returns/);
});

// ---------------------------------------------------------------- Tier A: false positives (AC4)

test('FP A: domain types on the surface are not flagged', () => {
  const code =
    '/**\n * @param {string} name\n * @returns {Store}\n */\nfunction SheetAdapter_openStore(name) { return {}; }\n' +
    '/** @returns {Table|null} */\nfunction SheetAdapter_t() { return null; }\n';
  assert.equal(lint(code).length, 0);
});

test('FP A: a platform type on a NON-surface (private) function is not flagged', () => {
  const code =
    '/** @returns {Spreadsheet} */\nfunction _sheetAdapterSpreadsheet() { return SpreadsheetApp.getActive(); }\n' +
    '/** @param {Sheet} sheet */\nfunction helper(sheet) {}\n';
  assert.equal(lint(code).length, 0);
});

test('FP A: a platform type in a file with NO declared surface is not examined', () => {
  assert.equal(
    lint('/** @returns {Sheet} */\nfunction SheetAdapter_sheet() {}', BASE, 'Other.js').length,
    0
  );
});

test('FP A: a surface-named function nested inside another function is not on the surface', () => {
  const code = 'function outer() {\n  /** @returns {Sheet} */\n  function SheetAdapter_inner() {}\n}\n';
  assert.equal(lint(code).length, 0);
});

test('FP A: a type name only appearing in description prose or as a record key is not flagged', () => {
  const code =
    '/**\n * Returns the Sheet count; never hands back a Sheet.\n * @returns {{Sheet: number, name: string}}\n */\nfunction SheetAdapter_count() { return {}; }\n';
  assert.equal(lint(code).length, 0);
});

test('FP A: a longer identifier merely containing a platform type name is not flagged', () => {
  assert.equal(lint('/** @returns {SheetLike|Filesystem} */\nfunction SheetAdapter_x() {}').length, 0);
});

test('FP A: requireReturns does not flag a void surface function or an annotated one', () => {
  const config = { ...BASE, requireReturns: true };
  assert.equal(lint('function SheetAdapter_a() { var x = 1; return; }', config).length, 0);
  assert.equal(lint('/** @returns {number} */\nfunction SheetAdapter_b() { return 1; }', config).length, 0);
  // a return inside a nested function does not make the outer one value-returning
  assert.equal(lint('function SheetAdapter_c() { [1].map(function (x) { return x; }); }', config).length, 0);
});

test('FP A: requireReturns is opt-in (off by default)', () => {
  assert.equal(lint('function SheetAdapter_a() { return 1; }').length, 0);
});

// ---------------------------------------------------------------- Tier B: true positives

test('B: returning a variable initialised from the governed global is flagged (no annotation)', () => {
  const code =
    'function SheetAdapter_sheet(name) {\n  var ss = SpreadsheetApp.getActiveSpreadsheet();\n  var sheet = ss.getSheetByName(name);\n  return sheet;\n}\n';
  const m = lint(code);
  assert.equal(m.length, 1);
  assert.equal(m[0].line, 4);
  assert.match(m[0].message, /SpreadsheetApp/);
});

test('B: returning the call chain directly is flagged', () => {
  assert.equal(
    lint('function SheetAdapter_ss(id) { return SpreadsheetApp.openById(id); }').length,
    1
  );
  assert.equal(
    lint('function SheetAdapter_r() { return SpreadsheetApp.getActive().getSheetByName("a").getRange("A1"); }').length,
    1
  );
});

test('B: taint follows reassignment, conditional, and logical branches', () => {
  assert.equal(
    lint('function SheetAdapter_a(n) { var s; s = SpreadsheetApp.getActive(); return s; }').length,
    1
  );
  assert.equal(
    lint('function SheetAdapter_b(x) { var s = SpreadsheetApp.getActive(); return x ? s : null; }').length,
    1
  );
  assert.equal(
    lint('function SheetAdapter_c(x) { var s = SpreadsheetApp.getActive(); return x || s; }').length,
    1
  );
});

test('B: taint follows a module-level variable initialised from the governed global', () => {
  const code = 'var _ss = SpreadsheetApp.getActive();\nfunction SheetAdapter_ss() { return _ss; }\n';
  assert.equal(lint(code).length, 1);
});

test('B: arrow expression bodies and assigned function expressions are checked', () => {
  assert.equal(lint('const SheetAdapter_a = () => SpreadsheetApp.getActive();').length, 1);
  assert.equal(
    lint('var SheetAdapter_b = function () { return SpreadsheetApp.getActive(); };').length,
    1
  );
});

test('B: works without the project declaring the global in languageOptions.globals', () => {
  assert.equal(
    lint('function SheetAdapter_ss() { return SpreadsheetApp.getActive(); }', BASE, 'SheetAdapter.js', false)
      .length,
    1
  );
});

test('B: each governed identifier taints independently', () => {
  const m = lint('function DriveAdapter_root() { return DriveApp.getRootFolder(); }', BASE, 'DriveAdapter.js');
  assert.equal(m.length, 1);
  assert.match(m[0].message, /DriveApp/);
});

test('B: extraHandleMethods extends the propagation list', () => {
  const code = 'function SheetAdapter_x() { return SpreadsheetApp.getActive().someNewHandle(); }';
  assert.equal(lint(code).length, 0);
  assert.equal(lint(code, { ...BASE, extraHandleMethods: ['someNewHandle'] }).length, 1);
});

// ---------------------------------------------------------------- Tier B: false positives (AC4)

test('FP B: a private helper returning a raw object to another function INSIDE the owner is not flagged', () => {
  const code =
    'function _sheetAdapterSpreadsheet(id) { return SpreadsheetApp.openById(id); }\n' +
    'function _sheetAdapterSheet(name) { var ss = _sheetAdapterSpreadsheet(); return ss.getSheetByName(name); }\n' +
    '/** @returns {Store} */\nfunction SheetAdapter_openStore() { return _sheetAdapterStore(_sheetAdapterSpreadsheet()); }\n' +
    'function _sheetAdapterStore(ss) { return { n: ss.getName() }; }\n';
  assert.equal(lint(code).length, 0);
});

test('FP B: a surface function that CONSUMES a raw object but returns a primitive or domain value is not flagged', () => {
  const code =
    'function SheetAdapter_url() { return SpreadsheetApp.getActive().getUrl(); }\n' +
    'function SheetAdapter_rows(n) { var s = SpreadsheetApp.getActive().getSheetByName(n); return s.getRange("A1:B2").getValues(); }\n' +
    'function SheetAdapter_count() { var s = SpreadsheetApp.getActive().getSheets(); return s.length; }\n' +
    'function SheetAdapter_has(n) { var s = SpreadsheetApp.getActive().getSheetByName(n); return s !== null; }\n' +
    'function SheetAdapter_name(n) { var s = SpreadsheetApp.getActive().getSheetByName(n); return s.getName(); }\n';
  assert.equal(lint(code).length, 0);
});

test('FP B: a surface function returning an object the owner builds around the raw handle is not flagged', () => {
  // Wrapping is the legitimate fix. (A raw handle stashed in a returned property is a documented
  // soundness limit, not something this check claims to see.)
  const code =
    'function SheetAdapter_open(n) {\n  var sheet = SpreadsheetApp.getActive().getSheetByName(n);\n  return { all: function () { return sheet.getDataRange().getValues(); } };\n}\n';
  assert.equal(lint(code).length, 0);
});

test('FP B: a returned parameter or locally-declared lookalike is not flagged', () => {
  assert.equal(lint('function SheetAdapter_id(x) { return x; }').length, 0);
  // a local variable that shadows the governed name is not the platform global
  assert.equal(
    lint('function SheetAdapter_shadow() { var SpreadsheetApp = { getActive: function () { return 1; } }; return SpreadsheetApp.getActive(); }').length,
    0
  );
});

test('FP B: returns inside a nested callback belong to the callback, not the surface function', () => {
  const code =
    'function SheetAdapter_names() {\n  var ss = SpreadsheetApp.getActive();\n  return ss.getSheets().map(function (s) { return s.getName(); });\n}\n' +
    'function SheetAdapter_each() {\n  [1].forEach(function () { return SpreadsheetApp.getActive(); });\n}\n';
  assert.equal(lint(code).length, 0);
});

test('FP B: a non-surface (private or unrelated) function returning a raw object is not flagged', () => {
  const code =
    'function _internal() { return SpreadsheetApp.getActive(); }\n' +
    'function notAdapter() { return SpreadsheetApp.getActive(); }\n' +
    'function SheetAdapter() { return SpreadsheetApp.getActive(); }\n'; // no trailing "_": not matched by SheetAdapter_*
  assert.equal(lint(code).length, 0);
});

test('FP B: a file with no declared surface is not examined, even if it returns raw objects', () => {
  assert.equal(
    lint('function SheetAdapter_x() { return SpreadsheetApp.getActive(); }', BASE, 'Elsewhere.js').length,
    0
  );
});

test('FP B: a variable only conditionally primitive-derived is not flagged (cycle-safe)', () => {
  const code = 'function SheetAdapter_loop() { var a = b; var b = a; return a; }';
  assert.equal(lint(code).length, 0);
});

test('FP B: a legitimate owner shaped like the real SheetAdapter has zero findings', () => {
  const code = [
    '/** @param {string} [containerId]\n * @returns {Store} */',
    'function SheetAdapter_openStore(containerId) {',
    '  return _sheetAdapterStore(_sheetAdapterSpreadsheet(containerId));',
    '}',
    '/** @returns {Spreadsheet} */',
    'function _sheetAdapterSpreadsheet(containerId) {',
    '  if (containerId) return SpreadsheetApp.openById(containerId);',
    '  var active = SpreadsheetApp.getActiveSpreadsheet();',
    '  if (active) return active;',
    '  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("ID"));',
    '}',
    '/** @returns {string} */',
    'function SheetAdapter_spreadsheetUrl() { return _sheetAdapterSpreadsheet().getUrl(); }',
    '/** @returns {Store} */',
    'function _sheetAdapterStore(spreadsheet) {',
    '  var store = { table: function (n) { var sheet = spreadsheet.getSheetByName(n); return _sheetAdapterTable(n, sheet); } };',
    '  return store;',
    '}',
    '/** @returns {Table} */',
    'function _sheetAdapterTable(name, sheet) { return { name: name, rows: function () { return sheet.getDataRange().getValues(); } }; }',
  ].join('\n');
  assert.equal(lint(code).length, 0);
});

// ---------------------------------------------------------------- gating / no-op / config

test('gate: no platformTypes + no ownership -> no blocks at all (silent no-op)', () => {
  assert.deepEqual(buildI13Blocks({ publicSurface: { 'A.js': 'A_*' } }), []);
});

test('gate: no publicSurface declared -> the type-leak rule is not enabled', () => {
  const [block] = buildI13Blocks({ ownership: { SpreadsheetApp: ['A.js'] }, platformTypes: ['Sheet'] });
  assert.equal(block.rules['i13/type-leak'], undefined);
  assert.ok(block.rules['i13/boundary-ownership']);
});

test('gate: platformTypes without ownership still enables Tier A; without platformTypes Tier A is inert', () => {
  const config = { ownership: BASE.ownership, publicSurface: BASE.publicSurface };
  // Tier A inert (no types declared): an annotated leak is NOT flagged, though Tier B still runs
  assert.equal(lint('/** @returns {Sheet} */\nfunction SheetAdapter_s() { return 1; }', config).length, 0);
  assert.equal(lint('function SheetAdapter_s() { return SpreadsheetApp.getActive(); }', config).length, 1);
});

test('gate: existing ownership-only configs build exactly the same single rule as before', () => {
  const blocks = buildI13Blocks({ ownership: { PropertiesService: ['Admin.js'] } });
  assert.equal(blocks.length, 1);
  assert.deepEqual(Object.keys(blocks[0].rules), ['i13/boundary-ownership']);
});

test('config: malformed type-leak declarations are config errors, not silent passes', () => {
  assert.throws(() => validateConfig({ platformTypes: 'Sheet' }), /platformTypes/);
  assert.throws(() => validateConfig({ platformTypes: [''] }), /platformTypes/);
  assert.throws(() => validateConfig({ publicSurface: { 'A.js': [] } }), /publicSurface/);
  assert.throws(() => validateConfig({ publicSurface: ['A.js'] }), /publicSurface/);
  assert.throws(() => validateConfig({ handleMethods: 'x' }), /handleMethods/);
  assert.doesNotThrow(() => validateConfig({ platformTypes: ['Sheet'], publicSurface: { 'A.js': 'A_*' } }));
});
