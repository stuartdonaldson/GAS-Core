'use strict';

/**
 * libs/LibSheets/libSheetsDemo.js — co-located demo logic for LibSheets.
 *
 * Hybrid model (bd memory test-demo-harness-hybrid-model-2026-06-18,
 * docs/test-harness-design.md §4.3): a library-prefixed manifest of named
 * global functions, not a closure array. `demo` is a STRING naming a real
 * global function so the shared wrapper's onOpen() menu builder can bind
 * `menu.addItem(name, e.demo)` directly (GAS menu items only bind named
 * globals, not closures). Each demo function is zero-arg and pulls its
 * environment from the shared wrapper's `Harness.getSheet()` instead of
 * receiving a ctx argument.
 *
 * Never vendored into a consumer's production clasp deployment — only
 * libSheets.js is (see CONSUMERS.md). Pushed alongside libSheets.js by
 * scripts/push-demo.sh whenever a demo's demo.config.json lists LibSheets
 * in its `uses`.
 *
 * Plain GAS-V8: no require(), no module-scoped const collisions across
 * libraries (this file's globals are all `libSheets_`-prefixed, and the
 * manifest is `LIBSHEETS_DEMOS`, both unique to this library).
 */

/** @type {Array<{name: string, demo: string, kind?: 'menu'|'webapp'|'sidebar'}>} */
var LIBSHEETS_DEMOS = [
  { name: 'LibSheets: Sheet Management Demo', demo: 'libSheets_sheetManagementDemo', kind: 'menu' },
];

/**
 * Demonstrates the usage of SpreadsheetManager and ManagedSheet against the
 * sheet supplied by the shared harness (Harness.getSheet()).
 * - Demonstrates creating or retrieving a sheet.
 * - Demonstrates accessing existing data.
 * - Demonstrates updating and logging data.
 * - Demonstrates specifying headers as actual headers or as a
 *   comma-separated list of internal names.
 * @returns {{status: 'ok'|'error', feature: string, message?: string, data?: Object, error?: string}}
 */
function libSheets_sheetManagementDemo() {
  try {
    const sheetName = 'Demo Sheet';
    const headerMap = {
      fullName: 'Full Name',
      email: 'Email Address',
      status: 'Membership Status',
      date: 'Date',
    };

    libSheets_demoCreateOrRetrieveSheet_(sheetName, headerMap);
    libSheets_demoAccessAndUpdateSheet_(sheetName, headerMap);
    libSheets_demoSpecifyHeaders_(sheetName, headerMap);

    return {
      status: 'ok',
      feature: 'sheetManagement',
      message: 'Ran sheet management demo: create/retrieve, access/update, and header-specification flows.',
    };
  } catch (err) {
    return {
      status: 'error',
      feature: 'sheetManagement',
      message: 'Sheet management demo failed.',
      error: err.message,
    };
  }
}

/**
 * Demonstrates creating or retrieving a sheet.
 * @param {string} sheetName - The name of the sheet to open or create.
 * @param {Object} headerMap - Mapping of internal field names to sheet column names.
 */
function libSheets_demoCreateOrRetrieveSheet_(sheetName, headerMap) {
  const headers = ['Full Name', 'Email Address', 'Membership Status', 'Date'];

  // Get or create the sheet
  let msheet = openOrCreateSheet(sheetName, headerMap, headers);
  msheet.initSheet(headers);

  // Append a row
  msheet.appendRow({ fullName: 'John Doe', email: 'john@example.com', status: 'Active', date: new Date() });
  msheet.appendRow({ fullName: 'Jane Smith', email: 'smith@example.com', status: 'Inactive', date: new Date() });

  // Retrieve and log all rows
  let users = msheet.getAllRows();
  users.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status} - ${user.date}`));

  msheet.formatSheet();
}

/**
 * Demonstrates accessing existing data and updating it.
 * @param {string} sheetName - The name of the sheet to open.
 * @param {Object} headerMap - Mapping of internal field names to sheet column names.
 */
function libSheets_demoAccessAndUpdateSheet_(sheetName, headerMap) {
  // Open the existing sheet
  let mSheet = openExistingSheet(sheetName, headerMap);

  // Retrieve and log all existing rows
  let users = mSheet.getAllRows();
  Logger.log('Existing Users:');
  users.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status} - ${user.date}`));

  // Update a row (for demonstration, let's update the status of "John Doe")
  mSheet.updateRowByValue('fullName', 'John Doe', { status: 'updated' });

  // Retrieve and log all rows after the update
  users = mSheet.getAllRows();
  Logger.log('Updated Users:');
  users.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status} - ${user.date}`));
}

/**
 * Demonstrates specifying headers as actual headers or as a comma-separated
 * list of internal names.
 * @param {string} sheetName - The name of the sheet to open or create.
 * @param {Object} headerMap - Mapping of internal field names to sheet column names.
 */
function libSheets_demoSpecifyHeaders_(sheetName, headerMap) {
  const headers = ['Full Name', 'Email Address', 'Membership Status', 'Date'];
  const internalNames = 'fullName,email,status,date';

  // Get or create the sheet using actual headers
  let msheet1 = openOrCreateSheet(sheetName + ' asheaders', headerMap, headers);
  msheet1.initSheet(headers);
  msheet1.appendRow({ fullName: 'Jane Doe', email: 'jane@example.com', status: 'Active' });

  // Get or create the sheet using a comma-separated list of internal names
  let msheet2 = openOrCreateSheet(sheetName + ' asnames', headerMap, internalNames);
  msheet2.initSheet(headers);
  msheet2.appendRow({ fullName: 'Jane Doe', email: 'jane@example.com', status: 'Active' });

  // Retrieve and log all rows from both sheets
  let users1 = msheet1.getAllRows();
  Logger.log('Users in Sheet 1:');
  users1.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status}`));

  let users2 = msheet2.getAllRows();
  Logger.log('Users in Sheet 2:');
  users2.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status}`));
}

if (typeof module !== 'undefined' && module.exports) {
  // Node test-sandbox path only — never vendored, never present in a real
  // GAS V8 runtime, where `module` is undefined and these globals are read
  // directly off the shared global scope by examples/demo-harness/harness.js.
  module.exports = { LIBSHEETS_DEMOS, libSheets_sheetManagementDemo };
}
