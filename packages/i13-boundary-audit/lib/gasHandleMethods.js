'use strict';

/**
 * Default list of GAS SDK method names that return another platform HANDLE (a Spreadsheet,
 * Sheet, Range, Folder, File, ...) rather than a primitive or plain data. Tier B's taint
 * (lib/rules/typeLeak.js) propagates from a governed global only through calls to these names:
 * `SpreadsheetApp.openById(id).getSheetByName(n)` is tainted; `SpreadsheetApp.openById(id).getUrl()`
 * is not, because `getUrl` is not in this list. A closed list is the deliberate trade: an unlisted
 * handle-returning method is a MISSED leak (documented in README.md), where the opposite default
 * (propagate through every call) would flag every `.getUrl()` / `.getValues()` and get the rule
 * switched off.
 *
 * A project extends or replaces it with `extraHandleMethods` / `handleMethods` in i13.config.js.
 * Like lib/gasGlobals.js this is knowledge about the SDK, not about any project's ownership.
 */
const defaultHandleMethods = [
  // SpreadsheetApp / Spreadsheet / Sheet / Range
  'openById', 'openByUrl', 'create', 'getActive', 'getActiveSpreadsheet', 'getActiveSheet',
  'getActiveRange', 'getActiveRangeList', 'getSelection', 'getSheetByName', 'getSheetById',
  'getSheets', 'insertSheet', 'duplicateActiveSheet', 'copy', 'getRange', 'getRangeList',
  'getDataRange', 'getCurrentCell', 'getNextDataRange', 'getCell', 'offset', 'getSheet',
  'getSpreadsheet', 'getFilter', 'getProtections', 'getCharts',
  // DriveApp / Folder / File
  'getFolderById', 'getFileById', 'getRootFolder', 'getFolders', 'getFiles', 'getFoldersByName',
  'getFilesByName', 'createFolder', 'createFile', 'makeCopy', 'getParent', 'getParents',
  'searchFiles', 'searchFolders', 'next',
  // Blobs
  'getBlob', 'getAs', 'newBlob',
  // Documents / Slides / Forms
  'openDocument', 'getActiveDocument', 'getBody', 'getActivePresentation', 'getActiveForm',
];

module.exports = { defaultHandleMethods };
