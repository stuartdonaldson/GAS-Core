'use strict';

/**
 * Vendored from GActionSheet/eslint.config.js (`gasGlobals`, as of the commit read for
 * GAS-Core-o4j, 2026-09-14). Copied rather than required because GAS-Core is not a runtime
 * dependency of GActionSheet (the relationship is the other direction — GActionSheet consumes
 * GAS-Core packages), so there is no import path back. Re-derivation was rejected per the bead:
 * this is a hand-curated "what GAS built-in services actually get used" list, not something a
 * scanner can regenerate, and copying keeps this tool's default identifier set aligned with the
 * shape that list already proved out in production use.
 *
 * This is a DEFAULT/seed list only. A consuming project's own `languageOptions.globals` (its
 * existing eslint.config.js) remains the source of truth for what identifiers are in scope —
 * this tool's rule blocks (see lib/ownership.js) act on whatever identifiers the ownership map
 * names, regardless of whether they appear here. `gasGlobals` is exported so a consumer building
 * a *standalone* config (no pre-existing eslint.config.js — see bin/i13-audit.js) has a sane
 * starting point instead of re-typing the GAS service list from scratch.
 */
const gasGlobals = {
  // Core services
  SpreadsheetApp: 'readonly',
  DocumentApp: 'readonly',
  DriveApp: 'readonly',
  CardService: 'readonly',
  ContentService: 'readonly',
  HtmlService: 'readonly',
  PropertiesService: 'readonly',
  ScriptApp: 'readonly',
  LockService: 'readonly',
  CacheService: 'readonly',
  UrlFetchApp: 'readonly',
  Session: 'readonly',
  Utilities: 'readonly',
  Logger: 'readonly',
  MimeType: 'readonly',
  MailApp: 'readonly',
  GmailApp: 'readonly',
  FormApp: 'readonly',
  CalendarApp: 'readonly',
  // Advanced services (commonly enabled via appsscript.json enabledAdvancedServices)
  Drive: 'readonly',
  DriveV3: 'readonly',
  AdminDirectory: 'readonly',
  Docs: 'readonly',
  Sheets: 'readonly',
  Gmail: 'readonly',
  // V8 runtime
  console: 'readonly',
};

module.exports = { gasGlobals };
