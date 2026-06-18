'use strict';

/**
 * Tier 1 (plain Node) tests for libSheets.js.
 *
 * Coverage boundary: this file may only exercise the pure, side-effect-free
 * helpers re-exported by the dual-export guard at the bottom of
 * libSheets.js (lines ~829-841). It must never reference SpreadsheetApp,
 * DocumentApp, or any other GAS runtime global — those are not available in
 * plain Node and are covered at Tier 2 (bound harness) instead.
 *
 * Run: node --test libs/LibSheets/test/libSheets.test.js
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCaseInsensitiveHeaderMap_,
  normalizeManagedColumnSpec_,
  getManagedColumnHeader_,
  resolveManagedHeaderMap_,
  findRowIndexByNormalizedValue_,
  buildSharedHeaderCopyPlan_,
  sheetHasContent_,
} = require('../libSheets.js');

describe('buildCaseInsensitiveHeaderMap_', () => {
  test('maps trimmed, lower-cased headers to their index', () => {
    const map = buildCaseInsensitiveHeaderMap_([' Full Name ', 'EMAIL', 'Status']);
    assert.deepEqual(map, { 'full name': 0, email: 1, status: 2 });
  });

  test('treats null/undefined/empty headers as empty string', () => {
    const map = buildCaseInsensitiveHeaderMap_([null, undefined, '']);
    assert.deepEqual(map, { '': 2 }); // later empty entries overwrite earlier ones
  });

  test('returns an empty object for missing/empty input', () => {
    assert.deepEqual(buildCaseInsensitiveHeaderMap_(undefined), {});
    assert.deepEqual(buildCaseInsensitiveHeaderMap_([]), {});
  });
});

describe('normalizeManagedColumnSpec_', () => {
  test('expands a bare string into a full spec', () => {
    assert.deepEqual(normalizeManagedColumnSpec_('Full Name'), {
      header: 'Full Name',
      aliases: [],
      optional: false,
    });
  });

  test('fills in defaults for a partial object spec', () => {
    assert.deepEqual(normalizeManagedColumnSpec_({ header: 'Email' }), {
      header: 'Email',
      aliases: [],
      optional: false,
    });
  });

  test('preserves aliases and optional when provided', () => {
    const spec = normalizeManagedColumnSpec_({
      header: 'Status',
      aliases: ['State', 'Stat'],
      optional: true,
    });
    assert.deepEqual(spec, { header: 'Status', aliases: ['State', 'Stat'], optional: true });
  });

  test('ignores a non-array aliases value', () => {
    const spec = normalizeManagedColumnSpec_({ header: 'Status', aliases: 'not-an-array' });
    assert.deepEqual(spec.aliases, []);
  });

  test('throws when given a non-string, non-object spec', () => {
    assert.throws(() => normalizeManagedColumnSpec_(42), /column spec must be/);
  });

  test('throws when the object spec has no string header', () => {
    assert.throws(() => normalizeManagedColumnSpec_({ aliases: ['x'] }), /column spec must be/);
  });
});

describe('getManagedColumnHeader_', () => {
  test('returns the header for a string spec', () => {
    assert.equal(getManagedColumnHeader_('Email Address'), 'Email Address');
  });

  test('returns the header for an object spec', () => {
    assert.equal(getManagedColumnHeader_({ header: 'Email Address', aliases: ['Email'] }), 'Email Address');
  });
});

describe('resolveManagedHeaderMap_', () => {
  const headerRow = ['Full Name', 'Email Address', 'Membership Status'];
  const columnMap = {
    fullName: 'Full Name',
    email: { header: 'Email Address', aliases: ['E-mail'] },
    status: { header: 'Membership Status' },
  };

  test('resolves all keys to their column index by exact header match', () => {
    const resolved = resolveManagedHeaderMap_(headerRow, columnMap);
    assert.deepEqual(resolved, { fullName: 0, email: 1, status: 2 });
  });

  test('resolves via an alias when the primary header is absent', () => {
    const aliasHeaderRow = ['Full Name', 'E-mail', 'Membership Status'];
    const resolved = resolveManagedHeaderMap_(aliasHeaderRow, columnMap);
    assert.deepEqual(resolved, { fullName: 0, email: 1, status: 2 });
  });

  test('throws listing missing required headers by default', () => {
    const incompleteRow = ['Full Name'];
    assert.throws(
      () => resolveManagedHeaderMap_(incompleteRow, columnMap),
      /Missing expected headers: Email Address, Membership Status/
    );
  });

  test('includes the sheet name in the error message when provided', () => {
    const incompleteRow = ['Full Name'];
    assert.throws(
      () => resolveManagedHeaderMap_(incompleteRow, columnMap, { sheetName: 'Members' }),
      /Missing expected headers in sheet 'Members'/
    );
  });

  test('allowMissingRequired suppresses the throw and omits unresolved keys', () => {
    const incompleteRow = ['Full Name'];
    const resolved = resolveManagedHeaderMap_(incompleteRow, columnMap, { allowMissingRequired: true });
    assert.deepEqual(resolved, { fullName: 0 });
  });

  test('optional columns are silently omitted when absent, no throw', () => {
    const map = { fullName: 'Full Name', nickname: { header: 'Nickname', optional: true } };
    const resolved = resolveManagedHeaderMap_(['Full Name'], map);
    assert.deepEqual(resolved, { fullName: 0 });
  });
});

describe('findRowIndexByNormalizedValue_', () => {
  const rows = [
    ['John Doe', 'Active'],
    ['Jane Smith', 'Inactive'],
    ['JOHN DOE', 'Duplicate'],
  ];

  test('finds the first matching row, case-insensitively, trimmed', () => {
    assert.equal(findRowIndexByNormalizedValue_(rows, 0, '  john doe  '), 0);
  });

  test('finds the last matching row when fromEnd is set', () => {
    assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'john doe', { fromEnd: true }), 2);
  });

  test('respects startRow when scanning forward', () => {
    assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'john doe', { startRow: 1 }), 2);
  });

  test('respects startRow as a lower bound when scanning fromEnd', () => {
    assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'john doe', { fromEnd: true, startRow: 1 }), 2);
    assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'john doe', { fromEnd: true, startRow: 3 }), -1);
  });

  test('returns -1 when no row matches', () => {
    assert.equal(findRowIndexByNormalizedValue_(rows, 0, 'nobody'), -1);
  });

  test('returns -1 for a negative column index or non-array rows', () => {
    assert.equal(findRowIndexByNormalizedValue_(rows, -1, 'john doe'), -1);
    assert.equal(findRowIndexByNormalizedValue_(null, 0, 'john doe'), -1);
  });
});

describe('buildSharedHeaderCopyPlan_', () => {
  test('builds a copy plan only for headers shared between source and target', () => {
    const sourceHeaders = ['Full Name', 'Email Address', 'Extra Source Only'];
    const sourceRow = ['John Doe', 'john@example.com', 'ignored'];
    const targetHeaders = ['Email Address', 'Full Name', 'Extra Target Only'];

    const plan = buildSharedHeaderCopyPlan_(sourceHeaders, sourceRow, targetHeaders);

    // Order follows iteration over the source's normalized header map.
    assert.deepEqual(plan, [
      { header: 'Full Name', targetIndex: 1, value: 'John Doe' },
      { header: 'Email Address', targetIndex: 0, value: 'john@example.com' },
    ]);
  });

  test('returns an empty plan when no headers overlap', () => {
    const plan = buildSharedHeaderCopyPlan_(['A'], ['valA'], ['B']);
    assert.deepEqual(plan, []);
  });
});

describe('sheetHasContent_', () => {
  test('returns false for empty, non-array, or all-blank data', () => {
    assert.equal(sheetHasContent_(undefined), false);
    assert.equal(sheetHasContent_([]), false);
    assert.equal(sheetHasContent_([[]]), false);
    assert.equal(sheetHasContent_([['', null, undefined]]), false);
  });

  test('returns true when any cell has a meaningful value', () => {
    assert.equal(sheetHasContent_([['', '', 'Header']]), true);
    assert.equal(sheetHasContent_([[0]]), true); // 0 is a meaningful value, not blank
  });

  test('handles rows that are not arrays defensively', () => {
    assert.equal(sheetHasContent_([null, ['value']]), true);
  });
});
