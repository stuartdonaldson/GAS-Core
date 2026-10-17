# i13-boundary-audit

A declarative, CI-runnable ESLint check for DevStandard **I13 — platform-boundary ownership**
(`$DEVSTANDARD/test-framework/sdlc-implementation-principles.md`; GAS mechanism documented in
`GAS-Core/best-practices/README.md` §"Platform-boundary ownership (I13 in GAS)"). Reuses
`GActionSheet/eslint.config.js`'s `gasGlobals` list and `collectProjectGlobals` scanner (vendored,
see `lib/gasGlobals.js` and `lib/collectProjectGlobals.js` for the copy-and-reason note) rather
than re-deriving them.

**It exists because grep is not enough.** The 2026-09-14 first-pass I13 audit was done by hand
grep and broke in both directions at once: it **under-reported** `PropertiesService` (missed that
GAS-Core had three namers, one a genuine breach) and **over-reported** `UrlFetchApp` (flagged two
files that call two different remote services through the same SDK function as if they were
duplicate owners). This tool fixes the mechanical half of that — enumerating identifier usage
against a declared map — and is explicit about the half it cannot fix. Read "What this tool does
and does not check" below before trusting a green run.

## The core design rule: nothing here is estate-wide

GAS-Core ships **no ownership map** and **no list of exemptions**. Both are project-declared
config, read by this tool, never invented or defaulted by it:

- A project with **no** `i13.config.js` (or an empty `ownership` map) gets **no enforcement** —
  a silent no-op, never a wall of false failures.
- A project that declares an ownership map is enforced against exactly that map, nothing wider.
- Every exception is a first-class, reasoned config entry — never a suppression comment
  convention. **An exception without a `reason` is a config error, not a silent pass.**

This is what "declared, not assumed" (I13's own framing) means mechanically: the tool enforces a
declaration; it does not go looking for one.

## Config shape

A project's own `i13.config.js` (see `i13.config.example.js` in this package for the full,
commented version):

```js
module.exports = {
  // identifier -> the file(s) that alone may name it. Globs are relative to whatever baseDir
  // you pass (normally your project root, or wherever your eslint.config.js's `files` globs
  // are relative to).
  ownership: {
    PropertiesService: ['gas-webapp-admin/Admin.js', 'gas-server-logging/GasLogger.js'],
    UrlFetchApp: ['gas-webapp-admin/Admin.js', 'gas-server-logging/AxiomLogger.js'],
    DriveApp: ['gas-server-logging/GasLogger.js'],
  },

  // documented, reasoned deviations. Each entry MUST carry a non-empty `reason` — omitting one
  // is a thrown config error (buildI13Blocks / listExceptions both validate), never a silent
  // pass. Enumerable: `listExceptions(config)` prints every exception a project currently
  // relies on.
  exceptions: [
    {
      identifier: 'PropertiesService',
      file: 'src/Gate.js',
      reason:
        'NDocs-40d: known breach, ADMIN_GROUP_EMAIL read outside DirectoryAdapter.js. ' +
        'Tracked for retrofit; Gate.js owns no boundary so the connection-parameter clause ' +
        'does not apply here.',
    },
  ],
};
```

### Worked example: the `UrlFetchApp` case (why ownership is per-identifier, not per-project)

`ownership.UrlFetchApp` above names **two** files: `Admin.js` and `AxiomLogger.js`. That is
correct, not a duplication — `Admin.js` calls Google's `tokeninfo` endpoint; `AxiomLogger.js`
calls Axiom's ingest endpoint. Two unrelated remote contracts sharing one SDK function. A human
decided that when writing this entry. **This tool cannot make that decision** — see the next
section.

## What this tool does and does not check

I13's first load-bearing clause: *"the owned unit is the (boundary, operation) pair, identified
by the remote contract, not the SDK function name."* ESLint sees the identifier `UrlFetchApp`. It
does not see, and cannot see, "Axiom ingest" vs. "Google tokeninfo" — that is not a syntactic
fact about the file, it is a fact about which URL a `.fetch()` call targets at runtime, buried in
a string or a variable computed several calls away. No amount of engineering around this closes
the gap; it is a human call, made once, when the ownership map is written.

Concretely: `ownership.UrlFetchApp: ['Admin.js', 'AxiomLogger.js']` reads, to this tool, as "two
files may name `UrlFetchApp`." It has no way to confirm those two files are calling different
services rather than the same one twice (which WOULD be a real I13 breach — a duplicated
operation, not two operations). That confirmation is the ownership map author's job, not this
tool's.

**A green run means: every governed identifier is named only where its declared map says it may
be.** It does not mean I13 is fully discharged — the (boundary, operation) grouping itself, and
whether `T14`'s conformance-test obligation is met for each real boundary operation, both stay
outside this tool's reach. Anyone reading a green run should read it as "identifier confinement
holds against what this project declared," not "I13 is done here."

The type half of I13 (the draft type-leak amendment, `knowledge-base/proposals/i13-type-leak-amendment-draft.md`,
unruled, DevStandard-82fh) is covered only partially, by the opt-in check in the next section. Read
"Soundness limits" there before treating a green run as the amendment discharged.

## Type-leak check (opt-in; GAS-Core-0ws)

The identifier rule cannot see a module that is the sole owner of `SpreadsheetApp` and still hands a
raw `Sheet` to every caller. Because I13 confines the platform identifier to one file, a raw
platform object can only *originate* in the owning file, so the check is intra-file. It is
declared, not inferred, and consumes the amendment's DRAFT wording without presuming the ruling.

Config additions (all optional; any missing declaration is a silent no-op for that tier):

```js
platformTypes: ['Sheet', 'Spreadsheet', 'Range', 'Folder', 'File', 'Blob'],
publicSurface: {            // owner-file glob -> function-name glob(s) forming its exported surface
  'src/SheetAdapter.js': 'SheetAdapter_*',   // e.g. NDocs' Module_function convention
},
// optional:
requireReturns: false,      // true: a surface function that returns a value must carry @returns
extraHandleMethods: [],     // extra SDK method names that return a platform handle (Tier B)
handleMethods: [...],       // or replace the built-in list (lib/gasHandleMethods.js)
```

Both tiers examine only **top-level functions in a file matching a `publicSurface` key whose name
matches that key's pattern**. Nothing else is ever reported: not private helpers, not nested
functions, not files with no surface declaration.

- **Tier A (JSDoc surface).** A surface function whose `@returns` / `@param` type names a
  `platformTypes` entry (including inside unions, generics, arrays, record types and
  `GoogleAppsScript.*.Sheet`-style namespaces) is reported at the tag's line. `requireReturns`
  additionally reports a value-returning surface function with no `@returns`, narrowing the hole
  from "unannotated" to "misannotated"; it is off by default because it fires on every
  unannotated function in a project that has not adopted the annotation discipline yet.
- **Tier B (intra-file return taint).** For each surface function, each `return` expression is
  resolved through ESLint scope analysis (variable initialisers and reassignments, `||`/`&&`,
  `?:`, `await`) back to a governed global from `ownership`, and propagated only through calls
  to handle-returning SDK methods (`getSheetByName`, `openById`, `getRange`, ...). So
  `return SpreadsheetApp.openById(id).getSheetByName(n)` is reported, while
  `return SpreadsheetApp.openById(id).getUrl()` and `.getValues()` are not. It is gated on the
  surface declaration: a private helper handing a raw `Spreadsheet` to another function inside
  the owning file is a legitimate internal handoff and is never reported; only an escape from a
  surface function is.

`bin/i13-audit.js` reports both rules (`[i13/boundary-ownership]`, `[i13/type-leak]`).

### Soundness limits (read before trusting a green run)

Neither tier is sound. Only a real type checker is (tracked separately as the `tsc --checkJs`
decision; this package installs no TypeScript).

- **Tier A verifies a declaration, not a value.** It proves the JSDoc does not *say* `Sheet`. A
  function annotated `@returns {Store}` that actually returns a raw `Sheet` passes. A missing
  annotation passes unless `requireReturns` is on, and even then a *wrong* annotation passes.
  Only `@returns` / `@param` are read; `@typedef`, `@type`, `@callback`, and types split across
  lines are not.
- **Tier B loses the trail** through:
  - **object properties**: `return { sheet: sheet }`, `return holder.sheet`;
  - **array elements**: `return [sheet]`, `return sheets[0]`, destructuring;
  - **callbacks**: a raw object handed to or returned from a function passed as an argument,
    including returns inside `.map(...)` and the like (those belong to the callback);
  - **values returned from helper calls**: `return _helper()` where `_helper` returns a raw
    object is not followed (the analysis does not cross function boundaries, even inside the
    file);
  - SDK handle-returning methods not in the built-in list (a missed leak by design: the opposite
    default would flag every `.getUrl()`), enum/constant objects (`SpreadsheetApp.Dimension`),
    and any tainted value reaching the surface by a path other than `return` (a module-level
    variable the caller reads, a global assigned inside a function).
- **Scope.** Only top-level functions matching the declared surface pattern are examined; the
  surface itself is a declaration, so a function the pattern does not name is out of reach.

**A green run covers:** no surface function *declares* a platform type in `@returns`/`@param`, and
none returns a value that visibly derives from a governed global through variables and listed
handle methods in the same function. **It does not cover** the amendment's actual obligation: that
the owner's exported surface names no platform type and every handle it returns is a type the owner
defines. A green run must never be read as the amendment discharged, in the same sense that the
identifier check's green run is not "I13 done".

## Using it in CI

Merge `buildI13Blocks()` into your project's own flat `eslint.config.js` (the file that already
declares your GAS globals, following `GActionSheet/eslint.config.js`'s pattern):

```js
const { buildI13Blocks } = require('i13-boundary-audit'); // or a relative path to this package
const i13Config = require('./i13.config.js');

module.exports = [
  {
    files: ['src/**/*.js'],
    languageOptions: { /* ...your existing gasGlobals + collectProjectGlobals setup... */ },
    rules: { /* ...your existing no-undef etc... */ },
  },
  ...buildI13Blocks(i13Config, { files: ['src/**/*.js'], baseDir: __dirname }),
];
```

Then it runs as part of your normal `eslint` invocation — and therefore your normal CI — with no
separate tool to install or invoke. A project with no `i13.config.js` can add this line with zero
effect until it writes one (AC2's silent no-op).

### Out-of-repo verification / no eslint.config.js yet

`bin/i13-audit.js` is a convenience CLI for the two cases that don't fit the path above: checking
a project without editing it (a scratch config elsewhere pointed at its `--src`), and measuring
raw retrofit cost before any ownership map exists:

```
node bin/i13-audit.js --src <dir> --config <path-to-i13.config.js>   # enforce + report
node bin/i13-audit.js --src <dir> --config <path> --list-exceptions  # print the exception inventory only
node bin/i13-audit.js --src <dir> --measure                          # raw per-identifier retrofit-cost scan
```

`--measure` is deliberately **not** the enforcement path — it never reads an `i13.config.js` and
produces no pass/fail, only a per-identifier file/occurrence count. It answers "how big would
this be" so a project can decide whether to adopt, not "is this correct" (see the limit above for
why those two questions are answered by different amounts of tooling).

## Dependencies

This package does not bundle `eslint` — it declares it as a `peerDependency` and expects to run
inside whatever `eslint` a consuming project already has (the normal CI-integrated path). The
`bin/i13-audit.js` CLI requires `eslint` to be resolvable from wherever it's invoked (a project's
own `node_modules`, or `NODE_PATH` pointed at one) and fails with a clear message if it isn't.

## Why a custom rule, not stacked `no-restricted-globals` blocks

The mechanism scoped for this work (GAS-Core-o4j) was "`no-restricted-globals` with per-owner
overrides": one ESLint flat-config block per governed identifier, each restricting to everyone
except its declared owner(s) via `ignores`. That was tried first and does not work once a project
governs more than one identifier: ESLint's flat-config cascade merges the `rules` object **by
key** across every block matching a given file, and the *last* matching block wins for that key.
With N identifier blocks all matching the same file glob (differing only in `ignores`), only the
last-declared identifier's restriction ever actually applied to any file — confirmed directly
while running AC5 against NDocs, where a five-identifier ownership map reported zero findings
instead of the five known ones.

`lib/rules/boundaryOwnership.js` is a small custom rule that receives the whole ownership map and
exception list as options and does the per-identifier, per-file decision itself in one rule
application. It is built on the identical underlying mechanism `no-restricted-globals` uses
internally (resolve the identifier's references in the global scope, report each one) — it just
does it once per file for every governed identifier instead of once per identifier via
cascade-merged config, which is what avoids the collision. `test/rule.test.js`'s "multiple
governed identifiers are all enforced on the same non-owner file" test is the regression net for
this.

## Verified against

`test/ownership.test.js`, `test/rule.test.js` and `test/typeLeak.test.js` (`npm test`, needs `eslint` resolvable — see
Dependencies). Run against NDocs (`src/`) for AC5: a five-identifier ownership map
(`PropertiesService`, `SpreadsheetApp`, `AdminDirectory`, `CacheService`, `ScriptApp`) correctly
reported exactly the two known breaches from `NDocs-40d` — `Gate.js` (lines 50, 164, 199) and
`H_Admin.js` (lines 25, 43), five findings total, zero elsewhere — with no `i13.config.js` written
into NDocs itself (a scratch config outside the repo was used).
