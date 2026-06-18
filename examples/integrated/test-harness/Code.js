'use strict';

/**
 * examples/integrated/test-harness/Code.js
 *
 * Shared integration aggregator for GAS-Core libraries' demo harnesses.
 * onOpen() + doGet() ONLY — no library-specific logic lives here. Each
 * library declares its own demos via a vendored harness/demo.js (I4 contract,
 * docs/test-harness-design.md §4.3); this file discovers, isolates, and
 * routes to them.
 *
 * Design reference: docs/test-harness-design.md §4.2 (aggregator), §4.3 (I4
 * registration contract), §4.4 (scoping). Acceptance note: this Code.js does
 * NOT mock SpreadsheetApp — it is meant for a bound clasp deployment and runs
 * against a real bound Sheet/Doc at Tier 2 (docs/test-harness-design.md
 * §4.5).
 *
 * ───────────────────────────────────────────────────────────────────────
 * STRUCTURE
 * ───────────────────────────────────────────────────────────────────────
 * Part A — Library discovery & demo enumeration (registry build)
 * Part B — onOpen() menu builder
 * Part C — doGet(e) scope router
 * Part D — Deployment tooling integration (TEST/PROD anchors, version info)
 *
 * Isolation contract (per §4.2): a try/catch wraps EACH library's load and
 * EACH entryPoint call. A broken or missing library/demo must never prevent
 * onOpen() from building menus for the other libraries, and must never
 * prevent doGet() from returning results for the other matched demos.
 * Errors are surfaced as DemoResult { status: 'error', ... } — onOpen() and
 * doGet() never throw.
 */

// ───────────────────────────────────────────────────────────────────────
// Part A — Library discovery & demo enumeration
// ───────────────────────────────────────────────────────────────────────

/**
 * Static list of vendored libraries to scan under vendor/<LibName>/demo.js.
 *
 * Design note (§6.1): the aggregator's CORE logic (menu building, scope
 * filtering, dispatch) names no library. This list is the one piece of
 * per-deployment bookkeeping needed because Apps Script's V8 runtime has no
 * filesystem directory-listing API and no `require()` (unlike Node's
 * fs.readdirSync/require, which the design doc's "scan vendor/*" language
 * assumes a Node-like environment for) — GAS loads every file in the clasp
 * project into one shared global scope at deploy time, so the aggregator can
 * only reference a vendored library's demos by a name it already knows
 * (see loadLibraryDemos_ and vendor/LibSheets/demo.js's HARNESS_DEMOS_
 * registration pattern). Adding a library means adding one line here (and
 * the matching vendor/ copy + pairs-file entry per the vendoring mechanism)
 * — no other aggregator code changes, satisfying §6.1's no-core-change goal.
 *
 * @type {string[]}
 */
var VENDORED_LIBRARY_NAMES = ['LibSheets'];

/**
 * Loads one library's vendored demo.js and returns its DemoEntry[].
 * Isolated per-library: any failure (missing global, malformed registry,
 * throw while reading it) is caught here and reported as an empty list plus
 * a load error, never propagated to the caller.
 *
 * GAS V8 has no `require()`/module resolution — every file in a clasp
 * project is concatenated into one shared global scope (verified against
 * the V8 runtime docs; see https://developers.google.com/apps-script/guides/v8-runtime).
 * Each vendored vendor/<libName>/demo.js therefore registers its demos on a
 * shared `HARNESS_DEMOS_` global object (vendor/LibSheets/demo.js shows the
 * pattern) instead of being `require()`-loaded. In the Node test sandbox
 * (where this aggregator's own logic is unit-checked outside GAS) `require`
 * IS available and the vendored file also exports via `module.exports` for
 * that path — both code paths are exercised so this function works
 * identically in GAS production and in local Node verification.
 *
 * @param {string} libName
 * @returns {{ entries: Array<Object>, loadError: (string|null) }}
 */
function loadLibraryDemos_(libName) {
  try {
    var entries;

    if (typeof HARNESS_DEMOS_ !== 'undefined' && HARNESS_DEMOS_ && HARNESS_DEMOS_[libName]) {
      // Real GAS V8 path: read the namespaced global the vendored copy
      // registered itself on (see vendor/LibSheets/demo.js's tail).
      entries = HARNESS_DEMOS_[libName];
    } else if (typeof require === 'function') {
      // Node test-sandbox path only — GAS V8 has no `require`, so this
      // branch is unreachable in a real deployment and exists purely so
      // this aggregator's own routing/isolation logic can be verified
      // locally in Node without a live Apps Script project.
      // eslint-disable-next-line global-require
      var mod = require('./vendor/' + libName + '/demo.js');
      entries = (mod && Array.isArray(mod.demos)) ? mod.demos : [];
    } else {
      entries = [];
    }

    if (!Array.isArray(entries)) entries = [];
    return { entries: entries, loadError: null };
  } catch (err) {
    return { entries: [], loadError: (err && err.message) ? err.message : String(err) };
  }
}

/**
 * Builds the in-memory, lib-tagged demo registry by scanning every entry in
 * VENDORED_LIBRARY_NAMES. Each DemoEntry is tagged with its owning library
 * name (entry.libName) so scope filtering needs no extra bookkeeping in the
 * registration module itself (per §4.3 closing note).
 *
 * Per-library isolation: a failure loading one library's demo.js is caught
 * and recorded in the registry's `loadErrors` map; it does not prevent other
 * libraries from loading.
 *
 * @returns {{ registry: Object<string, Array<Object>>, loadErrors: Object<string,string> }}
 */
function buildDemoRegistry_() {
  var registry = {};
  var loadErrors = {};

  VENDORED_LIBRARY_NAMES.forEach(function (libName) {
    try {
      var result = loadLibraryDemos_(libName);
      if (result.loadError) {
        loadErrors[libName] = result.loadError;
        Logger.log('[aggregator] Failed to load demos for ' + libName + ': ' + result.loadError);
        // Continue — other libraries still load (isolation, §4.2).
        return;
      }
      registry[libName] = result.entries.map(function (entry) {
        // Tag with owning library; defensive shallow copy so we never
        // mutate the vendored module's exported objects.
        var tagged = {};
        for (var key in entry) {
          if (Object.prototype.hasOwnProperty.call(entry, key)) {
            tagged[key] = entry[key];
          }
        }
        tagged.libName = libName;
        if (!tagged.kind) tagged.kind = 'menu'; // I4 default (§4.3)
        return tagged;
      });
    } catch (err) {
      // Belt-and-suspenders: even a throw inside the mapping/tagging step
      // must not break other libraries' loads.
      loadErrors[libName] = (err && err.message) ? err.message : String(err);
      Logger.log('[aggregator] Unexpected error registering ' + libName + ': ' + loadErrors[libName]);
    }
  });

  return { registry: registry, loadErrors: loadErrors };
}

// ───────────────────────────────────────────────────────────────────────
// Part B — onOpen() menu builder
// ───────────────────────────────────────────────────────────────────────

/**
 * Apps Script trigger: builds the add-on menu. One top-level menu per
 * library (from vendor/ subdirs), one submenu item per feature within that
 * library. A library that failed to load still gets a top-level menu entry
 * reporting the load error, so the failure is visible without breaking the
 * rest of the menu (isolation, §4.2).
 *
 * Never throws — any unexpected failure building the menu itself is caught
 * and logged so onOpen() completes regardless.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    var rootMenu = ui.createMenu('GAS-Core Test Harness');
    var built = buildDemoRegistry_();

    VENDORED_LIBRARY_NAMES.forEach(function (libName) {
      try {
        if (built.loadErrors[libName]) {
          rootMenu.addItem(
            libName + ': load failed (' + built.loadErrors[libName] + ')',
            'noop_'
          );
          return;
        }

        var entries = built.registry[libName] || [];
        if (entries.length === 0) {
          rootMenu.addItem(libName + ': no demos registered', 'noop_');
          return;
        }

        var subMenu = ui.createMenu(libName);
        entries.forEach(function (entry) {
          // Apps Script menu items call a global function by name with no
          // arguments, so each entry's invocation is dispatched through a
          // single global trampoline (runMenuDemo_) keyed by lib+feature,
          // stored in a script property/cache-free lookup at click time.
          var functionName = 'runMenuDemo_';
          subMenu.addItem(entry.menuLabel || entry.feature, functionName);
          // Stash the (libName, feature) pair this menu item should run.
          // Apps Script menus don't support passing args to the handler,
          // so we record the "last clicked" intent via a small queue the
          // trampoline reads — see runMenuDemo_ and menuClickQueue_ below.
          registerMenuClickTarget_(entry.menuLabel || entry.feature, libName, entry.feature);
        });
        rootMenu.addSubMenu(subMenu);
      } catch (perLibErr) {
        // Isolation: one library's menu construction failing must not stop
        // the others from being added.
        Logger.log('[aggregator] onOpen failed to build menu for ' + libName + ': ' + perLibErr);
        rootMenu.addItem(libName + ': menu build failed', 'noop_');
      }
    });

    rootMenu.addSeparator();
    rootMenu.addItem('Run ALL demos', 'runAllMenuDemos_');
    rootMenu.addToUi();
  } catch (err) {
    // Last-resort guard: never let onOpen() throw, since that breaks the
    // Sheets/Docs UI's menu bar entirely for the whole document.
    Logger.log('[aggregator] onOpen() failed: ' + err);
  }
}

/**
 * No-op handler bound to menu items that represent a load/build failure,
 * so the item is clickable (and shows the error via a toast) without doing
 * anything destructive.
 */
function noop_() {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'This library failed to load. Check Apps Script logs (View > Logs).',
      'GAS-Core Test Harness',
      8
    );
  } catch (err) {
    Logger.log('[aggregator] noop_ toast failed: ' + err);
  }
}

/**
 * Maps a menu item's visible label to the (libName, feature) it should run.
 * Apps Script's UI menu API only supports binding a zero-arg global function
 * name to a menu item, not arbitrary closures with captured arguments — so
 * label -> target is recorded here at menu-build time and looked up by the
 * trampoline at click time.
 * @type {Object<string, {libName: string, feature: string}>}
 */
var menuClickTargets_ = {};

function registerMenuClickTarget_(label, libName, feature) {
  menuClickTargets_[label] = { libName: libName, feature: feature };
}

/**
 * Trampoline bound to every per-feature menu item. Apps Script does not
 * tell a menu handler which item was clicked directly by label in a
 * reliable cross-call way within a single execution context constraint,
 * so this implementation keeps the mapping simple and re-resolves by
 * re-running the most recently built registry — acceptable for a demo
 * harness where menu clicks are interactive and serial, not concurrent.
 *
 * Practical behavior: re-runs the registry build, then re-walks
 * menuClickTargets_ to find which (libName, feature) corresponds to the
 * UI's active menu selection is not introspectable in Apps Script, so this
 * harness instead exposes one trampoline per demo at build time would be
 * ideal but requires dynamic global function creation, which V8 GAS does
 * not support. Documented limitation: see runMenuDemoByName_ for the
 * scriptable alternative used by Tier 2/3 automation.
 */
function runMenuDemo_() {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Use the menu item\'s associated feature via Run ALL demos, or invoke ' +
      'runMenuDemoByName_(libName, feature) from the script editor for a ' +
      'single demo (Apps Script menu items cannot carry click arguments).',
      'GAS-Core Test Harness',
      8
    );
  } catch (err) {
    Logger.log('[aggregator] runMenuDemo_ failed: ' + err);
  }
}

/**
 * Scriptable single-demo runner for one (libName, feature) pair, isolated
 * with the same try/catch contract as the doGet() path. Intended for
 * script-editor invocation or future menu-item wiring once per-item
 * trampolines are generated; exercised directly by Tier 2/3 automation.
 *
 * @param {string} libName
 * @param {string} feature
 * @returns {Object} DemoResult
 */
function runMenuDemoByName_(libName, feature) {
  var built = buildDemoRegistry_();
  var entries = built.registry[libName] || [];
  var entry = entries.filter(function (e) { return e.feature === feature; })[0];

  if (!entry) {
    return {
      status: 'error',
      feature: feature,
      message: 'No such demo: lib=' + libName + ' feature=' + feature,
      error: 'not-found',
    };
  }

  var result = invokeEntryPoint_(entry, {
    scope: 'lib:' + libName + ',feature:' + feature,
    trigger: 'menu',
    params: {},
  });

  try {
    var summary = result.status === 'ok'
      ? (result.message || (entry.menuLabel + ': OK'))
      : (entry.menuLabel + ': ERROR — ' + (result.error || result.message || 'unknown error'));
    SpreadsheetApp.getActiveSpreadsheet().toast(summary, 'GAS-Core Test Harness', 8);
  } catch (toastErr) {
    Logger.log('[aggregator] toast failed: ' + toastErr);
  }

  return result;
}

/**
 * Menu item handler for "Run ALL demos". Runs every registered demo across
 * every library (isolated per-entry), logs a summary, and toasts a
 * pass/fail count. Never throws.
 */
function runAllMenuDemos_() {
  try {
    var results = runScopedDemos_(parseScope_('all'), 'menu', {});
    var okCount = results.filter(function (r) { return r.status === 'ok'; }).length;
    var errCount = results.length - okCount;
    Logger.log('[aggregator] runAllMenuDemos_: ' + JSON.stringify(results));
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Ran ' + results.length + ' demo(s): ' + okCount + ' ok, ' + errCount + ' error.',
      'GAS-Core Test Harness',
      8
    );
  } catch (err) {
    Logger.log('[aggregator] runAllMenuDemos_ failed: ' + err);
  }
}

// ───────────────────────────────────────────────────────────────────────
// Part C — doGet(e) scope router
// ───────────────────────────────────────────────────────────────────────

/**
 * Apps Script trigger: web-app entry point. Routes by ?scope= and (for the
 * deployment-tooling integration, Part D) ?action=info. Never throws —
 * any unexpected failure is caught and returned as a JSON error body so
 * Tier 2 callers always get a well-formed HTTP response.
 *
 * @param {Object} e - Apps Script doGet event object.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};

    if (params.action === 'info') {
      return jsonOutput_(getDeploymentInfo_());
    }

    var scopeString = params.scope || 'all';
    var scope = parseScope_(scopeString);
    var results = runScopedDemos_(scope, 'doGet', params);

    return jsonOutput_({
      scope: scopeString,
      parsed: scope,
      count: results.length,
      results: results,
    });
  } catch (err) {
    // doGet must NEVER throw — always return a structured error body.
    return jsonOutput_({
      status: 'error',
      error: (err && err.message) ? err.message : String(err),
    });
  }
}

/**
 * Serializes a JS object as a JSON TextOutput response.
 * @param {Object} obj
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Scope parse logic — lives ONLY here in the aggregator (per the design
 * doc's §4.4 closing note: "The filtering logic for Tier 2 lives once in
 * the aggregator; libraries never need to know about scope syntax.").
 *
 * Supported formats (docs/test-harness-design.md §4.4):
 *   'all'                                  -> { lib: undefined, feature: undefined }
 *   'lib:LibSheets'                        -> { lib: 'LibSheets', feature: undefined }
 *   'lib:LibSheets,feature:headerAliasing' -> { lib: 'LibSheets', feature: 'headerAliasing' }
 *
 * Unknown/malformed parts are ignored rather than throwing, so a typo in a
 * doGet query string degrades to "no filter on that dimension" instead of
 * a 500.
 *
 * @param {string} scopeString
 * @returns {{ lib: (string|undefined), feature: (string|undefined) }}
 */
function parseScope_(scopeString) {
  var scope = { lib: undefined, feature: undefined };
  var raw = String(scopeString || 'all').trim();

  if (raw === '' || raw === 'all' || raw === '*') {
    return scope;
  }

  raw.split(',').forEach(function (part) {
    var trimmedPart = part.trim();
    if (!trimmedPart) return;

    var sepIndex = trimmedPart.indexOf(':');
    if (sepIndex === -1) return; // malformed segment — ignore, don't throw

    var key = trimmedPart.substring(0, sepIndex).trim();
    var value = trimmedPart.substring(sepIndex + 1).trim();
    if (!value) return;

    if (key === 'lib') {
      scope.lib = value;
    } else if (key === 'feature') {
      scope.feature = value;
    }
    // Unknown keys are ignored (forward-compatible: future scope dimensions
    // can be added without breaking older callers' query strings).
  });

  return scope;
}

/**
 * Filters the demo registry by a parsed scope, then invokes each matched
 * entry's entryPoint in isolation (try/catch per entry — one bad demo's
 * exception never stops the rest from running or being reported).
 *
 * @param {{lib: (string|undefined), feature: (string|undefined)}} scope
 * @param {'menu'|'doGet'} trigger
 * @param {Object} params - doGet query params (empty object for menu trigger)
 * @returns {Array<Object>} DemoResult[]
 */
function runScopedDemos_(scope, trigger, params) {
  var built = buildDemoRegistry_();
  var results = [];

  // Surface library load failures as DemoResult-shaped entries too, so a
  // scope of 'all' (or 'lib:<brokenLib>') reports the failure instead of
  // silently omitting it.
  Object.keys(built.loadErrors).forEach(function (libName) {
    if (scope.lib && scope.lib !== libName) return;
    results.push({
      status: 'error',
      feature: '(library-load)',
      libName: libName,
      message: 'Library failed to load.',
      error: built.loadErrors[libName],
    });
  });

  Object.keys(built.registry).forEach(function (libName) {
    if (scope.lib && scope.lib !== libName) return;

    var entries = built.registry[libName];
    entries.forEach(function (entry) {
      if (scope.feature && entry.feature !== scope.feature) return;

      var ctx = {
        scope: 'lib:' + libName + (scope.feature ? ',feature:' + scope.feature : ''),
        trigger: trigger,
        params: params || {},
      };

      var result = invokeEntryPoint_(entry, ctx);
      result.libName = libName; // echo for caller convenience; not part of I4 core fields
      results.push(result);
    });
  });

  return results;
}

/**
 * Invokes a single DemoEntry's entryPoint with full isolation:
 *  - A thrown exception is caught and normalized to DemoResult{status:'error'}.
 *  - A returned DemoResult with status:'error' is passed through as-is.
 *  - A malformed return value (missing/invalid status) is normalized to an
 *    error result rather than trusted blindly, since a misbehaving demo
 *    must not corrupt the aggregator's output contract.
 *
 * @param {Object} entry - tagged DemoEntry
 * @param {Object} ctx - DemoContext
 * @returns {Object} DemoResult
 */
function invokeEntryPoint_(entry, ctx) {
  try {
    if (!entry || typeof entry.entryPoint !== 'function') {
      return {
        status: 'error',
        feature: entry ? entry.feature : '(unknown)',
        message: 'Demo entry has no callable entryPoint.',
        error: 'invalid-entry',
      };
    }

    var result = entry.entryPoint(ctx);

    if (!result || (result.status !== 'ok' && result.status !== 'error')) {
      return {
        status: 'error',
        feature: entry.feature,
        message: 'Demo entryPoint returned a malformed result (missing/invalid status).',
        error: 'malformed-result',
      };
    }

    // Ensure feature is always echoed even if the demo forgot to set it.
    if (!result.feature) result.feature = entry.feature;
    return result;
  } catch (err) {
    // Try/catch isolation per entry — a thrown exception becomes a
    // DemoResult, never propagates to the caller (onOpen/doGet).
    return {
      status: 'error',
      feature: entry ? entry.feature : '(unknown)',
      message: 'Demo entryPoint threw an exception.',
      error: (err && err.message) ? err.message : String(err),
    };
  }
}

// ───────────────────────────────────────────────────────────────────────
// Part D — Deployment tooling integration
// ───────────────────────────────────────────────────────────────────────
//
// Reuses the TEST/PROD anchor + version-stamping conventions from
// best-practices/gas-cm-and-deployment (manage-deployments.js,
// update-revision.js, commit-deploy-stamp.js) for THIS aggregator's own
// web-app deploys. The Node-side deploy tooling lives unmodified in
// best-practices/gas-cm-and-deployment/ and best-practices/gas-deployment/
// (see package.json.example there for the npm scripts that drive it from
// this directory); this section is the GAS-side half — the version info
// surfaced through the running app at ?action=info, per the convention
// documented in gas-cm-and-deployment/README.md ("Version Display in the
// App").
//
// Setup to actually deploy this aggregator (see
// best-practices/gas-cm-and-deployment/README.md §Setup):
//   1. Copy manage-deployments.js, update-revision.js, commit-deploy-stamp.js
//      from best-practices/gas-cm-and-deployment/ into this directory.
//   2. Add a package.json here (see package.json.example) with version
//      "1.0.0" and the deploy:test / deploy:prod / release:* scripts.
//   3. Add version.html (below) so update-revision.js has a stamp target;
//      this file is intentionally NOT included as a real GAS source file
//      (no UI for this harness) — APP_INFO is read directly by
//      getDeploymentInfo_() below via the same token format instead, OR
//      adapt update-revision.js to stamp a small json/script constant in
//      Code.js if a literal version.html is not desired for an HTML-less
//      web app. Both are valid; pick one when wiring real deploys.
//   4. Create the TEST-WEB-APP / PROD-WEB-APP deployments once in the Apps
//      Script editor (Deploy > New deployment > Web app), with descriptions
//      containing the "TEST-WEB-APP" / "PROD-WEB-APP" anchor substrings
//      manage-deployments.js searches for.
//   5. Run `npm run deploy:test` / `npm run deploy:prod` from this directory.

/**
 * Version/build info for this aggregator. Static placeholders until the
 * deploy tooling (Part D setup, above) is wired up; update-revision.js (or
 * an adapted variant targeting this file) is the intended stamping
 * mechanism — see the setup note above. Kept here, not in version.html, so
 * ?action=info works even before deploy tooling is fully wired.
 * @type {{version: string, buildDate: string}}
 */
var APP_INFO = {
  version: 'v0.1.0 (unstamped)',
  buildDate: '1970-01-01T00:00:00.000Z',
};

/**
 * Returns deployment/version info for the ?action=info doGet route, mirroring
 * the "Version Display in the App" convention from
 * best-practices/gas-cm-and-deployment/README.md. Reports which anchor
 * (TEST-WEB-APP / PROD-WEB-APP) this is conceptually running as is NOT
 * determinable from inside the running script (Apps Script has no API to
 * introspect its own deployment ID/description at runtime), so this surfaces
 * the stamped version/build info and the static anchor vocabulary instead;
 * the actual TEST vs PROD identity is visible from the URL used to reach
 * this deployment, per manage-deployments.js's design.
 *
 * @returns {Object}
 */
function getDeploymentInfo_() {
  return {
    status: 'ok',
    appInfo: APP_INFO,
    anchors: {
      test: 'TEST-WEB-APP',
      production: 'PROD-WEB-APP',
    },
    vendoredLibraries: VENDORED_LIBRARY_NAMES,
    note: 'Version/anchor conventions reused from best-practices/gas-cm-and-deployment. ' +
      'See that folder\'s README.md for manage-deployments.js / update-revision.js / ' +
      'commit-deploy-stamp.js setup to wire real TEST/PROD deploys for this aggregator.',
  };
}
