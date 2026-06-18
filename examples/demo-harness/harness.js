'use strict';

/**
 * examples/demo-harness/harness.js — shared demo-harness wrapper.
 *
 * Hybrid model (bd memory test-demo-harness-hybrid-model-2026-06-18,
 * docs/test-harness-design.md §4.1/§4.3). Pushed alongside every demo by
 * scripts/push-demo.sh, together with the demo's `uses[]` libraries
 * (production source + co-located `<name>Demo.js`). This file supplies the
 * runtime environment and the menu/doGet plumbing so individual libraries
 * never reimplement either:
 *
 * - `Harness.getSheet()` — resolves the sheet a demo function should act on
 *   (bound active spreadsheet's active sheet by default, or a sheet looked
 *   up by id/name when configured).
 * - `onOpen()` — builds the spreadsheet UI menu by iterating every loaded
 *   library's `<LIB>_DEMOS` manifest (each entry: { name, demo, kind }) and
 *   binding `menu.addItem(name, e.demo)` directly to the NAMED global demo
 *   function. GAS menu items only bind named globals, not closures — this
 *   is why the manifest's `demo` field is a string, not a function
 *   reference (docs/test-harness-design.md §4.3).
 * - `doGet(e)` — Tier 2 HTTP entry point; routes `?demo=<name>` (or
 *   `?feature=<name>`, matched against manifest `name`) to the named global
 *   function and returns its DemoResult as JSON.
 *
 * Plain GAS-V8: no require(), no ES modules. All `<LIB>_DEMOS` manifests
 * loaded alongside this file share one global scope, per the GAS V8
 * runtime model (developers.google.com/apps-script/guides/v8-runtime).
 */

/**
 * Discovers every loaded library's demo manifest. A library's manifest is a
 * global named `<LIBNAME>_DEMOS` (all caps, e.g. `LIBSHEETS_DEMOS`). This
 * harness has no static knowledge of which libraries are present in a given
 * push — push-demo.sh only assembles the libraries a demo's `uses[]` lists —
 * so manifests are discovered by convention (global names ending in
 * `_DEMOS`) rather than imported explicitly.
 *
 * @returns {Array<{name: string, demo: string, kind?: string, lib: string}>}
 *   Flattened list of demo entries, each tagged with its source manifest
 *   global name (`lib`) for diagnostics.
 */
function harness_collectDemos_() {
  const entries = [];
  const globalScope = this; // top-level `this` is the GAS global object
  for (const key in globalScope) {
    if (!/_DEMOS$/.test(key)) continue;
    let manifest;
    try {
      manifest = globalScope[key];
    } catch (err) {
      continue; // inaccessible global; skip rather than fail the whole scan
    }
    if (!Array.isArray(manifest)) continue;
    manifest.forEach((entry) => {
      if (entry && typeof entry.name === 'string' && typeof entry.demo === 'string') {
        entries.push({ name: entry.name, demo: entry.demo, kind: entry.kind || 'menu', lib: key });
      }
    });
  }
  return entries;
}

/**
 * Harness — environment + lookup helpers available to every demo function.
 * Demo functions are zero-arg and pull what they need from here instead of
 * receiving a context argument, keeping them bindable to menu items.
 */
var Harness = {
  /**
   * Resolves the sheet a demo function should act on.
   * @param {{spreadsheetId?: string, sheetName?: string}=} options
   *   - spreadsheetId: open this spreadsheet by id instead of the bound/
   *     active one (e.g. for a standalone-script demo).
   *   - sheetName: return this named sheet instead of the active sheet.
   * @returns {Sheet} The resolved sheet.
   */
  getSheet(options) {
    const opts = options || {};
    const ss = opts.spreadsheetId
      ? SpreadsheetApp.openById(opts.spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    if (opts.sheetName) {
      return ss.getSheetByName(opts.sheetName) || ss.insertSheet(opts.sheetName);
    }

    return ss.getActiveSheet();
  },
};

/**
 * Builds the spreadsheet UI menu from every loaded library's `<LIB>_DEMOS`
 * manifest. One top-level menu ("Demos"), one item per manifest entry,
 * bound by name to that entry's named global demo function.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Demos');
  const entries = harness_collectDemos_.call(this);

  if (!entries.length) {
    menu.addItem('(no demos loaded)', 'harness_noop_');
  } else {
    entries.forEach((entry) => menu.addItem(entry.name, entry.demo));
  }

  menu.addToUi();
}

/** No-op menu handler shown when no demo manifests are loaded. */
function harness_noop_() {}

/**
 * Tier 2 HTTP entry point. Routes `?demo=<name>` (matched case-sensitively
 * against a manifest entry's `name`) to that entry's named global demo
 * function and returns its DemoResult as JSON. Falls back to `?feature=`
 * for callers matching by the function name itself.
 * @param {GoogleAppsScript.Events.DoGet} e - The doGet event.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON DemoResult.
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const requested = params.demo || params.feature;
  const entries = harness_collectDemos_.call(this);

  if (!requested) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Missing ?demo=<name> query parameter.',
      data: { available: entries.map((entry) => entry.name) },
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const match = entries.find((entry) => entry.name === requested || entry.demo === requested);

  if (!match) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: `No demo named '${requested}'.`,
      data: { available: entries.map((entry) => entry.name) },
    })).setMimeType(ContentService.MimeType.JSON);
  }

  let result;
  try {
    const fn = this[match.demo];
    if (typeof fn !== 'function') {
      throw new Error(`Demo function '${match.demo}' is not defined.`);
    }
    result = fn();
  } catch (err) {
    result = { status: 'error', feature: match.name, message: 'Demo threw an error.', error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

if (typeof module !== 'undefined' && module.exports) {
  // Node test-sandbox path only — never present in a real GAS V8 runtime.
  module.exports = { Harness, onOpen, doGet, harness_collectDemos_ };
}
