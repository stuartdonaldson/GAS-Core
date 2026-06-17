# Best Practice: GAS Acceptance / Scenario Testing (doPost + artifact download)

## Overview

This pattern authors **end-to-end acceptance tests** against a Google Apps Script
application — a Doc/Sheet add-on, web app, or automation — driven from Python. The test
seeds state and invokes entry points over HTTP (`doPost`), waits on a **completion signal**,
then verifies **durable state** by downloading the actual Document (`.docx`) and Spreadsheet
(`.xlsx`) and parsing them. UI-only behaviour is driven through Playwright.

It is the **stack adapter** for the universal scenario-testing principles in DevStandard
`knowledge-base/methodology/testing/atdd-bdd.md` (§ *Universal Scenario-Testing Engineering
Principles*). That document owns the *principle*; this folder owns the *GAS mechanism*. Read
it first — everything here is "how each principle is expressed in GAS + Python."

**Composes with:**
- [`gas-playwright-testing/`](../gas-playwright-testing/README.md) — driving the deployed web app / sidebar / cards through the iframe sandwich (the UI entry points).
- [`google-sheet-verification/`](../google-sheet-verification/README.md) — the xlsx-export download mechanism used for the SHEET surface.
- [`gas-server-logging/`](../gas-server-logging/README.md) — the log channel the completion signal is written to.
- [`gas-deployment/`](../gas-deployment/README.md) — why a stale deployment breaks the suite (see Trade-offs).

**When to use:** verifying that a GAS app produces the right durable Doc/Sheet state through
its real entry points — sync routines, scheduled sweeps, add-on actions — not just that an
internal function returns the right value.

---

## The entry-point coverage invariant in GAS

Every state-modifying entry point must be exercised with the **entry point itself as the
call-site** — not the mechanism it delegates to (DevStandard principle: *Entry-point
coverage invariant*). In GAS, the entry-point types and their call-site techniques are:

| Entry-point type | GAS example | How to make it the call-site |
|---|---|---|
| **Web App route** | `doPost` action | POST the action payload to the deployed `/exec` URL. |
| **Scheduled / time-based trigger** | a 30-min `syncAll()` sweep | Expose a `testToken`-gated fixture route that calls the trigger handler **once, directly** (single-shot). **Do not** install a real time trigger and wait, and **do not** simulate the clock — `syncAll()` *is* the entry point; the schedule is only what calls it in production. |
| **Installable edit trigger** | `onActionSheetEdit(e)` | Fire the **real** installed trigger via a Playwright cell edit; **or**, on the API path, invoke the handler with a synthetic `e` **and replicate its observable stamp** — because programmatic `doPost` writes run as the deployer in a separate execution and **do not fire installable triggers** (see *Programmatic write suppression* below). |
| **Menu item** | `onOpen`-registered menu action | Call the menu handler function through a fixture route — not the inner service it delegates to. |
| **Add-on card / sidebar control** | a CardService button, `@`-menu action | Drive it through the real UI with Playwright (`gas-playwright-testing`). |

> **The failure this prevents:** "`syncDocument()` is tested, and `syncAll()` just loops
> calling it, so the sweep is covered." It is not — `syncAll`'s own enumeration, skip-gating,
> trash detection, and state writes are untested until `syncAll` is the call-site. A
> scheduled trigger is tested by **single-shot invoking its handler**, nothing else.

---

## The fixture-route dispatcher

A single `testToken`-gated `run_fixture` action lets Python seed state and invoke entry
points with no browser. Each fixture is a `case` that performs the act and returns a tagged
result:

```javascript
function _handleRunFixture(payload) {
  var _TF_RESULT = null;
  switch (payload.fixture) {
    case 'sync_all':                 // <-- scheduled trigger as a single-shot call-site
      syncAll();
      SpreadsheetApp.flush();        // commit before the test downloads
      _TF_RESULT = { tag: 'fixture.sync_all', data: { ok: true } };
      break;
    case 'seed_row':                 // seed durable state to assert against
      appendActionRow(payload);
      _TF_RESULT = { tag: 'fixture.seed_row', data: { appended: true } };
      break;
    // ... one case per entry point / seed needed by the scenarios
  }
  return _TF_RESULT;
}
```

Production routes (`doPost` actions that real clients call) are invoked **directly**, not
through `run_fixture`, so the test exercises the genuine path.

---

## Completion signal, then download

Never assert after a `sleep`. GAS must make the write durable **before** signalling, and the
test must read **after** the signal:

1. GAS, at the end of the act: `SpreadsheetApp.flush()` and, for a Doc, `document.saveAndClose()`.
2. GAS emits a tagged log entry (e.g. `sync.complete`) — the *completion signal*. Synchronous
   fixture routes can instead return the signal in the response.
3. Python waits for the signal (poll the log channel, or use the synchronous response), **then**
   downloads the artifacts.
4. Download the Doc as `.docx` and the Sheet as `.xlsx` via the Drive export URL
   (`google-sheet-verification`), parse with `python-docx` / `openpyxl`.

**Logs are a completion signal and a path disambiguator — never the assertion.** Assert on
the downloaded artifact (DevStandard principle: *durable state, not return values or logs*).
A log tag may legitimately distinguish *which branch ran* (e.g. trashed-doc vs not-found) when
the durable outcome is identical — but the durable outcome is still asserted.

---

## Isolation and doc-scoping

- **Start clean per run.** Create a guaranteed-empty doc with `DocumentApp.create(name)` rather
  than cloning a template that may carry prior state; trash it at teardown. Name it
  `{Project}-Test-{scenario}-{YYYYMMDD}-{hex}` (DevStandard *named-clone* principle).
- **Scope every read to the run's docId.** A shared ActionSheet / data sheet accumulates rows
  across runs; whole-sheet counts and uniqueness checks read polluted cross-run state. Filter
  by the run's document id (or a globalId carrying the doc prefix) on every read and invariant.

---

## Batch permutations under the 6-minute ceiling

GAS execution times out at six minutes. When the setup is the same and only inputs vary, seed
**one** sheet with the full permutation set and run the entry point **once**, draining a
per-condition expectation for each — do not write a fixture-and-sweep per permutation. Example:
a single `syncAll` sweep over a sheet seeded with an invalid-doc row, a trashed-doc row, an
unmodified-valid row, and a modified-valid row proves Doc-Not-Found marking, trash detection,
and skip-gating in one round. Split into a second run only when the operation model changes
(e.g. a two-sweep grace-period behaviour).

---

## Programmatic write suppression (a GAS gotcha)

`doPost` writes run as the deployer in a **separate execution** and do **not** fire installable
triggers such as `onEdit`/`onActionSheetEdit`. Consequences for tests:

- A fixture that edits a cell to *simulate a user edit* must **replicate** the trigger's side
  effects (e.g. stamp a Dirty flag + modified date) itself, because the real trigger won't fire.
- To test the **real** installable trigger as a call-site, drive the edit through the Playwright
  UI path, where it does fire.

---

## Trade-offs

- **No mocking of Google APIs.** Platform behaviour and quotas shift silently; mocks diverge from
  production. These tests hit live Drive/Docs/Sheets — slower, but real.
- **Deploy discipline is mandatory.** The versioned Web App deployment must be redeployed after
  every script change, or the suite calls a stale revision and fails with non-JSON / wrong-version
  responses. See `gas-deployment` and `gas-cm-and-deployment`. (A `/dev` HEAD URL avoids per-change
  redeploys at the cost of running un-versioned code.)
- **Six-minute ceiling** caps how much one scenario can do — the reason permutations are batched
  rather than split.
- **Auth is a one-time capture** reused as Playwright `storageState` (see `gas-playwright-testing`).

---

## Source

Extracted from **GActionSheet** (`docs/atdd/atdd-lifecycle.md`, the `scn/` scenario harness,
`tests/test_journey.py`). The project-specific realization — the `scn` API, the canonical
journey, the `ContractSchema.js` contract — stays in that repo; this folder is the reusable
GAS pattern.
