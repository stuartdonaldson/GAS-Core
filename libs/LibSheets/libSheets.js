/**
 * libSheets.js
 * 
 * This library provides a standard interface for Google Sheets that behave like tables.
 * It supports stable canonical field names in code, while allowing existing sheets to keep
 * legacy header text until an explicit migration is requested elsewhere.
 * 
 * Primary Use Case Scenarios:
 * 
 * 1. SpreadsheetManager Class:
 *    - Handles sheet-level operations, including creating sheets, applying headers, and formatting.
 *    - Ensures that sheets are created if they do not exist and provides methods to manage sheet headers and formatting.
 *    - Example:
 *      const ssManager = new SpreadsheetManager();
 *      const sheet = ssManager.getOrCreateSheet("Sheet Name", ["Header1", "Header2"]);
 * 
 * 2. ManagedSheet Class:
 *    - Handles row-level operations, including retrieving rows, searching, updating, and appending.
 *    - Builds an in-memory header map from canonical field keys to actual sheet columns.
 *    - Header resolution is alias-aware but read-only: opening a legacy sheet normalizes access in memory
 *      without rewriting the underlying header row.
 *    - Example:
 *      const managedSheet = new ManagedSheet(sheet, columnMap, headers);
 *      managedSheet.appendRow({ column1: "Value1", column2: "Value2" });
 *      const rows = managedSheet.getAllRows();
 * 
 * 3. openOrCreateSheet Function:
 *    - Opens or creates a sheet and returns a ManagedSheet object.
 *    - Ensures that the sheet is created if it does not exist and initializes it with the specified headers.
 *    - Example:
 *      const managedSheet = openOrCreateSheet("Sheet Name", columnMap, ["Header1", "Header2"]);
 * 
 * 4. openExistingSheet Function:
 *    - Opens an existing sheet and returns a ManagedSheet object.
 *    - Throws an error if the sheet does not exist.
 *    - Future path: explicit schema/header migration may be added as a separate operation,
 *      but opening a legacy sheet must remain non-destructive.
 *    - Example:
 *      const managedSheet = openExistingSheet("Sheet Name", columnMap);
 * 
 */

/**
 * Demo function to show the usage of SpreadsheetManager and ManagedSheet.
 * - Demonstrates creating or retrieving a sheet.
 * - Demonstrates accessing existing data.
 * - Demonstrates updating and logging data.
 * - Demonstrates specifying headers as actual headers or as a comma-separated list of internal names.
 */
function demoSheetManagement() {
  const sheetName = "Demo Sheet";
  const headers = ["Full Name", "Email Address", "Membership Status", "Date"];
  const headerMap = {
      "fullName": "Full Name",
      "email": "Email Address",
      "status": "Membership Status",
      "date": "Date",
  };

  // Demonstrate creating or retrieving a sheet
  demoCreateOrRetrieveSheet(sheetName, headerMap, headers);

  // Demonstrate accessing existing data and updating it
  demoAccessAndUpdateSheet(sheetName, headerMap);

  // Demonstrate specifying headers as actual headers or as a comma-separated list of internal names
  demoSpecifyHeaders(sheetName, headerMap);

}

/**
* Demonstrates creating or retrieving a sheet.
* @param {string} sheetName - The name of the sheet to open or create.
* @param {Object} headerMap - Mapping of internal field names to sheet column names.
* @param {Array<string>} headers - The column headers to apply if the sheet is created.
*/
function demoCreateOrRetrieveSheet(sheetName, headerMap, headers) {
  // Get or create the sheet
  let msheet = openOrCreateSheet(sheetName, headerMap, headers);
  msheet.initSheet(headers);

  // Append a row
  msheet.appendRow({ fullName: "John Doe", email: "john@example.com", status: "Active", date: new Date() });
  msheet.appendRow({ fullName: "Jane Smith", email: "smith@example.com", status: "Inactive", date: new Date() });

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
function demoAccessAndUpdateSheet(sheetName, headerMap) {
  // Open the existing sheet
  let mSheet = openExistingSheet(sheetName, headerMap);

  // Retrieve and log all existing rows
  let users = mSheet.getAllRows();
  Logger.log("Existing Users:");
  users.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status} - ${user.date}`));

  // Update a row (for demonstration, let's update the status of "John Doe")
  mSheet.updateRowByValue("fullName", "John Doe", { status: "updated" });

  // Retrieve and log all rows after the update
  users = mSheet.getAllRows();
  Logger.log("Updated Users:");
  users.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status} - ${user.date}`));
}

/**
* Demonstrates specifying headers as actual headers or as a comma-separated list of internal names.
* @param {string} sheetName - The name of the sheet to open or create.
* @param {Object} headerMap - Mapping of internal field names to sheet column names.
*/
function demoSpecifyHeaders(sheetName, headerMap) {
  const headers = ["Full Name", "Email Address", "Membership Status", "Date"];
  const internalNames = "fullName,email,status,date";

  // Get or create the sheet using actual headers
  let msheet1 = openOrCreateSheet(sheetName + " asheaders", headerMap, headers);
  msheet1.initSheet(headers);
  msheet1.appendRow({ fullName: "Jane Doe", email: "jane@example.com", status: "Active" });

  // Get or create the sheet using a comma-separated list of internal names
  let msheet2 = openOrCreateSheet(sheetName + " asnames", headerMap, internalNames);
  msheet2.initSheet(headers);
  msheet2.appendRow({ fullName: "Jane Doe", email: "jane@example.com", status: "Active" });

  // Retrieve and log all rows from both sheets
  let users1 = msheet1.getAllRows();
  Logger.log("Users in Sheet 1:");
  users1.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status}`));

  let users2 = msheet2.getAllRows();
  Logger.log("Users in Sheet 2:");
  users2.forEach(user => Logger.log(`User: ${user.fullName} - ${user.email} - ${user.status}`));
}

/**
 * Opens or creates a sheet and returns a ManagedSheet object.
 * @param {string} sheetName - The name of the sheet to open or create.
 * @param {Object} columnMap - Mapping of internal field names to sheet column names.
 * @param {Array<string>|string} headers - The column headers to apply if the sheet is created, or a comma-separated list of internal names.
 * @returns {ManagedSheet} The ManagedSheet instance.
 */
function openOrCreateSheet(sheetName, columnMap, headers) {
  const ssManager = new SpreadsheetManager();
  return ssManager.openOrCreateManagedSheet(sheetName, columnMap, headers);
}

/**
 * Opens an existing sheet and returns a ManagedSheet object.
 * @param {string} sheetName - The name of the sheet to open.
 * @param {Object} columnMap - Mapping of internal field names to sheet column names.
 * @returns {ManagedSheet} The ManagedSheet instance.
 */
function openExistingSheet(sheetName, columnMap) {
  const ssManager = new SpreadsheetManager();
  return ssManager.openExistingSheet(sheetName, columnMap);
}

/**
 * Opens the Config sheet and returns a ManagedConfigSheet helper.
 * @param {Spreadsheet=} spreadsheet - Optional spreadsheet; defaults to active spreadsheet.
 * @returns {ManagedConfigSheet|null} Managed config sheet helper, or null when Config sheet is missing.
 */
function openConfigSheet(spreadsheet) {
  const ssManager = new SpreadsheetManager(spreadsheet);
  return ssManager.openConfigSheet();
}

/**
 * Builds a case-insensitive header-to-index map for a row of headers.
 * @param {Array<*>} headers - Header row values.
 * @returns {Object<string, number>} Normalized header text to zero-based column index.
 */
function buildCaseInsensitiveHeaderMap_(headers) {
  const map = {};
  (headers || []).forEach((header, index) => {
    map[String(header || '').trim().toLowerCase()] = index;
  });
  return map;
}

function normalizeManagedColumnSpec_(columnSpec) {
  if (typeof columnSpec === 'string') {
    return { header: columnSpec, aliases: [], optional: false };
  }

  if (!columnSpec || typeof columnSpec.header !== 'string') {
    throw new Error('ManagedSheet column spec must be a header string or { header, aliases?, optional? } object');
  }

  return {
    header: columnSpec.header,
    aliases: Array.isArray(columnSpec.aliases) ? columnSpec.aliases : [],
    optional: !!columnSpec.optional
  };
}

function getManagedColumnHeader_(columnSpec) {
  return normalizeManagedColumnSpec_(columnSpec).header;
}

function resolveManagedHeaderMap_(headerRow, columnMap, options) {
  const normalizedHeaderMap = buildCaseInsensitiveHeaderMap_(headerRow || []);
  const resolved = {};
  const missing = [];

  Object.keys(columnMap || {}).forEach((key) => {
    const spec = normalizeManagedColumnSpec_(columnMap[key]);
    const candidateHeaders = [spec.header].concat(spec.aliases || []);
    let foundIndex = -1;

    for (let i = 0; i < candidateHeaders.length; i++) {
      const normalizedName = String(candidateHeaders[i] || '').trim().toLowerCase();
      if (normalizedName in normalizedHeaderMap) {
        foundIndex = normalizedHeaderMap[normalizedName];
        break;
      }
    }

    if (foundIndex !== -1) {
      resolved[key] = foundIndex;
    } else if (!spec.optional) {
      missing.push(spec.header);
    }
  });

  if (missing.length && !(options && options.allowMissingRequired)) {
    const targetName = options && options.sheetName ? " in sheet '" + options.sheetName + "'" : '';
    throw new Error('Missing expected headers' + targetName + ': ' + missing.join(', '));
  }

  return resolved;
}

/**
 * Finds a row index in a 2D array by normalized cell value.
 * @param {Array<Array<*>>} rows - Row data.
 * @param {number} columnIndex - Zero-based column index to compare.
 * @param {*} value - Value to match.
 * @param {{fromEnd?: boolean, startRow?: number}=} options - Search options.
 * @returns {number} Matching row index, or -1 if not found.
 */
function findRowIndexByNormalizedValue_(rows, columnIndex, value, options) {
  if (!Array.isArray(rows) || columnIndex < 0) {
    return -1;
  }

  const normalizedValue = String(value || '').trim().toLowerCase();
  const fromEnd = !!(options && options.fromEnd);
  const startRow = options && typeof options.startRow === 'number' ? options.startRow : 0;

  if (fromEnd) {
    for (let rowIndex = rows.length - 1; rowIndex >= startRow; rowIndex--) {
      if (String((rows[rowIndex] || [])[columnIndex] || '').trim().toLowerCase() === normalizedValue) {
        return rowIndex;
      }
    }
    return -1;
  }

  for (let rowIndex = startRow; rowIndex < rows.length; rowIndex++) {
    if (String((rows[rowIndex] || [])[columnIndex] || '').trim().toLowerCase() === normalizedValue) {
      return rowIndex;
    }
  }
  return -1;
}

/**
 * Builds a write plan for copying matching header values between sheets.
 * @param {Array<*>} sourceHeaders - Source header row.
 * @param {Array<*>} sourceRow - Source row values.
 * @param {Array<*>} targetHeaders - Target header row.
 * @returns {Array<{header: string, targetIndex: number, value: *}>} Copy plan.
 */
function buildSharedHeaderCopyPlan_(sourceHeaders, sourceRow, targetHeaders) {
  const sourceMap = buildCaseInsensitiveHeaderMap_(sourceHeaders);
  const targetMap = buildCaseInsensitiveHeaderMap_(targetHeaders);
  const copyPlan = [];

  Object.keys(sourceMap).forEach((normalizedHeader) => {
    if (!(normalizedHeader in targetMap)) {
      return;
    }
    const sourceIndex = sourceMap[normalizedHeader];
    copyPlan.push({
      header: sourceHeaders[sourceIndex],
      targetIndex: targetMap[normalizedHeader],
      value: sourceRow[sourceIndex]
    });
  });

  return copyPlan;
}

function sheetHasContent_(data) {
  if (!Array.isArray(data) || !data.length) {
    return false;
  }

  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const row = Array.isArray(data[rowIndex]) ? data[rowIndex] : [];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const cellValue = row[colIndex];
      if (cellValue !== '' && cellValue !== null && cellValue !== undefined) {
        return true;
      }
    }
  }

  return false;
}

/**
 * SpreadsheetManager: Handles high-level operations on the entire spreadsheet.
 * - Manages the creation, deletion, renaming, and listing of sheets.
 * - Handles operations that affect the structure of the spreadsheet as a whole.
 */
class SpreadsheetManager {
  constructor(spreadsheet) {
    this.ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  }

  /**
   * Gets or creates a ManagedSheet instance for a given sheet name and headers.
   * @param {string} sheetName - The name of the sheet to retrieve or create.
   * @param {Array<string>} headers - The column headers to apply if the sheet is created. Or a string of comma separated keys to the columnMap
   * @param {Object} columnMap - Mapping of internal field names to sheet column names.
   * @returns {ManagedSheet} The ManagedSheet instance.
   */
  openOrCreateManagedSheet(sheetName, columnMap, headers) {
    let sheet = this.ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`Creating new sheet: ${sheetName}`);
      sheet = this.ss.insertSheet(sheetName);
      return new ManagedSheet(sheet, columnMap, headers).initSheet();
    }
    return new ManagedSheet(sheet, columnMap, headers);
  }
  /**
   * Opens an existing sheet and returns a ManagedSheet object.
   * @param {string} sheetName - The name of the sheet to open.
   * @param {Object} columnMap - Mapping of internal field names to sheet column names.
   * @returns {ManagedSheet} The ManagedSheet instance.
   */
  openExistingSheet(sheetName, columnMap) {
    let sheet = this.ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet with name '${sheetName}' does not exist.`);
    }
    return new ManagedSheet(sheet, columnMap);
  }

  /**
   * Opens the Config sheet and returns a ManagedConfigSheet helper.
   * @returns {ManagedConfigSheet|null} Managed config sheet helper, or null when Config sheet is missing.
   */
  openConfigSheet() {
    let sheet = this.ss.getSheetByName('Config');
    if (!sheet) {
      return null;
    }
    return new ManagedConfigSheet(sheet);
  }

  /**
 * Deletes a sheet by its name.
 * @param {string} sheetName - The name of the sheet to delete.
 */
  deleteSheet(sheetName) {
    let sheet = this.ss.getSheetByName(sheetName);
    if (sheet) {
      this.ss.deleteSheet(sheet);
      Logger.log(`Deleted sheet: ${sheetName}`);
    } else {
      Logger.log(`Sheet with name '${sheetName}' does not exist.`);
    }
  }
}

/**
 * ManagedConfigSheet: Handles key/primary/secondary configuration rows.
 * Config schema: column A = key, column B = primary, column C = secondary.
 */
class ManagedConfigSheet {
  constructor(sheet) {
    this.sheet = sheet;
  }

  getValues() {
    return this.sheet.getDataRange().getValues();
  }

  /**
   * Finds a config row in pre-fetched values.
   * @param {string} configKey - Key in column A.
   * @param {Array<Array<*>>} rows - Config sheet rows.
   * @returns {{primary: *, secondary: *}|null}
   */
  static findValue(configKey, rows) {
    if (!rows) return null;
    const targetKey = String(configKey || '').trim();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === targetKey) {
        return { primary: rows[i][1], secondary: rows[i][2] };
      }
    }
    return null;
  }

  /**
   * Reads a config value by key.
   * @param {string} configKey - Key in column A.
   * @param {Array<Array<*>>=} rows - Optional pre-fetched rows.
   * @returns {{primary: *, secondary: *}|null}
   */
  getValue(configKey, rows) {
    return ManagedConfigSheet.findValue(configKey, rows || this.getValues());
  }

  /**
   * Inserts or updates a config row by key.
   * @param {string} configKey - Key in column A.
   * @param {*=} primary - Primary value for column B. If undefined, preserves existing value.
   * @param {*=} secondary - Secondary value for column C. If undefined, preserves existing value.
   * @param {Array<Array<*>>=} rows - Optional pre-fetched rows.
   * @returns {ManagedConfigSheet} this helper to allow chaining.
   */
  upsertValue(configKey, primary, secondary, rows) {
    const values = rows || this.getValues();
    const targetKey = String(configKey || '').trim();

    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === targetKey) {
        const nextPrimary = primary === undefined ? values[i][1] : (primary === null ? '' : primary);
        const nextSecondary = secondary === undefined ? values[i][2] : (secondary === null ? '' : secondary);
        this.sheet.getRange(i + 1, 2).setValue(nextPrimary);
        this.sheet.getRange(i + 1, 3).setValue(nextSecondary);
        return this;
      }
    }

    const appendPrimary = primary === undefined || primary === null ? '' : primary;
    const appendSecondary = secondary === undefined || secondary === null ? '' : secondary;
    this.sheet.appendRow([targetKey, appendPrimary, appendSecondary]);
    return this;
  }
}

/**
 * ManagedSheet: Handles operations on or in a specific sheet
 * - Retrieves rows as objects using a predefined column mapping.
 * - Supports row searching, updating, and appending.
 * - Keeps in-memory data synchronized with the sheet.
 */
class ManagedSheet {
  constructor(sheet, columnMap, headers = null) {
    this.sheet = sheet;

    if (typeof headers === 'string') {
      // Comma-separated string of internal field names needs to be converted to an array
      headers = headers.split(',').map(key => getManagedColumnHeader_(columnMap[key.trim()]));
    }
    this.headers = headers;
    this.columnMap = columnMap;
    this.liveUpdate = true;
    this.updatesPending = 0;
    var data = this.sheet.getDataRange().getValues();
    if (!sheetHasContent_(data)) {
      this.initSheet();
    } else {
      this.refreshData();
    }
  }
  /**
   * Loads or refreshes the sheet data and header mapping.
   */
  refreshData() {
    this.data = this.sheet.getDataRange().getValues();
    this.createHeaderMap(this.data[0]);
  }
  /**
   * Reinitializes the sheet only with headers currently defined or with specified headers.
   */
  initSheet(headers = null) {
    if (headers) {
      if (typeof headers === 'string') {
        // Comma-separated string of internal field names needs to be converted to an array
        headers = headers.split(',').map(key => getManagedColumnHeader_(this.columnMap[key.trim()]));
      }
      this.headers = headers;
    }
    if (this.headers) {
      var dthis = this;
      var last = this.sheet.getLastRow();
      if (last > 1) {
        this.sheet.setFrozenRows(0);
        this.sheet.deleteRows(2, last-1);
      }
      last = this.sheet.getLastColumn();
      if (last > 1) {
        this.sheet.setFrozenColumns(0);
        //Don't delete columns as that messes up spreadsheet formulas referencing them
        //this.sheet.deleteColumns(2, last-1);  
      }
      this.sheet.clear();
      this.sheet.clearNotes();
      this.sheet.getRange(1, 1, 1, this.headers.length).setValues([this.headers]);
      var sheetRange = this.sheet.getDataRange();
      this.data = sheetRange.getValues();

      this.createHeaderMap(this.data[0]);
  
      // Format the header row
      let headerRange = this.sheet.getRange(1, 1, 1, this.headers.length);
      //headerRange.setFontWeight("bold").setBackground("#f1f1f1");
  
      // Auto-size columns
      //this.sheet.autoResizeColumns(1, this.headers.length);
  
      // Apply auto-filter
      this.sheet.getFilter()?.remove(); // Remove any existing filters first
      this.sheet.getRange(1, 1, this.sheet.getMaxRows(), this.headers.length).createFilter();
    } else {
      throw new Error(`No headers defined for sheet ${this.sheet.getName()}`);
    }
    return this;
  }

  /**
   * Creates a mapping of internal field names as found in columnMap to their 
   * actual column positions if found.
   * @returns {ManagedSheet} this sheet so commands can be chaianed.
   */
  createHeaderMap(headerRow) {
    let map = {};
    const dthis = this;

    try {
      map = resolveManagedHeaderMap_(headerRow, this.columnMap, {
        allowMissingRequired: true,
        sheetName: this.sheet.getName()
      });
    } catch (err) {
      Logger.log(`Warning: Failed to resolve header map for sheet '${dthis.sheet.getName()}': ${err.message}`);
      map = {};
    }

    for (let key in this.columnMap) {
      if (key in map) continue;
      const columnSpec = normalizeManagedColumnSpec_(this.columnMap[key]);
      if (columnSpec.optional) continue;
      const columnName = columnSpec.header;
      Logger.log(`Warning: Column '${columnName}' not found in sheet '${dthis.sheet.getName()}'`);
    }
    this.headerMap = map;
    return this;
  }

  /*
  * getManagedRange
  * support multiple calling methods, similar to the SpreadsheetApp.getRange method.  If a column is a string, then lookup the spreadsheet column via the headerMap, recalling that the headerMap refers to the array positions and you need to add 1 to specify the spreadsheet column.
  * if the number of rows is specified, then use it, otherwise assume the range is the entire column
  * return a range for the following conditions.
  * - data in a named column (rows 2 through end of spreadsheet)
  * - header for the named column  * 
  * @param {string|number} column - The column name or number using headerMap.  Throws an error if not found
  * @param {number} rows - if not specified then the data range (2 to end) is returned.  If specified then that cell is returned
  * @returns {Range} The range object for the specified column and rows
  */
  getManagedRange(column, rows) {
    if (typeof column === 'string') {
      if (!(column in this.headerMap)) {
        throw new Error(`Column '${column}' not found in headerMap for sheet '${this.sheet.getName()}'`);
      }
      column = this.headerMap[column] + 1;
    }
    if (rows) {
      return this.sheet.getRange(rows, column);
    }
    return this.sheet.getRange(2, column, this.sheet.getLastRow()-1);
  }

  setColumnWidth(column, width) {
    if (typeof column === 'string') {
      if (!(column in this.headerMap)) {
        throw new Error(`Column '${column}' not found in headerMap for sheet '${this.sheet.getName()}'`);
      }
      column = this.headerMap[column] + 1;
    }
    this.sheet.setColumnWidth(column, width);
  }
  /**
   * Retrieves all rows as an array of objects using internal field names.
   * @returns {Array<Object>} Array of row objects
   */
  getAllRows() {
    return this.data.slice(1).map(row => this.mapRow(row));
  }

  /**
   * Converts a row array into an object using the dynamic header map.
   * @param {Array} row - The row data array from the sheet
   * @returns {Object} Row represented as an object with fixed property names
   */
  mapRow(row) {
    let obj = {};
    for (let key in this.headerMap) {
      obj[key] = row[this.headerMap[key]];
    }
    return obj;
  }

  /**
   * Finds a row by a specific field value.
   * @param {string} field - Internal field name
   * @param {string} value - Value to search for
   * @returns {Object|null} Row object if found, null otherwise
   */
  findRow(field, value) {
    if (!(field in this.headerMap)) return null;
    for (let i = 1; i < this.data.length; i++) {
      if (this.data[i][this.headerMap[field]] === value) {
        return this.mapRow(this.data[i]);
      }
    }
    return null;
  }

  /**
   * Updates a row by a specific field value and updates the internal data cache.
   * @param {string} field - Internal field name to search by
   * @param {string} value - Value to search for
   * @param {Object} updates - Key-value pairs of fields to update
   * @returns {boolean} True if updated, false otherwise
   */
  updateRowByValue(field, value, updates) {
    if (!(field in this.headerMap)) return false;
    for (let i = 1; i < this.data.length; i++) {
      if (this.data[i][this.headerMap[field]] === value) {
        this.updateRow(i, updates);
        return true;
      }
    }
    return false;
  }

  /*
  * updateRow
  * @param {number} row - The row number to update (spreadsheet numbering row 1 = column A)
  * @param {Object} updates - Key-value pairs of fields to update
  * @returns {ManagedSheet} this sheet so commands can be chained.
  */
  updateRow(row, updates) {
    for (let key in updates) {
      if (key in this.headerMap) {
        let colIndex = this.headerMap[key];
        this.sheet.getRange(row+1, colIndex + 1).setValue(updates[key]);
        this.data[row][colIndex] = updates[key];
      }
    }
    return this;
  }

  /**
    * appendRow
    * @param {Object}
    * @returns {ManagedSheet} this sheet so commands can be chained.
    */
  appendRow(rowData) {
    var dthis = this;
    let newRow = new Array(this.data[0].length).fill("");
    for (let key in rowData) {
      if (key in this.headerMap) {
        newRow[this.headerMap[key]] = rowData[key];
      }
    }
    if (this.liveUpdate) {
      this.sheet.appendRow(newRow);
    } else {
      this.updatesPending += 1;
    }
    this.data.push(newRow);
    return this;
  }
  flush() {
    if (this.updatesPending) {
      this.sheet.getRange(1,1, this.data.length, this.data[0].length).setValues(this.data);
      this.updatesPending = 0;
    }
  }
  formatTable() {
    var dthis = this;
    this.flush()
    formatTable(this.sheet);
    return this;
  }

  /**
   * Formats the sheet by auto-fitting columns, setting max width, and enabling text wrapping.
   */
  formatSheet() {
    const maxColumnWidth = 200;
    const numColumns = this.data[0].length;
    if (this.updatesPending) {
      this.sheet.getRange(1,this.sheet.getLastRow(), this.sheet.getLastColumn).setValues(this.data);
      this.updatesPending = 0;
    }
    for (let col = 1; col <= numColumns; col++) {
      this.sheet.autoResizeColumn(col);
      let columnWidth = this.sheet.getColumnWidth(col);
      if (columnWidth > maxColumnWidth) {
        this.sheet.setColumnWidth(col, maxColumnWidth);
      }
      this.sheet.getRange(1, col, this.sheet.getMaxRows()).setWrap(columnWidth > (maxColumnWidth + 20));
    }
    return this;
  }
  /**
 * Protects the sheet from editing.
 */
  protectSheet() {
    let protection = this.sheet.protect();
    Logger.log(`Protected sheet: ${this.sheet.getName()}`);
  }

  /**
   * Removes protection from the sheet.
   */
  unprotectSheet() {
    let protections = this.sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    protections.forEach(protection => protection.remove());
    Logger.log(`Unprotected sheet: ${this.sheet.getName()}`);
  }
    /*
  * getColumnAlpha
  * @param {number}
  * @returns {string}
  */
  getColumnAlpha(col) {
    return String.fromCharCode(65 + col - 1);
  }
  /**
   * Retrieves the column index for a given field name.
   * @param {string} name - The internal field name.
   * @returns {number} The column index corresponding to the field name.
   * @throws {Error} If the field name is not found in the header map.
   */
  getColumnFromFieldName(name) {
    var dthis = this;
    // throw an error if the field name is not found
    if (!(name in this.headerMap)) {
      throw new Error(`Field '${name}' not found in sheet '${this.sheet.getName()}'`);
    }
    return this.headerMap[name] + 1;
  }

  /************************************************************************
   * Mapping Functions from ManagedSheet to Sheet
   * These functions are pass-through functions to the sheet object
   ************************************************************************/
  hideSheet() {
    this.sheet.hideSheet();
    return this;
  }
  showSheet() {
    this.sheet.showSheet();
    return this;
  }

  /**
     * Protects the entire sheet from editing.
     */
  protectSheet() {
    let protection = this.sheet.protect();
    Logger.log(`Protected sheet: ${this.sheet.getName()}`);
    return this;
  }

  /**
   * Removes protection from the entire sheet.
   */
  unprotectSheet() {
    let protections = this.sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    protections.forEach(protection => protection.remove());
    Logger.log(`Unprotected sheet: ${this.sheet.getName()}`);
    return this;
  }

  /**
   * Protects a specific column from editing.
   * @param {string|number} column - The column name or number to protect.
   */
  protectColumn(column) {
    if (typeof column === 'string') {
      column = this.getColumnFromFieldName(column);
    }
    let range = this.sheet.getRange(1, column, this.sheet.getMaxRows());
    let protection = range.protect();
    Logger.log(`Protected column: ${column} in sheet: ${this.sheet.getName()}`);
    return this;
  }

  /**
   * Unprotects a specific column.
   * @param {string|number} column - The column name or number to unprotect.
   */
  unprotectColumn(column) {
    if (typeof column === 'string') {
      column = this.getColumnFromFieldName(column);
    }
    let range = this.sheet.getRange(1, column, this.sheet.getMaxRows());
    let protections = range.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    protections.forEach(protection => protection.remove());
    Logger.log(`Unprotected column: ${column} in sheet: ${this.sheet.getName()}`);
    return this;
  }
} // end of ManagedSheet

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCaseInsensitiveHeaderMap_,
    normalizeManagedColumnSpec_,
    getManagedColumnHeader_,
    resolveManagedHeaderMap_,
    findRowIndexByNormalizedValue_,
    buildSharedHeaderCopyPlan_,
    sheetHasContent_
  };
}
