# Adoption: Axiom logging, ESLint, and `.envrc` standards

Published 2026-09-21 with [ADR-0005](../adr/0005-one-axiom-dataset-per-repo.md),
[ADR-0006](../adr/0006-env-is-the-log-query-environment-discriminator.md) and
[ADR-0007](../adr/0007-eslint-no-undef-over-scanned-globals-is-a-merge-gate.md).

Three things GAS-Core and DevStandard were silent on, so four repos each invented an answer. This
is what each repo would change. **Nothing here has been applied** — each repo adopts on its own
schedule, and each item below is small enough to be one bead.

---

## What was published

| Artifact | Location | Status for a repo |
|---|---|---|
| `GasLogger.js` | `best-practices/gas-server-logging/` | copy verbatim |
| `AxiomLogger.js` | `best-practices/gas-server-logging/` | copy verbatim; set `AXIOM_HOISTED_KEYS` + `AXIOM_APP_NAME` |
| `tools/query_axiom.py` | `best-practices/gas-server-logging/tools/` | copy verbatim |
| `tools/axiom_report.py` | `best-practices/gas-server-logging/tools/` | copy verbatim |
| `tools/activity_log.example.py` | `best-practices/gas-server-logging/tools/` | copy and rewrite `classify()` |
| `tools/test_axiom_tools.py` | `best-practices/gas-server-logging/tools/` | copy verbatim; runs offline |
| `eslint.config.js` | `best-practices/gas-lint/` | copy to repo root; edit two marked blocks |
| `envrc.example` | `best-practices/gas-cm-and-deployment/` | copy to repo root as `.envrc` |

Everything else is `local.settings.json` (gitignored). Changes to these files belong **here**, then
get re-copied — repo-local edits are how the drift below happened.

---

## The drift that was found

| Axis | F3Go30 | GActionSheet | NDocs | GAS-Core (was) |
|---|---|---|---|---|
| Query tool language | Python | Python | **JavaScript** | Python |
| Query tool location | `tools/` | **`scripts/`** | `tools/` | folder root |
| Filename separator | `query_axiom.py` | `query_axiom.py` | **`query-axiom.js`** | **`query-axiom.py`** |
| Emitter split | `GasLogger` only (Axiom inlined) | `GasLogger` only (Axiom inlined) | `GasLogger` + `AxiomLogger` | `GasLogger` + `AxiomLogger` |
| Row shape | **spreads `data`** (257-field risk) | nested + hoisted | nested + hoisted | **spreads `data`** |
| Env field | **`target`** = `TEST`/`TEMPLATE` | `env` = `test`/`production`/`dev` | `env` = `test`/`production` | **none** |
| `--env` flag | on the report only | **absent** | **absent** | **absent** |
| Cooked report | **`activity_log.py`** (584 lines) | none | none | none |
| Dataset | `go30-tracker` | **`nuuts-shell`** (another repo's) | `nuuts-catalog` | unspecified |
| Ingest failure signal | **swallowed** | return + degraded flag + retry | return + degraded flag + retry | **swallowed** |
| Correlation id | `execId` / `runId` | `op` / `parentOp` | `op` / `parentOp` | `op` / `parentOp` |
| `logError()` keyword vocabulary | no (logs `e.message`) | yes | yes | **no** |
| Query-side `--side` filter | yes | yes | no (single-sided) | no |

Two axes not on the original list and worth naming: **correlation-id vocabulary** (`execId`/`runId`
vs `op`/`parentOp` — a cooked report's join key, so it is not cosmetic) and **whether `logError()`
exists at all**, which is the difference between a catch block that can and cannot ship document
content to an external sink.

### `gts-5zgk` (the swallow bug), per implementation

| Implementation | Present? | Detail |
|---|---|---|
| **GAS-Core template** (`AxiomLogger.js`, before this change) | **YES** | `write()` logged a non-2xx to `Logger.log()` and returned `undefined`. This is the lineage the bead named. |
| **F3Go30** (`script/GasLogger.js:186`) | **YES** | `_postToAxiom` logs non-2xx to `Logger.log()`, returns nothing; `flush()` clears the buffer regardless. Batch is lost, silently. |
| **GActionSheet** (`src/GasLogger.js`) | no | Already fixed: `_postToAxiom` returns a boolean, `flush()` propagates it, `AXIOM_INGEST_DEGRADED` + `getAxiomHealth()`, failed batch retained up to `MAX_BUFFERED_ENTRIES`. |
| **NDocs** (`src/AxiomLogger.js`) | no | Fixed, and better: the driver returns `{ok, status, body}` so `GasLogger` can record *why*. |
| **NUUTS-Shell** (`src/GasLogger.js`) | no | Verbatim copy of GActionSheet's fixed file. |

The published emitter takes NDocs' `{ok, status, body}` driver return and GActionSheet's degraded
flag / bounded retry buffer together, so the failure is both *reported* and *recoverable*.

---

## Design decisions made — flagged for overrule

Where the three implementations genuinely disagreed, one was implemented and the reasoning is
below. Each is a real decision, not a mechanical merge.

**1. Python, not JavaScript, for the query and report tools.** NDocs is the most recent
implementation and went JS; it was not followed. A cooked report is substantially data-munging
(classify, join, group, format), and the only proven 584-line example of one is Python. Both tools
are stdlib-only, so they run wherever `python3` is on PATH, with or without a venv. *If overruled:*
the query tool ports to Node cheaply; `axiom_report.py` does not, and NDocs would keep a JS query
tool that the report layer cannot import — which is why they were kept in one language.

**2. `tools/`, not `scripts/`; underscores, not hyphens.** `tools/` is 2-of-3 already. The
underscore is not taste: `axiom_report.py` and a repo's `activity_log.py` **import** `query_axiom`,
and a hyphenated filename is not an importable Python module name.

**3. The `GasLogger` + `AxiomLogger` split wins over GActionSheet's inlined Axiom.** The template
and NDocs already have it; it keeps the Axiom boundary in one owning module (DevStandard I13); and
a Drive-only repo drops one file to remove Axiom entirely. GActionSheet and NUUTS-Shell adopt by
*moving* code, with no change to the `GasLogger.log/flush` surface their call sites use.

**4. The driver returns `{ok, status, body}`, not a boolean.** NDocs' shape. The boolean cannot
carry what `AXIOM_INGEST_DEGRADED` needs to record, so GActionSheet's version has the driver and
the flag-setter in the same file to compensate — which is exactly the coupling the split removes.

**5. `env` is a query field; `target` stays the deploy contract's.** See ADR-0006. F3Go30's
`--env` reads `target`; that couples every saved query to the deploy contract. *If overruled* (one
field, named `target`, for both), say so — it is a defensible simplification, but it means a deploy
contract rename breaks saved queries.

**6. `--env` accepts `sit` as a synonym for `test`; the stored value is `test`.** The owner asked
for `--env [sit,prod]`. `sit` is honoured at the command line, but renaming `BUILD_INFO.env` from
`test` to `sit` in GActionSheet would touch its deploy-verification path for a vocabulary
preference. *If overruled:* make `sit` the stored value and `test` the alias — a one-line change in
`DEFAULT_ENV_CONFIG` plus an emitter change per repo.

**7. The `axiomEnv` compatibility shim exists at all.** It arguably "fakes it in the query layer".
It is included, bounded and documented as a migration affordance, because without it F3Go30 cannot
use the standard tool until its emitter is redeployed — and a standard nobody can adopt today is
not a standard. The defaults already cover every *value* vocabulary on the canonical `env` field;
only a different *field name* needs the block, and needing one is stated in the README and the ADR
as meaning you have an emitter to fix.

**8. The cooked-report generalization is deliberately thin.** `axiom_report.py` keeps only what is
repo-independent: fetch, index, classify, session-collapse, alert section, render. F3Go30's
`classify()` stays F3Go30's. Attempting to generalize classification — a rules DSL, a config file
of event names — would be harder to write than the Python it replaces and would lose the inline
commentary that makes the original readable.

**9. Published to GAS-Core, not DevStandard.** All three gaps are GAS-specific: Axiom logging from
Apps Script, a lint rule that exists because of GAS's flat global scope, and an `.envrc` whose
load-bearing line is `clasp_config_auth`. DevStandard holds language- and platform-agnostic
standards; splitting these across two repos would mean an adopter reads two trees to set up one
project. The one DevStandard-owned value involved, `$DEVSTANDARD` (ADR-0003), is *referenced* by
`envrc.example`, not redefined in it.

---

## Per-repo adoption notes

### GActionSheet — `/home/stuar/proj/GActionSheet`

1. **Dataset (ADR-0005), do this first.** `local.settings.json` currently reads
   `"axiomDataset": "nuuts-shell"` — GActionSheet is logging into **NUUTS-Shell's** dataset. Whether
   that was a deliberate escape from the exhausted `nuuts` dataset or a copy-paste, it is the exact
   failure ADR-0005 describes: two repos spending one field budget. Create `gactionsheet`, mint its
   two tokens, update `axiomDataset`, and push `AXIOM_DATASET` via the existing `set_axiom_config`
   route.
2. **Split the emitter.** Move the Axiom half of `src/GasLogger.js` into `src/AxiomLogger.js` per
   the published pair; set `AXIOM_HOISTED_KEYS = ['docId', 'docIds', 'eu']` and
   `AXIOM_APP_NAME = 'gactionsheet'`. No call site changes. Keep the `_TEST_FORCE_AXIOM_POST_FAIL_COUNT`
   fault injector — move it into the driver, and consider pushing it back to GAS-Core.
3. **Move `scripts/query_axiom.py` → `tools/query_axiom.py`** (verbatim published copy). Update
   `CLAUDE.md`'s "Querying Axiom Logs" block, which documents the old path and flag set.
   `--env` then works with no config: `BUILD_INFO.env`'s `production` is already a default alias.
4. **`env` vocabulary:** optionally change `BUILD_INFO.env` `production` → `prod`. Low value —
   `production` is an accepted alias — and it touches `Version.js` generation, so defer unless
   something else is already changing there.
5. **Cooked report:** none exists. `tools/activity_log.py` is a genuinely new capability here
   (sync runs per document, per user, with errors surfaced first). Worth a bead, not urgent.
6. **ESLint:** `eslint.config.js` is already the reference implementation. Replace it with the
   published copy to pick up the corrected `no-unused-vars` rationale and the wider `gasGlobals`;
   keep its own service list. Confirm `pnpm run lint` is named in the merge gate (it is, in
   `CLAUDE.md` §Backstop rules).
7. **`.envrc`:** add the missing `export DEVSTANDARD=/mnt/c/dev/DevStandard`. Gate skills check the
   literal env var, and this repo's `.envrc` does not export it.

### F3Go30 — `/home/stuar/proj/F3Go30`

Largest delta, and the only repo carrying an unfixed `gts-5zgk`.

1. **Fix the swallow (`script/GasLogger.js:172-195`).** `_postToAxiom` returns nothing and `flush()`
   discards the batch either way. Adopt the published `GasLogger` + `AxiomLogger` pair, or at
   minimum return a result and stop clearing the buffer on failure. This is the highest-value item
   in this document: F3Go30 is the repo most likely to be silently dropping events right now.
2. **Fix the row shape.** `buildAxiomRows_` spreads `e.data` as top-level keys. `go30-tracker` is
   its own dataset so the blast radius is contained, but it is on the same trajectory `nuuts`
   took. Nest under `data`, hoist a short list (`f3Name`, `execId`, `team`?), configure `data` as a
   map field in Axiom's dataset settings.
3. **Add `env`.** Stamp `BUILD_INFO.env`/`APP_DEPLOY_TARGET` → `sit`/`prod` as a top-level `env`
   column alongside the existing `target`. Until then, add to `local.settings.json`:
   `"axiomEnv": {"field": "target", "values": {"sit": ["TEST"], "test": ["TEST"], "prod": ["TEMPLATE"]}}`
   and `--env` works immediately against the published tool.
4. **Correlation ids.** F3Go30 uses `execId`/`runId`; the standard is `op`/`parentOp`. Its
   `activity_log.py` joins on `execId`, so this is not a rename-and-done. Either keep `execId` as a
   hoisted key (cheapest, and honest — it is a real execution id) or migrate the report's joins.
   **Recommend keeping it**; note the exception in the repo's own docs.
5. **`logError()`.** F3Go30 logs `e.message` in several places (`sendNagEmail.sendFailed` carries an
   `error` field). F3Go30 reads no document content, so the gts-gwyg content-leak shape does not
   apply — but `error` may carry a PAX name. Worth an audit bead, not a blocker.
6. **Replace `tools/query_axiom.py`** with the published copy (it is the ancestor; the only local
   addition, `_is_empty`, is already upstreamed).
7. **`tools/activity_log.py` stays.** Refactor it onto `axiom_report.py` — the mechanics
   (`_group_sessions`, `_format_tag`, `_fmt_time`, `_parse_epoch`, the alert section, the
   `limit * 3` fetch) are already there; what remains is `classify()` and the three index builders.
   Low risk, and it is what keeps the generalization honest. Its `_ENV_TARGET` map is then redundant
   with `--env`.
8. **ESLint + `.envrc`:** no ESLint config; sources are in `script/`, so the published config needs
   both PER-PROJECT blocks edited. `.envrc` is missing `DEVSTANDARD`.

### NDocs — `/home/stuar/proj/NDocs`

Closest to the standard; its ADR-0011 is where several of these rules came from.

1. **Emitter: near-zero delta.** `src/AxiomLogger.js` and `src/GasLogger.js` already have the
   `{ok,status,body}` return, the degraded flag, the bounded retry, `logError()`'s keyword
   vocabulary, nested rows and `env`. Adopting the published files is mostly upstreaming its own
   work; the differences are `AXIOM_HOISTED_KEYS`/`AXIOM_APP_NAME` being named constants rather
   than inline literals, and the absence of a Drive driver (NDocs declined it deliberately, ADR-0011
   §2 — keep that; the published `GasLogger` degrades to `Logger.log()` when no driver is
   configured, which is what NDocs already does).
2. **`ADR-0011`'s standing complaint is now discharged.** It records that the GAS-Core template
   regressed on four fixes relative to GActionSheet's file. All four are in the published template.
   Worth a note on that ADR (not an edit — it is Accepted) so the next reader does not re-derive it.
3. **Replace `tools/query-axiom.js` with `tools/query_axiom.py`.** The real decision for this repo
   (see design note 1). `--team`/`--resource`/`--actor` become `--where "teamId == 'X'"`, or add
   them to the shared tool and push back to GAS-Core — they are good filters and generalize as
   "filter on a hoisted key". If the owner overrules design note 1, NDocs keeps the JS tool and
   gets no cooked-report base.
4. **Dataset:** `nuuts-catalog` is already this repo's own. ✓
5. **Open item from ADR-0011 §Consequences, still open:** the `data` field must be configured as a
   **map field** in Axiom dataset settings, "not yet done as of this ADR's date". Until it is, the
   nesting fix does not actually collapse the field count — the whole point of the change. Verify.
6. **Cooked report:** none. A `tools/activity_log.py` over registration / certification /
   bulk_update would be the natural first consumer of the new base.
7. **ESLint:** none published in-repo. **`.envrc`:** missing `DEVSTANDARD`.

### NUUTS-Shell — `/home/stuar/proj/NUUTS-Shell`

Greenfield; adopting now costs almost nothing and avoids inheriting anything.

1. **`src/GasLogger.js` is a verbatim copy of GActionSheet's 410-line file** — inlined Axiom, no
   `AxiomLogger.js`. Replace with the published pair before any call sites accumulate.
2. **No `local.settings.json` exists yet.** Create it from the published example. Its dataset
   `nuuts-shell` already exists and is already being written to **by GActionSheet** — resolve that
   (see GActionSheet item 1) before treating it as this repo's own.
3. **No query tool at all.** Copy the whole `tools/` directory.
4. **ESLint:** already present and already correct — its `no-unused-vars` rationale is the one that
   was promoted into the published config. Replacing it with the published copy is optional.
5. **`.envrc`:** the only repo that exports `DEVSTANDARD`. It is the model for the other three.

---

## Still open / not done here

- **No repo was migrated.** Every item above is unapplied.
- **The shared `nuuts` dataset is still at its field cap.** Nothing published here frees it; the
  repos pointed at it move off it.
- **`AXIOM_INGEST_DEGRADED` has no standard read route.** `getAxiomHealth()` exists in the emitter,
  but "is the log pipe broken?" is only answerable from the Apps Script editor unless a repo wires
  a deployment-gated WebApp route to it. The README says to; GAS-Core does not ship one.
- **No live end-to-end run of the published tools.** `tools/test_axiom_tools.py` (17 cases) and
  `test_gas_logger.js` pass offline; the tools have not been pointed at a real dataset from
  GAS-Core, which has no `local.settings.json` of its own. First adopting repo proves the path.
