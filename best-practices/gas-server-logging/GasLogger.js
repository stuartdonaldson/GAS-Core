/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

/**
 * Drive-mapped file logging for server-side test validation.
 *
 * Accumulates log entries during a GAS execution and writes them as a single
 * NDJSON file (one JSON object per line) to a Drive folder on flush().
 * Playwright tests read the files via the locally-mapped drive path.
 *
 * Setup (run once from GAS editor):
 *   setupGasLogger('FOLDER_ID_FROM_DRIVE_URL');
 *
 * Usage:
 *   GasLogger.log('tag', { key: value });   // accumulate + Logger.log()
 *   GasLogger.flush();                       // call at end of each server fn (success + catch)
 *
 * Enable/disable:
 *   GasLogger.disable();  // log() still calls Logger.log() but skips Drive writes
 *   GasLogger.enable();
 */
var GasLogger = {
  _folder: null,
  _entries: [],
  _enabled: true,

  _getFolder: function() {
    if (!this._folder) {
      var folderId = PropertiesService.getScriptProperties().getProperty('GAS_LOGGER_FOLDER_ID');
      if (folderId) {
        try {
          this._folder = DriveApp.getFolderById(folderId);
          return this._folder;
        } catch (e) {
          Logger.log('[GasLogger] GAS_LOGGER_FOLDER_ID invalid, falling back to name lookup: ' + e);
        }
      }
      // Fallback: find or create by name
      var root = DriveApp.getRootFolder();
      var iter = root.getFoldersByName('ATC-Dev');
      if (iter.hasNext()) {
        this._folder = iter.next();
      } else {
        Logger.log('[GasLogger] WARNING: GAS_LOGGER_FOLDER_ID not set and no ATC-Dev folder found — creating one');
        this._folder = root.createFolder('ATC-Dev');
      }
    }
    return this._folder;
  },

  log: function(tag, data) {
    var entry = { ts: new Date().toISOString(), tag: tag, data: data };
    Logger.log('[GasLogger] ' + JSON.stringify(entry));
    if (!this._enabled) return;
    this._entries.push(entry);
  },

  flush: function() {
    if (this._entries.length === 0) return;
    try {
      var filename = new Date().getTime() + '-' + Utilities.getUuid() + '.log';
      this._getFolder().createFile(
        filename,
        this._entries.map(function(e) { return JSON.stringify(e); }).join('\n'),
        MimeType.PLAIN_TEXT
      );
    } catch (e) {
      Logger.log('[GasLogger] flush failed: ' + e);
    }
    this._entries = [];
  },

  enable: function() { this._enabled = true; },
  disable: function() { this._enabled = false; }
};

/** Run from GAS editor to verify Drive write and flush. */
function testGasLogger() {
  GasLogger.log('test', { message: 'hello from GasLogger', value: 42 });
  GasLogger.log('test', { message: 'second entry', value: 99 });
  GasLogger.flush();
  Logger.log('testGasLogger complete — check folder for new .log file');
}
