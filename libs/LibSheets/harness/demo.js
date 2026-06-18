'use strict';

/**
 * libs/LibSheets/harness/demo.js — I4 registration module.
 *
 * Registers this library's demos with the shared aggregator
 * (examples/integrated/test-harness/). Never vendored into a consumer's
 * production clasp deployment — only libSheets.js is (see CONSUMERS.md).
 *
 * Contract reference: docs/test-harness-design.md §4.3 (I4).
 *
 * @typedef {'menu'|'webapp'|'sidebar'} DemoKind
 *
 * @typedef {Object} DemoContext     // passed to entryPoint() by the aggregator
 * @property {string} scope          // resolved scope string, e.g. 'lib:LibSheets'
 * @property {'menu'|'doGet'} trigger // how this invocation was reached
 * @property {Object} [params]       // parsed doGet query params (Tier 2)
 *
 * @typedef {Object} DemoResult      // the completion signal + output schema
 * @property {'ok'|'error'} status   // REQUIRED completion signal
 * @property {string} feature        // echo of the feature id that ran
 * @property {string} [message]      // human-readable summary (shown in UI/log)
 * @property {Object} [data]         // structured, JSON-serializable output
 * @property {string} [error]        // present iff status === 'error'
 *
 * @typedef {Object} DemoEntry
 * @property {string} feature        // stable id, unique within the library
 * @property {string} menuLabel      // label for onOpen() menu / webapp link text
 * @property {DemoKind} [kind]       // optional; defaults to 'menu' if omitted
 * @property {(ctx: DemoContext) => DemoResult} entryPoint
 */

/**
 * Builds a minimal SpreadsheetApp-shaped stub so this harness can demo the
 * SpreadsheetApp-bound code paths (ManagedSheet via the dual-export guard's
 * sibling classes) without a real Sheets binding. This is demo/dev-only
 * scaffolding — it is NOT a Tier 2 substitute (Tier 2 runs against a real
 * bound Sheet/Doc per docs/test-harness-design.md §4.5) and is never
 * vendored into production.
 *
 * @param {Array<Array<*>>} initialData - Row data, header row included.
 * @returns {{getDataRange: Function, getRange: Function, getLastRow: Function}}
 */
function buildStubSheet_(initialData) {
  const data = initialData.map((row) => row.slice());
  return {
    getDataRange() {
      return {
        getValues: () => data.map((row) => row.slice()),
      };
    },
    getLastRow() {
      return data.length;
    },
    appendRow(row) {
      data.push(row.slice());
    },
    _data: data, // exposed for demo introspection only
  };
}

/** @type {DemoEntry[]} */
const demos = [
  {
    feature: 'headerAliasing',
    menuLabel: 'LibSheets: Header Aliasing Demo',
    kind: 'menu',
    // entry-point signature: (ctx: DemoContext) => DemoResult
    // Exercises the pure helpers directly (Tier 1 style) — no SpreadsheetApp
    // involved, so this half of the demo needs no mocking at all.
    entryPoint: (ctx) => {
      const {
        resolveManagedHeaderMap_,
        buildSharedHeaderCopyPlan_,
      } = require('../libSheets.js');

      const headerRow = ['Full Name', 'E-mail', 'Membership Status'];
      const columnMap = {
        fullName: 'Full Name',
        email: { header: 'Email Address', aliases: ['E-mail'] },
        status: 'Membership Status',
      };

      try {
        const resolved = resolveManagedHeaderMap_(headerRow, columnMap, {
          sheetName: 'Demo Sheet',
        });

        const copyPlan = buildSharedHeaderCopyPlan_(
          headerRow,
          ['Jane Doe', 'jane@example.com', 'Active'],
          ['Membership Status', 'Full Name']
        );

        return {
          status: 'ok',
          feature: 'headerAliasing',
          message: `Resolved ${Object.keys(resolved).length} header(s) (email matched via alias 'E-mail'); built a ${copyPlan.length}-entry copy plan.`,
          data: { resolved, copyPlan },
        };
      } catch (err) {
        return {
          status: 'error',
          feature: 'headerAliasing',
          message: 'Header resolution failed.',
          error: err.message,
        };
      }
    },
  },
  {
    feature: 'configSheetLookup',
    menuLabel: 'LibSheets: Config Sheet Lookup Demo',
    kind: 'webapp',
    // Exercises ManagedConfigSheet.findValue (a static helper that takes
    // pre-fetched rows and does not itself call SpreadsheetApp) plus a
    // stubbed sheet object standing in for a real bound Sheet — showing how
    // the demo would run in a real bound-sheet context (Tier 2) while still
    // executing here in plain Node.
    entryPoint: (ctx) => {
      const { ManagedConfigSheet } = (() => {
        // ManagedConfigSheet is not part of the dual-export guard (it is
        // SpreadsheetApp-adjacent), so for this demo we re-declare just
        // enough of its static contract to show the lookup pattern without
        // requiring a real GAS runtime. In a real bound-sheet harness
        // (Tier 2), `require('../libSheets.js').ManagedConfigSheet` would
        // not be available either, since module.exports only carries the
        // pure helpers — callers there use the class directly as a global.
        return {
          ManagedConfigSheet: {
            findValue(configKey, rows) {
              if (!rows) return null;
              const targetKey = String(configKey || '').trim();
              for (let i = 0; i < rows.length; i++) {
                if (String(rows[i][0] || '').trim() === targetKey) {
                  return { primary: rows[i][1], secondary: rows[i][2] };
                }
              }
              return null;
            },
          },
        };
      })();

      const stubConfigSheet = buildStubSheet_([
        ['key', 'primary', 'secondary'],
        ['adminEmail', 'admin@example.com', ''],
        ['retentionDays', '30', 'archive'],
      ]);

      try {
        const rows = stubConfigSheet.getDataRange().getValues();
        const found = ManagedConfigSheet.findValue('retentionDays', rows);

        if (!found) {
          return {
            status: 'error',
            feature: 'configSheetLookup',
            message: "Config key 'retentionDays' not found.",
            error: 'lookup-miss',
          };
        }

        return {
          status: 'ok',
          feature: 'configSheetLookup',
          message: `Looked up 'retentionDays' -> primary=${found.primary}, secondary=${found.secondary}.`,
          data: found,
        };
      } catch (err) {
        return {
          status: 'error',
          feature: 'configSheetLookup',
          message: 'Config lookup failed.',
          error: err.message,
        };
      }
    },
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { demos };
}
