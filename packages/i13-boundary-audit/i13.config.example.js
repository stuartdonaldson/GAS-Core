'use strict';

/**
 * Worked example — i13.config.js
 *
 * This is a project-level config file. It is NOT shipped or read by GAS-Core; each consuming
 * project writes its own and passes it to buildI13Blocks()/buildStandaloneConfig() from its own
 * eslint.config.js (see README.md "Using it in CI"). Nothing here is estate-wide default — a
 * project with no such file gets no enforcement (silent no-op, AC2).
 *
 * The example below is GAS-Core's OWN modules, from best-practices/README.md
 * "Platform-boundary ownership (I13 in GAS)" §Disposition — reused here because it is a real,
 * already-reasoned-about case, not because GAS-Core ships this file as a default for consumers.
 *
 * File globs are relative to the directory `--src` (or a project's own eslint `files` root)
 * points at.
 */
module.exports = {
  // ownership: identifier -> the file(s) that alone may name it. One entry per GOVERNED
  // boundary identifier; identifiers with no entry here are simply not checked (a project
  // opts an identifier IN by declaring it, rather than opting the estate OUT of a default).
  ownership: {
    // Sole owner of the Drive log sink (DriveApp/Utilities/MimeType too, in a real config —
    // this worked example only shows PropertiesService/UrlFetchApp for brevity).
    // PropertiesService also appears here even though GasLogger.js does not "own the property
    // store" in general — the connection-parameter clause (I13) covers its own read of
    // GAS_LOGGER_FOLDER_ID, which is why it is a legitimate owner-declaration and not an
    // exception.
    PropertiesService: [
      'gas-webapp-admin/Admin.js', // property STORE as subject (setScriptProperties route)
      'gas-server-logging/GasLogger.js', // its own Drive-sink connection parameter
      'gas-server-logging/AxiomLogger.js', // its own Axiom connection parameters
    ],

    // The worked (boundary, operation) example the README's §Limit points at: UrlFetchApp is
    // named in two files here, and that is CORRECT, not a duplication — Admin.js calls Google's
    // tokeninfo endpoint, AxiomLogger.js calls Axiom's ingest endpoint. Two unrelated remote
    // contracts sharing one SDK function. This tool cannot see that distinction; a human
    // decided it when writing this ownership entry. See README.md.
    UrlFetchApp: ['gas-webapp-admin/Admin.js', 'gas-server-logging/AxiomLogger.js'],

    DriveApp: ['gas-server-logging/GasLogger.js'],
    SpreadsheetApp: ['libs/LibSheets/libSheets.js'],
  },

  // exceptions: documented, REASONED deviations from the ownership map above. Each entry
  // suppresses enforcement for exactly one (identifier, file) pair. An entry without a
  // non-empty `reason` is a config error (buildI13Blocks/listExceptions throw) — never a
  // silent pass. Empty array is the common case; this is not a place to accumulate debt quietly.
  exceptions: [
    // Example shape only — GAS-Core's real audit (best-practices/README.md) currently carries
    // NO exceptions; every module conforms on the merits. Left here so the shape is visible:
    //
    // {
    //   identifier: 'PropertiesService',
    //   file: 'src/Gate.js',
    //   reason:
    //     'NDocs-40d: known breach, ADMIN_GROUP_EMAIL read outside DirectoryAdapter.js. ' +
    //     'Tracked for retrofit; Gate.js owns no boundary so this is NOT the connection-' +
    //     'parameter clause.',
    // },
  ],
};
