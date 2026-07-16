# Best Practice: GAS Server-Side Logging (Axiom + Drive Fallback)

## Overview

Google Apps Script execution logs are ephemeral — visible only in the Apps Script editor, discarded after execution, and not reachable from outside the GAS environment. This pattern bridges that gap with two sinks, but **only one is active at a time**:

1. **Axiom** (recommended) — a hosted log-query service. Its driver lives entirely in `AxiomLogger.js`; copy it in alongside `GasLogger.js` and once `AXIOM_TOKEN`/`AXIOM_DATASET` script properties are set, `flush()` POSTs exclusively to Axiom. Query it with `query-axiom.py`/`gas-log-helpers.js` or the Axiom web UI. No local Drive mount needed, works from CI.
2. **Drive NDJSON files** (used only when no other driver is configured) — `GasLogger.js`'s own built-in driver, no extra file needed. GAS writes entries to a Drive folder mapped locally via Drive for Desktop. Used by Playwright/Node tests via `gas-log-helpers.js`'s file driver.

`flush()` routes to **exactly one** driver — it does not write Drive *and* POST to Axiom, and a failed Axiom POST does **not** fall back to writing the Drive file. This is intentional, not a corner cut: see "Why Axiom-exclusive, not best-effort" below. **You can adopt this pattern with Drive only and add Axiom later with zero code changes to GasLogger.js** — just copy in `AxiomLogger.js` and set the two script properties; `flush()`'s behavior switches automatically. See "Sink Architecture" below for how a third driver would be added, and why that isn't built as a full plugin registry yet.

**Provenance:** Evolved from AudioTrackCombiner's original Drive-only logger (history in this repo's earlier revisions of this folder), then extended in [GActionSheet](../../../GActionSheet) (`src/GasLogger.js`, `scripts/query_axiom.py`, `tests/helpers/gas_log.py`, ADR-0019, ADR-0020) with Axiom support, cross-execution correlation (`parentOp`), and — as of GActionSheet's `GTaskSheet-ishz.3/.5/.7` — the Axiom-exclusive flush + sentinel-watermark wait pattern described below. The `run()`/`logError()` entry-point wrapper, PII-masking helpers, and the pattern of unit-testing `GasLogger.js`'s pure functions with plain Node (`test_gas_logger.js`) were pulled in from a parallel line of development in `~/proj/F3Go30` (`script/GasLogger.js`), which forked from an earlier GActionSheet port and added those independently. `gas-log-helpers.js`'s `axiomProbeLatency`/`assertGasLog`/`assertNoGasLog` are a Node port of GActionSheet's `tests/helpers/gas_log.py` (`axiom_probe_latency`/`assert_log`/`assert_no_log`) — the sentinel-watermark *pattern* was already documented below, but the reusable implementation hadn't been ported to the Node helper until now.

---

## Quick Start (New Project)

1. Copy `GasLogger.js` into your GAS project's `src/` (or equivalent). This alone gives you the Drive driver — no Axiom setup required.
2. Copy `AxiomLogger.js` alongside it if you want Axiom as a sink. Skip if Drive-only is enough for now; add it later with zero changes to `GasLogger.js`.
3. Copy `gas-log-helpers.js` **and** `axiom-log-helpers.js` into your test directory (for Node/Playwright tests) — `gas-log-helpers.js` requires the latter, so both are needed even if you're only using the file driver today. Skip both if you only need `query-axiom.py`'s CLI querying.
4. Copy `query-axiom.py` into your project (for pulling logs back down from the command line). Skip if you're only using Drive.
5. Copy `local.settings.example.json` → `local.settings.json` (already gitignored at the repo root — verify your project's `.gitignore` covers it too) and fill in values.
6. Follow **One-Time Setup** below (Drive folder first; Axiom is optional and can be done later).
7. Call `GasLogger.log(tag, data)` at points of interest and `GasLogger.flush()` in a `finally` block at the end of every entry point (`doGet`, `doPost`, menu-triggered functions, etc.) — or just wrap the entry point in `GasLogger.run(fn)`, see **How to Use the Logger** below.
8. Run `testGasLogger()` from the Apps Script editor once to confirm the active driver works (Drive file if no other driver is configured yet, or the Axiom dataset's Stream tab once `AxiomLogger.js` is set up).

---

## How to Use the Logger

Preferred — wrap the entry point with `run()` so `startOp`/`endOp`/`flush` happen automatically, including on early returns and thrown errors:

```javascript
function doGet(e) {
  return GasLogger.run(function () {
    GasLogger.log('doGet.start', { route: e.parameter.route });
    var result = handleRoute(e);
    GasLogger.log('doGet.done', { ok: true });
    return result;
  });
}
```

`run()` rethrows after logging (tag `'error'`, via `logError()`) so a thrown error still surfaces as a failed execution (trigger-failure email, executions log) while guaranteeing the accumulated entries aren't lost. Apps Script has no execution-end hook, so any entry point relying on a hand-written `flush()` at every return path is one missed `return` away from silently dropping entries — `run()` makes that failure mode structurally impossible for the function it wraps.

Manual equivalent, useful when you need finer control (e.g. a dispatcher that must return a JSON error response instead of letting `run()`'s catch rethrow — use `GasLogger.logError()` there too, so the shape matches):

```javascript
function doGet(e) {
  GasLogger.startOp();                              // correlate everything below under one id
  try {
    GasLogger.log('doGet.start', { route: e.parameter.route });
    var result = handleRoute(e);
    GasLogger.log('doGet.done', { ok: true });
    return result;
  } catch (err) {
    GasLogger.logError('doGet.error', err);
    throw err;
  } finally {
    GasLogger.endOp();
    GasLogger.flush();   // ALWAYS flush here — success and error paths both need it
  }
}
```

Rules of thumb:
- Prefer `GasLogger.run(fn)` over hand-rolled `startOp`/`try`/`finally`/`flush` — see above.
- `flush()` in every entry point's `finally` block — not just on success — if you're not using `run()`.
- `startOp()`/`endOp()` around one logical operation so its sub-events share a queryable `op` id; skip them for simple one-log-call functions.
- Don't call `flush()` after every single `log()` — let the 25-entry buffer threshold or end-of-request flush batch writes (see Flush Strategy below).
- In production deployments where you don't need the trail, call `GasLogger.disable()` once at startup — `log()` still calls `Logger.log()` (visible in `clasp logs`) but skips the Drive/Axiom write entirely.
- If one execution calls into another over HTTP (e.g. an addon calling its own WebApp), use `GasLogger.getCurrentOp()` to read this execution's `op` id before the `UrlFetchApp` call, pass it in the request payload, and have the receiving execution call `GasLogger.startOp(receivedOpId)` — see **Cross-Execution Correlation** below.
- Never pass a raw email address or person's name into `data` — mask it first with `maskPiiForLog_()` (names/single addresses) or `maskRecipientListForLog_()` (comma-separated recipient lists, including the `'Display Name <email>'` form). Both keep the first/last character and collapse the middle to `'...'`; an email's domain is left fully visible for filtering.

---

## Naming Conventions

Adopted from GActionSheet's ADR-0019 and ADR-0020 (written after auditing ~190 real call sites and finding three incompatible tag-casing conventions and two data-key inconsistencies — both invisible to Axiom but expensive on the dashboard side, since they silently split what should be one facet bucket). Follow these from the first call site so you don't need a later cleanup pass.

### Tags (ADR-0019)

Every `GasLogger.log(tag, data)` tag is `domain.event[.subEvent...]`:
- `domain` — lowercase, camelCase if multi-word; names the feature/entry point (`sync`, `teamScope`, `importSelected`) — not the file it lives in.
- `event` — lowercase verb/state (`start`, `done`, `error`, `warn`, `complete`).
- Never a bare domain with no event — pick the specific lifecycle point (`.start`, `.done`, `.error`, `.warn`) the call represents.

### Data keys (ADR-0020)

| Concept | Key | Notes |
|---|---|---|
| Human-readable description | `msg` | Pairs with `err` when there's an underlying error |
| Error value/exception | `err` | String or `Error`; never `error` |
| Operation succeeded | `ok` | Boolean |
| Entity exists / was matched | `found` | Boolean |
| Count of N | `<noun>Count` | e.g. `docCount`, `rowCount` |
| Entity ids | `docId`, `sheetId`, ... | camelCase, unless deliberately echoing a snake_case wire contract |
| **Reserved — never set inside `data`** | `version`, `op`, `parentOp`, `ts`, `tag` | Auto-stamped by `GasLogger.log()` / `startOp()` |

If a call can fail, use `msg` (what was being attempted) + `err` (the exception). Don't invent a third spelling for either.

---

## Architecture

```
GAS execution                                      Dev host / CI
─────────────────────                              ──────────────────────
doGet / doPost called
  │
  ├─ GasLogger.log(tag, data)
  ├─ GasLogger.log(tag, data)
  └─ GasLogger.flush()
        │
        ├─ if AXIOM_TOKEN + AXIOM_DATASET set ──► Axiom dataset           query-axiom.py /
        │   (POST /ingest; failure logged          ▲                     gas-log-helpers.js
        │    via Logger.log only — NOT written      │ POST /v1/datasets/_apl
        │    to Drive, never retried)                └────────────────────┘
        │
        └─ else ───────────────────────────────► Google Drive folder     gas-log-helpers.js
            (creates timestamp-uuid.log,            │                    waitForGasLog(fn)
             NDJSON, one entry/line)                 └─ /path/to/drive/GAS-Logs/  polls directory
```

**Key facts:**
- `flush()` picks **one** sink per call by checking `AXIOM_TOKEN`/`AXIOM_DATASET` — never both, never a fallback from one to the other.
- A failed Axiom POST (network error, non-2xx) is logged via `Logger.log()` (visible in `clasp logs`/Stackdriver) and the batch is dropped — it is *not* written to Drive as a backstop. See "Why Axiom-exclusive, not best-effort" below for why this is deliberate.
- Each Drive `flush()` writes one NDJSON file (timestamped + UUID filename) — atomic, no partial reads.
- Drive-side tests poll the directory (no push/notification); files appear within 1–3 seconds of GAS execution. Axiom-side tests poll the query API instead (see Visibility Latency below).
- The Drive folder ID is a GAS Script Property (`GAS_LOGGER_FOLDER_ID`) and `gasLogDir` in local dev settings.
- The Axiom dataset/tokens are GAS Script Properties (`AXIOM_TOKEN`, `AXIOM_DATASET`) and `axiomDataset`/`axiomQueryToken` in local dev settings (query-side only — the query token is never sent from GAS).
- `gas-log-helpers.js` auto-selects its backend the same way: if `axiomDataset`+`axiomQueryToken` are both set in `local.settings.json`, it queries Axiom; otherwise it polls the Drive folder. **Keep this in sync with whichever sink the live GAS script is actually configured with** — if GAS is in Axiom mode but your local settings only have `gasLogDir`, the helper will poll an empty Drive folder and every `waitForGasLog` call will time out.

### Why Axiom-exclusive, not best-effort

An earlier version of this pattern wrote Drive *and* attempted Axiom on every flush, treating Axiom as a best-effort bonus. In practice that let a broken Axiom pipe (bad token, wrong dataset, network issue) go unnoticed indefinitely — the Drive write masked it, since nothing failed loudly. The current design makes Axiom **exclusive once configured**: if it's broken, nothing lands anywhere queryable, and a test or developer polling for an expected entry gets a real timeout instead of a silent gap. The trade-off is that you should calibrate the pipe once after setup (see the `axiom_probe` pattern below) rather than relying on Drive to quietly catch failures.

### Sink Architecture

Axiom is not special-cased inside `GasLogger.js` — its config lookup, row-shaping, and ingest POST all live in `AxiomLogger.js`, a separate optional file. `GasLogger.js` only knows its own built-in Drive writer plus a one-line discovery check:

```javascript
function _activeExternalDriver() {
  if (typeof AxiomLogger !== 'undefined' && AxiomLogger.isConfigured()) return AxiomLogger;
  return null;
}
```

`flush()` uses whatever this returns, or the Drive writer if it returns `null`. A driver is `{ name, isConfigured(), write(entries) }`. Copying `AxiomLogger.js` out of a project removes Axiom as an option with zero edits to `GasLogger.js`; copying in a new driver file that exposes the same shape and adding one more `typeof X !== 'undefined'` line to `_activeExternalDriver()` (in priority order) adds another sink.

This checks for the driver **lazily, by well-known global name, at `flush()` time** — not via a load-time `GasLogger.registerDriver(AxiomLogger)` call at the bottom of `AxiomLogger.js`. That would be a footgun in Apps Script: clasp bundles every `.js` file into one global scope with no guaranteed load order, so if `AxiomLogger.js` happened to execute before `GasLogger.js`, a load-time registration call would throw on an undefined `GasLogger`. A lazy name-based check sidesteps ordering entirely.

The query side mirrors this: `gas-log-helpers.js` owns the file driver directly (no external service, nothing to split out) and delegates to `axiom-log-helpers.js`'s `createAxiomDriver()` for Axiom. Node has no load-order hazard, so that side uses a normal `require()` rather than the lazy-global trick — the driver interface there is `{ name, isConfigured(), clear(), waitFor(), queryAll(), assertAbsence() }`.

This is a deliberate simplification, not the end state: a fixed priority-ordered list of `typeof`-checked names (GAS side) / `require()`d modules (Node side) is fine for two drivers, but would get unwieldy past three or four. If a third sink shows up (Cloud Logging, a Slack webhook, BigQuery), consider promoting this to a real registry — an array of driver objects that `flush()`/`_selectDriver()` iterate, still enforcing "first configured driver wins, never a dual-write" — rather than adding more hardcoded branches.

---

## Correlation (`startOp()` / `endOp()`)

`startOp()` generates a UUID and stamps it as `op` on every `log()` call until `endOp()`. This replaces manually threading `sessionId`/`runId`/`execId` through call sites — one top-level invocation's sub-events (e.g. a sync's per-doc scanned/complete events) share one queryable id without relying on timestamp proximity.

```javascript
GasLogger.startOp();
GasLogger.log('sync.scanned', { docCount: 12 });
GasLogger.log('sync.complete', { ok: true });
GasLogger.endOp();
```

In Axiom, query `where op == '<uuid>'` to pull every entry from that one invocation. `startOp()` returns the id if you need to log it elsewhere (e.g. return it to the caller for cross-referencing).

---

## Cross-Execution Correlation (`parentOp`)

A single `op` id only covers one GAS execution. When one execution calls into another over HTTP — e.g. an addon-side function calling its own deployed WebApp via `UrlFetchApp` — each hop is a separate execution with its own isolated global scope, so `_currentOp` can't just be shared.

`startOp()` never *adopts* a caller's id as its own (that would collapse distinct/concurrent invocations under one id). Instead:

```javascript
// Caller (e.g. an addon function)
GasLogger.startOp();
var myOp = GasLogger.getCurrentOp();
UrlFetchApp.fetch(webAppUrl, { method: 'post', payload: JSON.stringify({ opId: myOp, ... }) });
GasLogger.endOp();

// Receiver (e.g. doPost in the WebApp)
function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  GasLogger.startOp(payload.opId);   // mints its OWN fresh op, stamps payload.opId as parentOp
  ...
  GasLogger.endOp();
}
```

Every entry logged by the receiver carries both its own `op` and the caller's id as `parentOp`. In Axiom, `where parentOp == '<callers-op>'` finds every downstream execution a given invocation triggered.

---

## Sentinel-Watermark Waits (Axiom-only — avoiding false negatives)

Because Axiom ingest-to-queryable latency is variable, a bare fixed timeout is **unsound for asserting absence** ("no entry with tag X appeared") — a real, delayed entry could still be in flight when the timeout expires, producing a false pass. Don't write `assert_no_log` style checks against Axiom with a plain `setTimeout`/`sleep` window.

Instead, use a sentinel-watermark: at the moment you want to assert absence-up-to-now, POST a throwaway "probe" entry with a fresh random id, wait until *that* entry becomes queryable (proving Axiom's ingest has caught up to "now"), then check the suspect tag is absent from everything observed up to that point. If the sentinel itself never lands within a generous timeout (e.g. 30s), that's a pipe failure, not a sound absence — raise distinctly from "the suspect tag really is absent."

This needs a way to make the probe go through the real GAS→Axiom path (not a test-process-direct-to-Axiom shortcut, which would understate real latency by skipping the hop). Add a deployment/test-only WebApp route like:

```javascript
// Test-harness-only route, gated behind your deployment secret — same shape as
// any other deploy-time config route.
function _handleAxiomProbe(payload) {
  var sentinel = payload.sentinel || '';
  if (!sentinel) return _jsonResponse({ error: 'sentinel required' });
  GasLogger.log('test.axiom_probe', { sentinel: sentinel });
  GasLogger.flush();
  return _jsonResponse({ ok: true });
}
```

Calibrate once per test session (not per-assertion) with a round-trip latency check — POST a probe, time how long until it's queryable — both as a health-check (raises if the pipe is broken) and to size wait windows elsewhere. Budget on the order of a few seconds for typical Axiom round-trip latency, but measure it for your own dataset/region rather than hardcoding a number.

`gas-log-helpers.js` ships this pattern as reusable functions (a Node port of GActionSheet's `tests/helpers/gas_log.py`) so you don't hand-roll it per project — set `webappTestUrl`/`webappSecret` in `local.settings.json` and add the `_handleAxiomProbe`-style route above to your WebApp, then:

```javascript
const { axiomProbeLatency, assertGasLog, assertNoGasLog } = require('./gas-log-helpers');

// Once per test session — health-check + latency calibration.
const latencyMs = await axiomProbeLatency();

// Positive assertion — same shape as waitForGasLog, but throws with a labeled message.
await assertGasLog((e) => e.tag === 'sync.complete', 'sync should have completed', fence);

// Absence assertion — sentinel-watermark on the Axiom backend, a short bare wait on
// the file backend (sound there since the Drive write is effectively synchronous).
await assertNoGasLog((e) => e.tag === 'sync.error', 'sync should not have errored', fence);
```

---

## Flush Strategy

Drive writes are relatively slow in GAS, and Axiom POSTs add network latency. `GasLogger` buffers in memory and flushes:
- Automatically once the buffer reaches 25 entries (`FLUSH_THRESHOLD` in `GasLogger.js` — tune per project).
- Explicitly when you call `flush()` — always do this in a `finally` block at the end of every entry point, and at any genuinely high-severity event you can't risk losing if the script times out.

---

## One-Time Setup

### 1. Drive folder (required)

Create a folder in Google Drive (e.g. `MyProject-Logs`). Copy the folder ID from the URL:
```
https://drive.google.com/drive/folders/<FOLDER_ID>
```

In the Apps Script editor: **Project Settings → Script Properties → Add property**

| Property | Value |
|---|---|
| `GAS_LOGGER_FOLDER_ID` | `<the Drive folder ID>` |

Copy `local.settings.example.json` → `local.settings.json` and set `gasLogDir` to wherever Drive for Desktop mounts that folder locally.

Copy `GasLogger.js` into `src/` and run `testGasLogger()` once from the GAS editor to confirm the Drive write works.

### 2. Axiom (optional, recommended)

0. Copy `AxiomLogger.js` into `src/` alongside `GasLogger.js` — this is what makes Axiom an available driver at all; without it, `GasLogger.js` never looks for Axiom config.
1. Create an Axiom account at [axiom.co](https://axiom.co) (free tier is sufficient for most dev/test volumes — check current free-tier ingest/retention limits before relying on it for production traffic).
   - **Open decision for this project:** the existing Axiom login is tied to a personal GitHub account. If org-wide access is needed, create a second account/org under a Northlake identity instead — Axiom account/dataset/API-key creation is quick, so this is a low-cost decision to revisit later rather than something this template needs to resolve.
2. Create a dataset (e.g. `myproject-gas-logs`).
3. Generate two separate API tokens from the org's **Settings → API Tokens**:
   - An **ingest** token, scoped to write into the dataset — this is `AXIOM_TOKEN`.
   - A **query** token, scoped to read the dataset — this is `axiomQueryToken` (local dev only; never sent from GAS).
4. Set GAS Script Properties:

   | Property | Value |
   |---|---|
   | `AXIOM_TOKEN` | the ingest token |
   | `AXIOM_DATASET` | the dataset name |

   You can set these by hand in the Apps Script editor, or write a deployment-only WebApp route to set them remotely (see GActionSheet's `_handleSetAxiomConfig` in `src/WebApp.js` for a reference pattern — gated behind a deployment secret, same shape as a `set_test_token` route).
5. In `local.settings.json`, set `axiomDataset` and `axiomQueryToken` (for `query-axiom.py`).
6. Run `testGasLogger()` again — check the Axiom dataset's **Stream** tab for the two test entries.

---

## Querying Logs Back

### Axiom (`query-axiom.py`)

```bash
python query-axiom.py                          # last 200 events, last 24h
python query-axiom.py --limit 50 --since 2h
python query-axiom.py --name sync.error
python query-axiom.py --where "data.docId == '1AAE...'"
python query-axiom.py --raw /tmp/axiom_dump.json
```

Requires `local.settings.json` with `axiomDataset` + `axiomQueryToken`. No external Python packages — stdlib only.

### `gas-log-helpers.js` (Node/Playwright — works against whichever driver is configured)

`gas-log-helpers.js` auto-selects the file driver or `axiom-log-helpers.js`'s Axiom driver based on `local.settings.json` (see Sink Architecture above). The same test code works unchanged either way:

```javascript
const { waitForGasLog, clearGasLogs, countGasLogEntries } = require('./gas-log-helpers');

test('server processed the request', async ({ page }) => {
  const fence = clearGasLogs();           // file driver: deletes old files. Axiom driver: just returns a fence timestamp.
  await page.goto('');                    // triggers doGet on GAS server

  const entry = await waitForGasLog(e => e.tag === 'doGet.start', 15000, fence);
  expect(entry.data.route).toBeTruthy();
});
```

Audit-style counting (note: `countGasLogEntries` is `async` — it queries Axiom over HTTP when that driver is active):

```javascript
// Count server-side page loads across an entire test suite run
const count = await countGasLogEntries('doGet.start', suiteStartMs);
expect(count).toBeLessThanOrEqual(THRESHOLD);
```

Requires Node 18+ (uses the built-in global `fetch` for the Axiom backend).

---

## Visibility Latency and Test Polling

**Drive path:** local Drive visibility is eventually consistent.
- Poll with backoff and an overall timeout (15–30s for slower environments).
- Ignore files older than test start (pass the fence from `clearGasLogs()`).
- Match on the `op` correlation id (or `tag`) before asserting content.

**Axiom path:** ingest-to-queryable latency is typically a few seconds but varies — `waitForGasLog`/`countGasLogEntries` poll the query API rather than a local directory. For asserting an entry's *presence*, a generous timeout (the helper defaults to 15s; widen it for slower/colder datasets) is sound. For asserting *absence*, a bare timeout is **not** sound — see Sentinel-Watermark Waits above.

---

## Reusable Files

| File | Purpose |
|---|---|
| `GasLogger.js` | Core logger + built-in Drive driver. No Axiom-specific code — see Sink Architecture. `run()`/`logError()` entry-point wrapper; `maskPiiForLog_`/`maskRecipientListForLog_` PII helpers |
| `AxiomLogger.js` | Optional Axiom sink driver (config lookup, row-shaping, ingest POST). Copy in only if you want Axiom; drop it to remove Axiom as an option, zero changes to `GasLogger.js` |
| `test_gas_logger.js` | Plain-Node unit test (`node test_gas_logger.js`) for both files' pure functions — no GAS runtime needed |
| `gas-log-helpers.js` | `waitForGasLog`, `clearGasLogs`, `countGasLogEntries`, `axiomProbeLatency`, `assertGasLog`, `assertNoGasLog` — Node/Playwright test helpers; auto-selects the file driver or `axiom-log-helpers.js`'s Axiom driver |
| `axiom-log-helpers.js` | Axiom query driver for `gas-log-helpers.js` (querying, row-reshaping, sentinel probing) — required by `gas-log-helpers.js`, not used standalone |
| `query-axiom.py` | CLI to query an Axiom dataset (stdlib only, no dependencies) |
| `local.settings.example.json` | Template for local developer settings (Drive path + Axiom tokens + `webappTestUrl`/`webappSecret` for the sentinel probe) |

---

## Constraints and Trade-offs

| Concern | Detail |
|---|---|
| No fallback on Axiom failure | Once `AXIOM_TOKEN`/`AXIOM_DATASET` are set, a failed POST drops that batch — it is not written to Drive. Calibrate with `axiom_probe` after setup; don't assume Drive will quietly catch a broken pipe |
| Latency (Drive) | Drive sync introduces 1–5 second lag; use `waitForGasLog` with adequate timeout |
| Latency (Axiom) | Network round-trip on every `flush()`; ingest-to-queryable lag varies — measure it for your dataset with an `axiom_probe`-style round-trip check rather than assuming a fixed number |
| Axiom free tier | Check current ingest volume / retention limits before relying on it for production traffic — treat it as a dev/test/debugging aid unless upgraded |
| Asserting absence (Axiom) | A bare timeout is unsound against variable ingest latency — use the sentinel-watermark pattern, not a fixed `sleep`/`setTimeout` |
| Multi-instance isolation | Use `startOp()`/`endOp()` (same execution) and `parentOp` (cross-execution, via `getCurrentOp()`) rather than timestamp-only matching |
| Test isolation | Call `clearGasLogs()` before each test or test group; use its returned fence as `afterMs` regardless of backend |
| Flush policy | Prefer bounded buffering (size/error/end-of-request) over frequent single-entry flushes |
| Drive quota | Each flush creates one file when in Drive mode; clean up periodically or add TTL pruning |
| Production | Consider `GasLogger.disable()` in PROD deployments serving real user traffic, or rely on Axiom's retention/sampling instead of Drive's unbounded file growth |
| Auth (Drive) | The GAS script must have Drive scope (`DriveApp`) in `appsscript.json` |
| Auth (Axiom) | `UrlFetchApp` requires the `script.external_request` OAuth scope (usually auto-detected by `appsscript.json`'s explicit scope list — verify if you see an authorization prompt) |
| Drive for Desktop | Required on the dev machine for the Drive path; not suitable for CI — use Axiom for CI-queryable logs instead |
| `gas-log-helpers.js` backend drift | If `local.settings.json` and the live GAS script properties disagree about which sink is active, every wait silently times out against the wrong (empty) backend — keep them in sync |

---

## Alternative Pattern: Shared File ID + HTTP Read

Alternative to the Drive-folder-of-files approach: both GAS and tooling share a single Drive file ID. GAS appends NDJSON, tooling retrieves the file via HTTP (for example `curl` to an export/download URL with appropriate access).

When this helps:
- Tooling cannot rely on local Drive-for-Desktop mapping.
- You want a single known artifact instead of many timestamped files.

New risks to manage:
- Concurrent append contention across multiple executions.
- Read/write race windows (tool reads while GAS writes).
- Larger single-file growth and retention management.
- Access control complexity if using link-based sharing.

If you choose this pattern, keep the same correlation approach (`startOp()`/`endOp()`) and consider periodic file rotation (for example one file per run) to reduce contention. In most cases, prefer Axiom over this pattern now that it's available — it solves the same "queryable from outside GAS" problem without the contention/rotation concerns.
