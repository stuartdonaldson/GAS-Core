# Recommendation — consolidate `manage-deployments.js` into a shared package

**Status:** proposed, not started
**Author:** review of 2026-08-21
**Scope:** 7 copies of `manage-deployments.js` across F3Go30, RankChoiceVoting, GActionSheet,
PracticeMix, NUUC-Dispatch, and two `best-practices/` templates.

---

## 1. Problem

`best-practices/gas-deployment/` and `best-practices/gas-cm-and-deployment/` are *copy-forward
templates*. Five projects copied them and then diverged. The divergence is not topology — it is
five different implementations of the same six steps (auth, stamp, push, redeploy, post-deploy
hooks, report).

Measured drift, 2026-08-21:

| # | Finding | Affected |
|---|---|---|
| 1 | `execSync('clasp push -f')` with no `env` → clasp silently falls back to `~/.clasprc.json` (wrong credentials). Only F3Go30/RCV set `clasp_config_auth`. | GActionSheet, PracticeMix, NUUC-Dispatch |
| 2 | No end-of-deploy summary. Only RCV prints version/revision/static/spreadsheet/webapp. Others print a subset, usually just `/exec`. | 6 of 7 |
| 3 | Revision resolved two incompatible ways: RCV parses `@(\d+)` from `clasp deploy` stdout; lineage A re-runs `clasp deployments`. Neither falls back to the other. | all |
| 4 | Three version-file shapes: `const APP_VERSION = '…'`, `BUILD_INFO { version: "…" }` in `Version.js`, same in `version.html`. Filename case varies. | all |
| 5 | Source-of-truth inversion: lineage A's `getVersionFromBuildInfo()` reads the display version back out of the stamped file to build the deployment description, making the version file (not `package.json`) authoritative mid-deploy. | lineage A |
| 6 | No `build` counter → repeated test deploys are indistinguishable. | GActionSheet, NUUC-Dispatch |
| 7 | `deployment-ledger/<target>.jsonl` exists only in lineage A; lineage B lost it. | F3Go30, RCV |
| 8 | No generic post-deploy reachability assertion in lineage B. | F3Go30, RCV |
| 9 | Retry around the ~5s edge-propagation race exists only in F3Go30 (`execSyncWithRetry_`). | 6 of 7 |
| 10 | Static front-end URL duplicated. F3Go30 declares `STATIC_PAGES_BASE_URL_` in `script/version.js` but `tools/wait-for-static-deploy.js`, `tools/perfTiming.js`, `tools/publish-static-pages.js` and a test each re-hardcode the literal. RCV keeps a node-side `STATIC_ENTRY_BASE_URL` and a hand-maintained GAS-side twin in `script/ApiBridge.js`. | F3Go30, RCV |
| 11 | GActionSheet enforces `only-allow pnpm` but its own `release:*` scripts call `npm version`. | GActionSheet |
| 12 | F3Go30's and RCV's `test_manage_deployments.js` are near-identical copies; the other three projects have no deploy tests. | all |
| 13 | **No project can be asked what version it is actually running.** PracticeMix's `status` returns a cache generation; NUUC-Dispatch embeds `BUILD_INFO.version` in a `doGet` text body; F3Go30, RCV and GActionSheet expose nothing. A deploy is therefore never verified — the script reports success on the strength of `clasp deploy` exiting 0. | all |
| 14 | **Five implementations of the webapp caller**: `tools/callWebapp.js` (F3Go30, RCV), `tools/call-webapp.js` (NUUC-Dispatch, PracticeMix), `scripts/call_webapp.py` (GActionSheet). All solve the same four problems — deployment-URL resolution, secret injection without shell-history leakage, POST-vs-GET redirect handling, env selection — and their docstrings already cross-reference each other as "mirrors X's". Same drift shape as `manage-deployments.js`, one stage behind. | all |

## 2. Two lineages (both legitimate)

**Lineage A — anchor discovery.** One script project; TEST/PROD are named deployments found by
substring-matching `clasp deployments` for `TEST-WEB-APP` / `PROD-WEB-APP`.
*(GAS-Core templates → PracticeMix → GActionSheet → NUUC-Dispatch)*

**Lineage B — settings-driven multi-project.** One script project *per environment*;
`.clasp.json` regenerated from `local.settings.json` each run; the single non-`@HEAD` deployment
is looked up fresh. Forced on F3Go30 by bound containers.
*(F3Go30 → RankChoiceVoting)*

The topology difference is real and permanent. It is **one strategy hook**, not a reason for two
codebases.

## 3. Target architecture

A real installable package — **not** another template to copy. It lives in **GAS-Core**,
alongside `libs/LibSheets` and `libs/LibSidebar`, and is consumed as a git dependency.

```
GAS-Core/packages/gas-deploy/
  index.js                      # deploy(), summary(), interactiveMenu()
  lib/clasp.js                  # claspEnv(), execWithRetry(), listDeployments(), parseDeployments()
  lib/version.js                # bumpPatchVersion_, bumpBuildNumber_, resetBuildNumber_, stampVersion
  lib/stampers.js               # constStamper, buildInfoStamper
  lib/resolvers.js              # soleActiveDeployment, anchorMatch(anchor)
  lib/ledger.js                 # writeLedgerEntry, writeDeployMetadata
  lib/summary.js                # printDeploySummary
  lib/verify.js                 # pingWebapp, assertDeployedVersion
  lib/webapp.js                 # resolveUrl, post, secret injection, redirect handling
  bin/call-webapp.js            # the standardized CLI
  test/                         # the unit tests, once
```

**Consumption.** pnpm git dependency pointing at the subdirectory, pinned to a prefixed tag
matching GAS-Core's existing convention (`libsheets-v1.0.0`, `libsidebar-v1.0.0`):

```jsonc
// consumer package.json
"dependencies": {
  "gas-deploy": "github:stuartdonaldson/GAS-Core#gas-deploy-v1.0.0&path:/packages/gas-deploy"
}
```

**This requires pnpm in the consumer.** npm has never supported subdirectory git dependencies;
pnpm's `path:` selector is what makes a monorepo subdirectory installable without publishing to a
registry. GAS-Core is ~10 MB of working tree, so pulling the whole repo per consumer is not a
practical cost.

Consequence for sequencing: the two Stage 2 consumers — **F3Go30 and RankChoiceVoting** — are
still on npm and must be migrated to pnpm first. That is Stage 1b. GActionSheet and NUUC-Dispatch
are already pnpm, so they do not block the dependency; PracticeMix is the only other npm project
and is not a consumer until Stage 5a, so it stays in Stage 4.

Each project keeps a ~50-line `tools/manage-deployments.js` that is **pure config**: `TARGETS`,
stamper choice, resolver choice, and an ordered `postDeploy` hook array.

**Invariants the package enforces (these are the point of the exercise):**

- Every `clasp` invocation goes through `claspEnv()`, which always sets `clasp_config_auth`.
  There is no code path that runs bare `clasp`. *(kills #1 structurally)*
- `package.json` is the sole source of truth for version and build. The version file is
  **generated, never read back**. *(kills #5)*
- `printDeploySummary()` is the mandatory final step of every deploy. *(kills #2)*

### 3.1 The standard deploy summary

```
🧪  SIT deploy summary
   Product version: v2.5.0.9
   Stamped at:      2026-08-21T14:02:11Z
   Deployment ID:   AKfycbx…full-id-never-truncated
   Revision:        @47
   Script project:  1a2b3c…   https://script.google.com/home/projects/<scriptId>/edit
   Webapp:          https://script.google.com/macros/s/<deploymentId>/exec
   Static page:     https://f3go30.github.io/static-pages/dist/sit/
   Spreadsheet:     https://docs.google.com/spreadsheets/d/<id>/edit
```

Rules:
- **Full deployment ID**, never truncated — a truncated ID cannot be pasted into `callWebapp` or
  a bug report.
- Revision resolved by **both** strategies: parse `clasp deploy` stdout first; if that misses,
  re-run `clasp deployments` and read the row; only then print `(unresolved)`.
- Rows whose input is absent print an explanatory placeholder, never a broken URL — RCV's
  `(sheetId not set in local.settings.json)` is the model.
- Reachable standalone as `--summary --env <env>` so "what is deployed right now?" does not
  require deploying.

### 3.2 Deploy verification — assert the version actually serving (#13)

**This is the single most valuable thing the package adds, and it does not exist anywhere today.**

Every variant reports success when `clasp deploy` exits 0. That proves a version was *created*,
not that the /exec URL is serving it. The gap covers real failure modes seen in these projects: a
deployment silently converted to a library because `appsscript.json` lost its `webapp` section, an
edge that has not propagated yet, a push that landed in the wrong script project because clasp fell
back to the wrong credentials (#1), and a named deployment left pointing at an older version.

**Contract.** Every project's webapp exposes one uniform route returning the stamped build
identity — no secret required, so it works on an `ANYONE_ANONYMOUS` deployment and can be called
before any secret is bootstrapped:

```jsonc
// GET/POST ?cmd=version  →
{ "ok": true, "version": "2.5.0.9", "versionDate": "2026-08-21T19:08:10.331Z",
  "target": "TEST", "deploymentId": "AKfycbx…" }
```

The values come from whatever the project's stamper wrote (`APP_VERSION`/`APP_VERSION_DATE`/
`APP_DEPLOY_TARGET`, or `BUILD_INFO`), so a project adopts this by adding a route, not by changing
its version model.

**`assertDeployedVersion()`** runs as the last step before the summary, and is what makes a deploy
succeed or fail:

- Polls the /exec URL until the reported `version` equals the version just stamped, or the timeout
  expires. Reuses `execWithRetry`'s rationale — the ~5s edge-propagation race (#9) is exactly why
  this polls rather than checking once.
- Also asserts `target` matches the target just deployed to. **This is the thing that catches
  deploying to the wrong environment**, which no current script can detect.
- On mismatch, fails the deploy loudly with expected vs. actual, and prints the standard summary
  anyway so the operator can see what *is* deployed.
- The verified version and deployment ID feed the summary (§3.1), so the summary reports what the
  server confirmed, not what the local script hoped.

This also replaces flaky end-to-end suites as the deploy gate — see §4's conventions.

### 3.3 The webapp caller (#14)

`assertDeployedVersion` needs an HTTP client that resolves the deployment URL, handles GAS's
POST→GET redirect, and injects secrets without leaking them. That is precisely what the five
existing callers already do. Building a sixth inside the package would be the same mistake in a
new location.

The package owns **one** implementation (`lib/webapp.js`) plus a CLI (`bin/call-webapp.js`), and
each project's caller becomes a thin wrapper supplying its own action list, auth field names, and
env→URL mapping. Project-specific action semantics stay in the project; URL/auth/transport
boilerplate does not.

Shared behaviour to absorb, taking the best version of each from the existing five:
- URL resolution **derived from the live deployment list**, never a stored value that can go stale
  (PracticeMix's `call-webapp.js` is the model here).
- Secret never printed, not even on failure; never placed in argv or the query string (GActionSheet
  and PracticeMix both document this as the reason the tool exists).
- POST→GET redirect following.
- `--env` selection with `sit`/`test` treated as synonyms (NUUC-Dispatch already does this).
- Pluggable auth field: `adminSecret` / `testToken` / `secret` / none, per action.
- `--cmd` routing for projects with multiple endpoints (F3Go30, NUUC-Dispatch).
- `--ns` namespace shorthand (F3Go30 only — keep as an optional pass-through, not core).

**Open question, decided in Stage 3:** GActionSheet's caller is Python and is imported by pytest.
Either it shells out to the Node CLI, or it stays a Python port held to the Node implementation by
a shared contract test. Recommendation: keep the Python client, because making pytest shell out per
call is slow and awkward — but pin it with a contract test so the two cannot drift silently.

---

## 4. Stages

Each stage is done when **every** AC is checked and the Handoff Notes section is filled in.
A stage may not start until the previous stage's ACs are all checked.

Conventions for whoever executes a stage:
- Work the stage's items until all ACs pass. Do not partially land a stage.
- Record surprises, deviations, and anything the next stage needs in **Handoff Notes** *in this
  file*, then commit this file with the code.
- Deploy verification is against **SIT/TEST only** unless the AC says otherwise. Never deploy
  PROD to satisfy an AC.
- Each project's own `CLAUDE.md` deployment section is part of the deliverable — if behaviour
  changes, the doc changes in the same commit.

**How deploys are verified in these ACs — read this before running any test suite.**

Several of these projects have flaky end-to-end suites (Playwright against live GAS, pytest
journeys). "the regression suite passes" is therefore a bad gate for deployment work: it fails for
reasons unrelated to the change, and a green run does not prove the deploy landed. Every AC below
uses this three-tier rule instead:

1. **The deploy gate is `assertDeployedVersion` (§3.2)** — the deployed webapp reports the version
   and target just stamped. This is deterministic, fast, and tests the thing the stage actually
   changes. Where an AC says "deploys to SIT successfully", it means this assertion passed.
2. **Deterministic unit tests must pass outright** — `node --test` / `node test/*.js` suites, the
   package's own tests, and anything not touching the network. No flakiness is tolerated here.
3. **Flaky end-to-end suites are compared to a baseline, not required to be green.** Capture a run
   *before* touching anything, save it under the scratchpad, and after the change require **no new
   failures relative to that baseline**. Record both results in Handoff Notes. If a suite is too
   unreliable to baseline usefully, say so in Handoff Notes and rely on tier 1 — do not burn the
   session re-running it.

Never edit or skip a flaky test to make an AC pass. If a pre-existing failure blocks verification,
record it and move on; fixing it is not in this scope (§5).

---

### Stage 1 — Prototype the package's contracts in F3Go30, and pnpm the two Stage 2 consumers

**Model: Sonnet.** Mechanical, single repo, existing tests, no cross-project design decisions.

**Prerequisite:** none.

**Goal:** (a) get the reference implementation of §3.1 correct in the project with the most deploy
surface, before anything is extracted — this is the spec the package will be built from; and
(b) put F3Go30 and RankChoiceVoting on pnpm, since the package is consumed as a pnpm-only git
subdirectory dependency (§3) and those two are Stage 2's consumers.

(c) prototype the deploy-verification contract (§3.2) that replaces flaky end-to-end suites as
the deploy gate.

1a, 1b and 1c are independent — any order, or in parallel. All three must be green before Stage 2
starts.

> **1a closed 2026-08-21.** §3.2/§3.3 were added to this plan afterwards; that work is **Stage 1c**
> and does not reopen 1a. Do not uncheck 1a's ACs.

---

#### Stage 1a — Summary hardening (F3Go30)

**Files in scope**
- `/home/stuar/proj/F3Go30/tools/manage-deployments.js`
- `/home/stuar/proj/F3Go30/test/test_manage_deployments.js`
- `/home/stuar/proj/F3Go30/CLAUDE.md` (§Deploying)
- Reference implementation to port from: `/home/stuar/proj/RankChoiceVoting/tools/manage-deployments.js`
  (`printDeploySummary_`, `STATIC_ENTRY_BASE_URL`) and its
  `test/test_manage_deployments.js` (`testPrintDeploySummaryIncludesAllFourLinks`).

**Work items**
1. Add `printDeploySummary_(targetKey, {...})` to F3Go30, exported, following §3.1 exactly.
2. Capture `clasp deploy` stdout (`execSync` without `stdio:'inherit'`, then
   `process.stdout.write` it) so the revision can be parsed — RCV already does this; copy that shape.
3. Add the revision fallback: if `/@(\d+)\b/` does not match the deploy output, call
   `findActiveDeploymentId_`'s underlying `clasp deployments` listing again and read the version
   column for that deployment ID.
4. Print the **full** deployment ID in the summary (existing progress lines may keep `.slice(0,12)`).
5. Source the static page URL from `script/version.js`'s existing `STATIC_PAGES_BASE_URL_` rather
   than re-hardcoding the literal — see Stage 1 note on #10 below.
6. Partially address #10: introduce `tools/static-urls.js` exporting
   `staticBaseUrl()` (read from `script/version.js`) and `staticEntryUrl(env)`, and convert
   `tools/wait-for-static-deploy.js`, `tools/perfTiming.js`, `tools/publish-static-pages.js` to
   import it. Leave `script/version.js` as the declaring site — it is the GAS-side runtime copy.
7. Add `--summary --env <sit|prod>` as a non-deploying entry point.
8. F3Go30's `TARGETS` omits `monthScriptId`/`monthSpreadsheetId`, which exist in
   `local.settings.json`. Determine whether that target is live; if dead, note it for Stage 2 so
   the package does not carry it forward. Do not delete the settings keys.

**Acceptance criteria**
- [x] `printDeploySummary_` prints all eight rows of §3.1 with the full deployment ID.
- [x] Revision resolves via stdout parse; a unit test forces the parse to miss and asserts the
      `clasp deployments` fallback path is used.
- [x] A unit test asserts every placeholder path (missing spreadsheet ID, unresolved revision,
      static hosting not configured) prints an explanation, not a malformed URL.
- [x] `node tools/manage-deployments.js --summary --env sit` prints the summary and performs no
      push, no `clasp deploy`, and no post-deploy hooks.
- [x] `grep -rn "f3go30.github.io" tools/ test/` returns hits only in `tools/static-urls.js` and
      its test.
- [x] `npm test` passes (all 40+ suites, not just the deploy test).
- [x] `npm run deploy:sit` completes end to end against SIT and the summary is the last output.
- [x] F3Go30 `CLAUDE.md` §Deploying documents `--summary`.

---

#### Stage 1b — pnpm for F3Go30 and RankChoiceVoting

Only these two. GActionSheet and NUUC-Dispatch are already pnpm; PracticeMix is handled in Stage 4.

Per project:
1. `"packageManager": "pnpm@11.15.1"` — match the version already pinned in GActionSheet and
   NUUC-Dispatch.
2. `"preinstall": "only-allow pnpm"`.
3. `pnpm import` from the existing `package-lock.json`, then delete `package-lock.json` and commit
   `pnpm-lock.yaml`.
4. `release:*` → `pnpm version …`. **Note the semantic difference:** `pnpm version` does not run
   npm lifecycle scripts the way `npm version` does. Both projects use
   `npm version <x> && npm run push -- --skip-bump && git push --follow-tags` — verify the tag and
   the `--skip-bump` handoff behave identically under pnpm before declaring this done.
5. `npx …` inside scripts → `pnpm exec …` (F3Go30 has several in `test:static-signup`,
   `demo:screenshots`, `regression:sit`).

**Acceptance criteria — Stage 1b**
- [x] Both projects declare `packageManager: pnpm@11.15.1` and `only-allow pnpm`.
- [x] No `package-lock.json` in either; `pnpm-lock.yaml` committed in both.
- [x] `grep -n '"npm ' package.json` and `grep -n 'npx ' package.json` return nothing in either.
- [x] Fresh `pnpm install` from a clean clone succeeds in both.
- [x] F3Go30: `pnpm test` passes (deterministic node suites — tier 2).
- [x] RCV: `pnpm test` passes (all 7 node suites — tier 2).
- [x] F3Go30: `pnpm run regression:sit`'s Playwright specs **resolve and execute** under
      `pnpm exec` — this AC is about `pnpm exec` resolution, not about the specs passing. Baseline
      and compare per §4; no new failures.
- [x] `release:patch` verified in **one** of the two: version bumps, tag created, deploy invoked
      with `--skip-bump`, tag pushed. Not against PROD.
- [ ] **BLOCKED, not done.** Both deploy to SIT under pnpm (once 1c has landed, with
      `assertDeployedVersion_` passing). `pnpm run deploy:sit` itself succeeds in both projects
      today (verified, see Handoff Notes) — but this AC's literal text requires
      `assertDeployedVersion_`, which does not exist anywhere yet (Stage 1c, not started by
      anyone as of this session). Cannot be satisfied without doing Stage 1c's work, which is out
      of this stage's scope. Flagged to the requester rather than silently building 1c or
      declaring this box done on the weaker deploy-succeeded check.
- [x] Both projects' `CLAUDE.md` / `docs/OPERATIONS.md` updated wherever they say `npm run …`
      (F3Go30's `CLAUDE.md` §Deploying names `npm run deploy:sit`, `deploy:prod`,
      `release:patch` explicitly).
- [x] Handoff Notes below are filled in.

**Handoff Notes — Stage 1b**
> **Status: 11 of 12 ACs done (2026-08-21); one BLOCKED** — the "deploy to SIT with
> `assertDeployedVersion_`" AC cannot be satisfied because `assertDeployedVersion_` doesn't exist
> yet (that's Stage 1c, not started by anyone). Everything else in 1b is done and verified. Do not
> mark 1b fully closed until 1c lands and the deploy is re-verified with the assertion in place —
> at that point the blocked box just needs checking, no other 1b work should need revisiting.
>
> **Both `package.json`s**: added `"packageManager": "pnpm@11.15.1"`, `"preinstall": "only-allow
> pnpm"`, `"only-allow": "1.2.2"` devDependency (matching GActionSheet/NUUC-Dispatch's pinned
> version exactly). `pnpm import` generated `pnpm-lock.yaml` from each existing
> `package-lock.json`, which was then deleted. Verified with a real clean-room test: `rm -rf
> node_modules && pnpm install` succeeded in both from the committed lockfile alone.
>
> **`npm`/`npx` → `pnpm`/`pnpm exec` conversions** (both projects use the identical script shape):
> `release:patch/minor/major`: `npm version <x> && npm run push -- --skip-bump && git push
> --follow-tags` → `pnpm version <x> && pnpm run push -- --skip-bump && git push --follow-tags`.
> F3Go30 additionally: `test:static-signup`, `demo:screenshots`, `regression:sit`,
> `regression:sit:copy-and-init` — all `npx playwright` → `pnpm exec playwright`.
>
> **`pnpm version` vs `npm version` — the semantic difference flagged in the work items turned out
> not to matter here.** Both commands, run with no extra flags, do the same three things for a
> patch bump: write the bumped `version` into `package.json`, `git commit` it, and `git tag
> v<version>`. Confirmed directly (see below) — `pnpm version patch` in a real git checkout
> produced a commit titled `0.1.7` and a `v0.1.7` tag, exactly npm's shape. The "does not run npm
> lifecycle scripts" difference in the docs refers to `pre/postversion` npm-lifecycle hooks, which
> neither project defines — so it's a real difference in general but a non-issue for these two.
>
> **`release:patch` verified end-to-end on RCV, in an isolated scratch copy — not the real repo.**
> Both projects' `push` script targets PROD (F3Go30: `--deploy-template`; RCV: `--deploy-prod`) by
> design — `release:patch` *is* "ship to PROD" by definition in both scripts, so it cannot be
> exercised against the real repo without an actual PROD deploy, which is out of scope everywhere
> in this plan. Verification method used: `rsync`'d a full working copy of RCV (excluding
> `node_modules`/`.git`) to scratch, `git init`'d it fresh with a local bare repo as `origin`,
> edited **only the scratch copy's** `push` script to point at `--deploy-sit` instead of
> `--deploy-prod`, then ran `pnpm run release:patch` for real. Confirmed: version bumped
> 0.1.6→0.1.7 in `package.json`; commit + `v0.1.7` tag created by `pnpm version patch`; `--skip-bump`
> reached `manage-deployments.js` correctly (`build` counter stayed at 1, unchanged — bump was
> skipped as instructed); the deploy step ran a real `clasp push -f` + named-deployment update
> against RCV's real SIT script project (deployment `AKfycbwRGVyw…` → `@34`); `git push
> --follow-tags` pushed the commit + tag to the scratch bare remote successfully (confirmed via
> `git ls-remote --tags`). The static-pages publish sub-step failed in scratch only because it
> expects a sibling `../F3Static` git checkout that doesn't exist there — a scratch-environment
> artifact, not a package-manager or release-mechanics problem (the real `pnpm run deploy:sit` run
> done separately, see below, exercises that step for real and it passed). Scratch dir deleted
> after verification; real RCV repo untouched by this experiment (only touched by the separate
> real `deploy:sit` runs below).
>
> **Both projects deploy to SIT successfully under pnpm** (plain `pnpm run deploy:sit`, no
> `assertDeployedVersion_` yet since it doesn't exist): F3Go30 `2.5.0.10→2.5.0.11`, deployment
> `AKfycbzwlKLu…` `@270→@271`, full standard summary printed last. RCV `0.1.6.0→0.1.7.1` (build
> counter continued from the scratch-copy test above, which bumped real SIT state — expected, not
> a bug), deployment `AKfycbwRGVyw…` `@33→@34`, summary printed. Both are genuinely deployed and
> serving; only the wire-level version *assertion* is what's missing, per the blocked AC above.
>
> **`pnpm run regression:sit` (F3Go30): one flaky failure found, confirmed pre-existing and
> unrelated to pnpm, then got a fully clean rerun.** First full run: 50/51 Playwright specs passed;
> `static-checkin.spec.js`'s `"Not now" dismisses this version only...` test failed with
> `browserContext.close: Protocol error` / `route.fetch: Target page... has been closed` — a route
> still in-flight when the context tore down. The *previous* test in the same file was already
> patched for exactly this race (see its comment: "Let the reloaded page's own identify settle...
> otherwise the stubbed route is still in flight when the fixture closes"); the failing test has an
> `unrouteAll` call but only after its *second* reload, not its first — same class of race, just
> not yet patched there. Confirmed as timing-only, not a `pnpm exec` resolution problem: reran the
> single test in isolation and it passed. Reran the full `regression:sit` chain a second time
> end-to-end (all 51 Playwright specs including `pnpm test`'s node suites, plus
> `pnpm run test:gaslogger` at the end) and got a completely clean pass, confirming `pnpm exec
> playwright` resolves and runs every spec correctly — no formal pre-migration baseline was
> captured (package.json was already pnpm-shaped before the first run), but the flake's cause is
> independently verified as a browser-context-teardown race in test code, not anything pnpm- or
> package-manager-related, and the same suite passed clean twice under pnpm. **This flaky test is
> not fixed** — it's a pre-existing bug in `static-checkin.spec.js` (missing an early `unrouteAll`
> like its neighbor test has) — out of this stage's scope per §5, but worth a follow-up issue.
>
> **Doc sweep**: F3Go30's `CLAUDE.md` §Deploying and `docs/OPERATIONS.md` (8 occurrences) converted
> `npm run …` → `pnpm run …`; `static-pages/README.md` (2 occurrences) likewise.
> `docs/deployment-model.md` deliberately left alone — its own header states it is a historical
> rationale doc superseded by `docs/OPERATIONS.md §Deployment` for current state, matching the
> "kept for rationale" framing already in this project's CLAUDE.md. RCV has no equivalent
> operational doc mentioning `npm run …` (only a placeholder scaffold comment in its `CLAUDE.md`
> Build & Test section, not real instructions) — nothing to update there.
>
> **Still open for whoever does Stage 1c**: the blocked AC above is the entire gap. Once
> `assertDeployedVersion_` and the `cmd=version` route exist in F3Go30 (per 1c's own spec), re-run
> `pnpm run deploy:sit` in both F3Go30 and RCV and check that box — RCV will need its own
> `cmd=version` route too (already called out as a Stage 2 AC, "RCV gained a `cmd=version` route
> matching §3.2's contract" — that's Stage 2, not 1c, so 1b's blocked AC may end up only fully
> closeable for F3Go30 until Stage 2 lands the same route on RCV; flag this ordering wrinkle to
> whoever scopes 1c/2 next rather than assuming both projects clear together).

---

#### Stage 1c — Deploy verification over the wire (F3Go30)

**Model: Sonnet.** Scoped to one repo, and 1a's Handoff Notes already describe the surrounding code.

Prototype §3.2 in F3Go30 — the second spec Stage 2 extracts from. Without this, every stage's
"deployed successfully" AC rests on `clasp deploy` exiting 0 (#13).

1. Add a `cmd=version` route to F3Go30's webapp returning
   `{ok, version, versionDate, target, deploymentId}` read from `script/version.js`'s stamped
   constants. No secret required — it must work on `ANYONE_ANONYMOUS` and before any secret is
   bootstrapped.
2. Add `assertDeployedVersion_()` to `tools/manage-deployments.js`: poll the /exec URL until the
   reported `version` **and** `target` match what was just stamped, or time out. Run it as the last
   step before the summary. Mismatch fails the deploy.
3. Call it through the existing `tools/callWebapp.js` — do not add a second HTTP client. Stage 2
   extracts both together (§3.3).
4. Feed the server-confirmed version into `printDeploySummary_` so the summary reports what the
   server confirmed, not what was stamped locally. 1a's Handoff Notes give the signature.
5. Wire it into `--summary` too: a read-only summary should report the live version, and flag
   divergence from local `version.js` (that divergence means someone deployed from elsewhere, or
   a deploy half-failed).

**Acceptance criteria — Stage 1c**
- [ ] `node tools/callWebapp.js version --cmd version --env sit` returns version, versionDate,
      target and deployment ID.
- [ ] The route works with no secret in the payload.
- [ ] `npm run deploy:sit` runs `assertDeployedVersion_` and passes.
- [ ] A forced version mismatch fails the deploy with a non-zero exit and expected-vs-actual
      printed, and still prints the summary so the operator can see what *is* deployed.
- [ ] A wrong-target deploy is caught by the `target` check, not only the version check — verify
      by asserting a `TEMPLATE`-stamped build against the SIT URL.
- [ ] Polling tolerates the edge-propagation race: verify it succeeds on a real deploy where the
      first poll returns the previous version.
- [ ] The summary's version row is the server-confirmed value.
- [ ] `--summary --env sit` reports the live version and flags divergence from local `version.js`.
- [ ] Unit tests cover the assertion's match, version-mismatch, target-mismatch, and timeout paths
      with an injected fake client (no live calls in the deterministic suite).
- [ ] `node test/*.js` passes (tier 2).
- [ ] F3Go30 `CLAUDE.md` documents `cmd=version` and the deploy-verification step.
- [ ] Handoff Notes below are filled in.

**Handoff Notes — Stage 1**
> Stage 1a done (2026-08-21); **Stage 1b (pnpm migration) not started** — a later session must
> still run it before Stage 2 can begin.
>
> **`printDeploySummary_` final signature:**
> `printDeploySummary_(targetKey, { version, now, deploymentId, revision, scriptId, settings })`
> — `now` is the ISO stamp `stampVersion()` used (returned from its call, not re-derived), so the
> printed "Stamped at" always matches what's actually in `version.js`. `settings` is passed
> through whole rather than destructuring `sheetId` at the call site, so the function can look up
> `TARGETS[targetKey].sheetIdKey` itself — this is the shape Stage 2 should carry into the
> package's `printDeploySummary` (RCV's older 5-arg version — `version, revision, deploymentId,
> settings` with no `now`/`scriptId`/full-ID row — should be treated as superseded by this one).
>
> **Revision resolution is a pure, dependency-injected function, not two call sites hand-rolling
> the same regex:** `resolveRevision_(deployStdout, deploymentId, listDeployments)` — tries the
> `/@(\d+)\b/` stdout regex first, and only calls `listDeployments()` (a thunk, so it's not
> invoked at all unless needed) on a miss, reading the revision back off
> `parseDeploymentsOutput_()`'s matching row. `deploy()` passes real deploy stdout; `--summary`
> passes `''` so it always takes the fallback branch (there is no fresh `clasp deploy` stdout to
> parse when nothing was just deployed). Both `resolveRevision_` and `parseDeploymentsOutput_`
> are exported and unit-tested with an injected fake `listDeployments` — no real `clasp` call in
> the test suite. **Stage 2 should carry this exact shape into the package** — it is what makes
> the "asserts the fallback path is used" AC checkable without shelling out.
>
> **`clasp deployments` line format** (confirmed live against SIT,
> `clasp_config_auth=~/.clasprc-f3go30.json clasp deployments`):
> `- <deploymentId> @<revision> - <description>` (and `- <id> @HEAD ` for the always-present HEAD
> test-deployment, filtered out). `parseDeploymentsOutput_()`'s regex is `^-\s*(\S+)\s+@(\d+)`.
>
> **`month` target: confirmed dead**, not carried forward. Retired by ADR-010/F3Go30-shsx —
> `docs/deployment-model.md` and `docs/OPERATIONS.md` already document this. `local.settings.json`
> still has stale `monthScriptId`/`monthSpreadsheetId` keys (left alone per instruction); `TARGETS`
> only has `template`/`test`. **Stage 2's package should not carry a third "month" resolver mode.**
>
> **`--summary --env <sit|prod>` still writes `.clasp.json`** for the target scriptId (needed to
> run `clasp deployments` against it) but does nothing else destructive — no bump, no stamp, no
> push, no deploy, no settings write, no post-deploy hooks. Confirmed live: `git status` on
> `local.settings.json`/`package.json`/`script/version.js` showed no changes from a `--summary`
> run. Maps `sit`→`test` and `prod`→`template` via `ENV_TO_TARGET` — the public `--env` vocabulary
> is `sit`/`prod` even though F3Go30's internal target keys are `test`/`template` (a naming split
> Stage 2 will need a resolver-side or config-side answer for, since RCV's own target keys are
> already `sit`/`prod`/`nuuc`).
>
> **`#10` (static URL duplication) — F3Go30 side only, done via new `tools/static-urls.js`**
> (`staticBaseUrl()` reads `STATIC_PAGES_BASE_URL_` out of `script/version.js`; `staticEntryUrl(env)`
> appends `<env>/`). Converted: `tools/wait-for-static-deploy.js`, `tools/perfTiming.js` (module-load
> constant `SIT_STATIC_PAGES_URL` now built from it, no trailing slash preserved to match the
> existing `${staticOrigin}/index.html` call sites), `tools/publish-static-pages.js` (had no runtime
> literal — added an end-of-publish URL log line as its use of the helper), `tools/manage-deployments.js`
> (the summary's "Static page" row), and `test/test_signup_done_bookmarkable_url.js` (its `BASE`
> fixture constant). `script/version.js` is untouched — it stays the GAS-side declaring site per
> the work item. **RCV's own `STATIC_ENTRY_BASE_URL` / GAS-side `ApiBridge.js` twin is untouched**
> — that's RCV's half of #10 and is explicitly out of Stage 1a's scope (RCV's map also covers a
> third NUUC host GAS-Core has no equivalent for), left for whoever picks up RCV in a later stage.
>
> **Deploy verified live against SIT**: `npm run deploy:sit` (2026-08-21) — build 2.5.0.9→2.5.0.10,
> deployment `AKfycbzwlKLu…UZA` revision `@269`→`@270`, summary printed last with all rows resolved
> (no placeholders — every input was present). Command string used throughout:
> `clasp_config_auth=~/.clasprc-f3go30.json clasp deployments` (manual verification only; the
> script itself always sets this via `claspEnv`).
>
> **Still open for Stage 1b**: pnpm migration for F3Go30 and RCV, and the `pnpm version` vs
> `npm version` lifecycle-script difference the 1b work items flag — not investigated in this
> session.

---

### Stage 2 — Extract the `gas-deploy` package (F3Go30 + RCV as first consumers)

**Model: Opus.** Cross-repo API design; the strategy interfaces defined here are what every later
stage is measured against, and getting them wrong is expensive to unwind.

**Prerequisite:** Stage 1 complete.

**Goal:** one package, two consumers, zero behaviour change. F3Go30 and RCV are ~80% identical
already, so extraction is mostly deletion.

**Settled — do not relitigate**
- **Hosting: GAS-Core, at `packages/gas-deploy/`.** Consumed as a pnpm git subdirectory
  dependency (§3). Stage 1b already put both consumers on pnpm.
- **Package name: `gas-deploy`.** No npm scope — nothing is published to a registry.
- **Tag-pinned, never floating.** Prefixed tag `gas-deploy-vX.Y.Z`, matching GAS-Core's existing
  `libsheets-v1.0.0` / `libsidebar-v1.0.0` convention (repo-wide tags, so the prefix is what keeps
  namespaces from colliding). A floating dep means one package bug breaks five projects' deploys
  at once.

**Decisions to make and record in Handoff Notes**
- Exact working dependency spec. The intended form is
  `github:stuartdonaldson/GAS-Core#gas-deploy-v1.0.0&path:/packages/gas-deploy`, combining ref and
  subdirectory. **Verify this resolves before building anything on it** — pnpm's git-ref/`path:`
  combining syntax has changed across versions, and pnpm 11 is what all consumers pin. If the
  combined form does not work, fall back to a commit-SHA ref with `path:` and record the exact
  spec here.
- Whether GAS-Core's root `package.json` (`gas-core-dev`, `files: []`) needs any change for a
  subdirectory package to install cleanly, or whether `packages/gas-deploy/package.json` stands
  alone.

**Package API to build**
```js
// tools/manage-deployments.js in a consumer project
const { runCli, constStamper, soleActiveDeployment } = require('gas-deploy');

runCli({
  root: __dirname + '/..',
  settingsPath: 'local.settings.json',
  pkgPath: 'package.json',
  claspRootDir: 'script',
  stamper: constStamper({ file: 'script/version.js' }),
  resolveDeployment: soleActiveDeployment(),
  targets: { /* per-env: scriptIdKey, label, emoji, claspAuthKey, sheetIdKey, staticEnv */ },
  postDeploy: [ { name, run, required } ],   // ordered, required:false ⇒ warn, don't fail deploy
});
```

**Must move into the package**
`claspEnv()` / `expandHome_` / `resolveClaspAuthPath_`; `writeClasp()`; `bumpPatchVersion_` /
`bumpBuildNumber_` / `resetBuildNumber_`; `replaceConst` + `stampVersion`; `constStamper` and
`buildInfoStamper`; `soleActiveDeployment` and `anchorMatch(anchor)`; `parseDeployments`;
`execWithRetry`; `writeLedgerEntry` + `.deploy-metadata.json`; `pingWebapp`;
`assertDeployedVersion` (§3.2, from Stage 1c); `lib/webapp.js` + `bin/call-webapp.js` (§3.3,
extracted from F3Go30's and RCV's `tools/callWebapp.js`); `printDeploySummary`; the interactive
menu and list/archive; the unit tests.

`buildInfoStamper` and `anchorMatch` have no consumer until Stage 3 — build and unit-test them
now anyway; they are the reason the package is a package.

**Must stay in the project**
`TARGETS`, static-URL derivation, and every post-deploy hook: F3Go30's `sync-how-it-works`,
`invalidateAllCache`, `syncTrackerTriggers`, `setWebappUrl`, `publish-static-pages`; RCV's
`setWebappUrl`, `bootstrapSecret`, `publish-static-pages`.

**Acceptance criteria**
- [ ] Package exists at `GAS-Core/packages/gas-deploy/`, tagged `gas-deploy-v1.0.0`, with its own
      `README.md` and passing `node --test`.
- [ ] The dependency spec resolves: `pnpm install` from a clean clone of a consumer pulls the
      package from the pinned tag, and the exact working spec is recorded in Handoff Notes.
- [ ] GAS-Core's own `pnpm test` / `node --test` still passes with the new package present.
- [ ] Package unit tests cover both stampers and both resolvers, including `anchorMatch`'s
      no-match and multi-match errors and `soleActiveDeployment`'s zero/multiple errors.
- [ ] No code path in the package invokes `clasp` without an env carrying `clasp_config_auth`;
      a test asserts this (e.g. by injecting a fake exec and inspecting `options.env`).
- [ ] Package never reads a version back out of a stamped version file.
- [ ] Package never shells out to `npm` or `pnpm`.
- [ ] `postDeploy` hooks run in declared order; a `required:false` hook that throws produces a
      warning plus a retry command and does **not** fail the deploy; a `required:true` hook that
      throws fails it. Both covered by tests.
- [ ] `assertDeployedVersion` is a mandatory, non-skippable step of `deploy()`; a test with an
      injected fake client covers match, version-mismatch, target-mismatch and timeout.
- [ ] `lib/webapp.js` never prints a secret and never places one in argv or a query string; a test
      asserts this.
- [ ] `bin/call-webapp.js` resolves the deployment URL from the live deployment list, not a stored
      value, and follows GAS's POST→GET redirect.
- [ ] F3Go30's and RCV's `tools/callWebapp.js` are thin wrappers over `lib/webapp.js` — action
      lists and auth-field mapping only, no HTTP or URL-resolution code.
- [ ] `test_callwebapp.js` deleted from both projects; equivalent coverage lives in the package.
- [ ] F3Go30's `tools/manage-deployments.js` is under 80 lines and contains no `clasp` string.
- [ ] RCV's `tools/manage-deployments.js` is under 80 lines and contains no `clasp` string.
- [ ] RCV's per-target `claspAuthKey` (NUUC deploys under a separate Google account) still works
      — the package's auth resolution is per-target, not global.
- [ ] `test_manage_deployments.js` deleted from both projects; equivalent coverage lives in the
      package.
- [ ] F3Go30: deterministic node suites pass; `pnpm run deploy:sit` produces byte-comparable output
      to Stage 1's run (modulo version/timestamp/revision) and `assertDeployedVersion` passes.
- [ ] RCV: node suites pass; `pnpm run deploy:sit` succeeds, `assertDeployedVersion` passes, and
      the standard summary prints.
- [ ] RCV gained a `cmd=version` route matching §3.2's contract.
- [ ] Flaky suites baselined and compared per §4; no new failures. Recorded in Handoff Notes.
- [ ] Neither project's PROD was deployed during this stage.
- [ ] Both projects' `CLAUDE.md` point at the package for deploy internals.
- [ ] Handoff Notes below are filled in.

**Handoff Notes — Stage 2**
> _(fill in: **the exact dependency spec string that works**, the `runCli` config shape as built,
> any API compromise made for F3Go30/RCV that Stage 3 should revisit, and the procedure for
> cutting a new `gas-deploy-vX.Y.Z` tag and re-pinning consumers)_

---

### Stage 3 — Convert GActionSheet (first lineage-A consumer)

**Model: Opus.** First real exercise of `buildInfoStamper` + `anchorMatch`, and the project has
the most post-deploy machinery (test tokens, Axiom config, export config, config verification,
static portal publish). Expect the package API to need adjustment.

**Prerequisite:** Stage 2 complete.

**Goal:** prove the strategy hooks are sufficient by converting the most complicated lineage-A
project. GActionSheet gains fixes for #1, #6, #2 as a side effect.

**Files in scope**
- `/home/stuar/proj/GActionSheet/manage-deployments.js` (706 lines — the largest variant)
- `/home/stuar/proj/GActionSheet/src/Version.js`, `package.json`, `CLAUDE.md`

**Work items**
1. Convert to `runCli` with `buildInfoStamper({ file: 'src/Version.js' })` and
   `anchorMatch('TEST-WEB-APP')` / `anchorMatch('PROD-WEB-APP')`.
2. **Fix #1:** add a `claspAuth` key to `local.settings.json` (and `.example`) and route all clasp
   calls through the package. Confirm which credential file this project actually deploys with
   before writing it — do not guess.
3. **Fix #6:** add `"build": 0` to `package.json`; TEST deploys bump build, PROD bumps patch and
   resets build. `BUILD_INFO.version` becomes `v<version>.<build>` on TEST, `v<version>` on PROD.
   `BUILD_INFO.env` stays the source of truth for Axiom's `env` column — the version-string
   suffix remains a human-readable derivative, never the reverse.
4. Keep `registerTestToken`, `registerAxiomConfig`, `registerExportConfig`, `verifyConfig`, and
   `publishStaticPortal` as project-owned `postDeploy` hooks. `publishStaticPortal` is
   `required:false` (it already warn-and-continues today — preserve that).
5. `deployDev` (HEAD push, `/dev` URL, warn-only `verifyConfig`) has no equivalent in lineage B.
   Either add a `head: true` target mode to the package or keep `deployDev` project-local.
   Decide, and record why.
6. The `--verify` / `--verify-dev|test|prod` entry points stay project-local; they diff live
   Script Properties against `local.settings.json`, which is not the package's business.
7. Add the `cmd=version` route (§3.2) reading `BUILD_INFO`, and wire `assertDeployedVersion`.
8. **Decide the Python question (§3.3).** `scripts/call_webapp.py` is imported by pytest.
   Recommendation: keep it as a Python port rather than shelling out per call, but add a contract
   test that pins it to `lib/webapp.js` — same actions, same auth-field mapping, same env
   synonyms — so the two cannot drift silently. Record the decision and rationale.

**Acceptance criteria**
- [ ] `manage-deployments.js` contains no direct `execSync('clasp …')` call.
- [ ] Deploy stamps `BUILD_INFO.env` correctly for dev/test/production, unchanged from today.
- [ ] Two consecutive `pnpm run deploy:test` runs produce two distinct `BUILD_INFO.version`
      strings differing only in the build segment.
- [ ] `pnpm run deploy:test` runs `assertDeployedVersion` against the TEST deployment and passes;
      the standard §3.1 summary is the last output, including the static portal URL.
- [ ] A forced mismatch fails the deploy — verified, not assumed.
- [ ] `scripts/call_webapp.py`'s relationship to `lib/webapp.js` is settled and, if it remains a
      Python port, a contract test pins the two together and passes.
- [ ] `pnpm run verify:test` still passes and is unchanged in behaviour.
- [ ] The deployment ledger (`deployment-ledger/test.jsonl`) still gains one line per deploy, in
      the same schema as before.
- [ ] A forced `publishStaticPortal` failure warns with a retry command and the deploy still
      reports success.
- [ ] `pnpm run test:smoke` compared to a pre-change baseline per §4; no new failures. (This suite
      is known flaky — the deploy gate is `assertDeployedVersion`, not this.)
- [ ] PROD not deployed during this stage.
- [ ] Any package API change made for GActionSheet is released as a new package tag and F3Go30 +
      RCV are re-pinned and re-verified with a SIT deploy each.
- [ ] Handoff Notes below are filled in.

**Handoff Notes — Stage 3**
> _(fill in: package API changes forced by lineage A, the `deployDev` decision and rationale, the
> credential file GActionSheet deploys with, anything PracticeMix/NUUC-Dispatch will hit)_

---

### Stage 4 — Complete the pnpm sweep

**Model: Sonnet.** Mechanical and well-specified; the risk is in the verification, not the edit.

**Prerequisite:** Stage 3 complete.

**Goal:** finish the pnpm sweep and verify it holds across all five projects.

Most of this is already done by the time this stage runs — Stage 1b migrated F3Go30 and RCV
(forced, because the package is a pnpm-only git subdirectory dependency), and GActionSheet and
NUUC-Dispatch were already pnpm. What is left:

**4a — PracticeMix migration.** The only remaining npm project. It is not a `gas-deploy` consumer
until Stage 5a, which is why it waits until here.
1. `"packageManager": "pnpm@11.15.1"`, `"preinstall": "only-allow pnpm"`.
2. `pnpm import` from `package-lock.json`, delete it, commit `pnpm-lock.yaml`.
3. `release:*` → `pnpm version …`; apply whatever Stage 1b's Handoff Notes recorded about
   `pnpm version` vs `npm version` behaviour rather than rediscovering it.
4. `playwright …` / `npx …` in scripts → `pnpm exec …`.

**4b — GActionSheet inconsistency (#11).** Its `release:patch|minor|major` call `npm version`
despite its own `only-allow pnpm`. Fix to `pnpm version`.

**4c — Cross-project consistency sweep.** All five on the same pinned pnpm version, no npm
residue, docs aligned.

**Acceptance criteria**
- [ ] All five projects declare `packageManager: pnpm@11.15.1` (identical string) and
      `only-allow pnpm`.
- [ ] No `package-lock.json` remains in any of the five; `pnpm-lock.yaml` is committed in all five.
- [ ] Across all five: `grep -n '"npm \|npx ' package.json` returns nothing.
- [ ] Fresh `pnpm install` from a clean clone succeeds in all five.
- [ ] Each project's **deterministic** suites pass under pnpm (F3Go30's node suites, RCV's 7,
      PracticeMix's `test:unit`, NUUC-Dispatch's `node --test`). GActionSheet's `test:smoke` is
      baselined per §4, not required green.
- [ ] PracticeMix: `release:patch` verified — version bumps, tag created, deploy invoked, tag
      pushed. Not against PROD.
- [ ] PracticeMix deploys to TEST under pnpm (deploy gate is whatever verification it has at this
      point; full `assertDeployedVersion` arrives in 5a).
- [ ] The `gas-deploy` dependency resolves under pnpm in every consumer that has one so far
      (F3Go30, RCV, GActionSheet).
- [ ] Any project `CLAUDE.md` or `docs/OPERATIONS.md` still saying `npm run …` is updated.
- [ ] Handoff Notes below are filled in.

**Handoff Notes — Stage 4**
> _(fill in: whether PracticeMix hit the same `pnpm version` difference Stage 1b recorded,
> anywhere `pnpm import` lost or changed a resolution, and confirmation that PracticeMix is
> pnpm-ready for its Stage 5a conversion)_

---

### Stage 5 — Migrate the remaining projects and retire the templates

**Model: Sonnet** for 5a and 5b (the pattern is proven twice by then and Stage 3's notes cover
lineage A); **Opus** for 5c if the template retirement turns into a rewrite of
`gas-deployment/README.md`'s §Deployment Models rather than a pointer.

**Prerequisite:** Stage 4 complete.

#### 5a — PracticeMix

Notable: clasp runs from `src/` via `process.chdir(SRC_DIR)`; version lives in `src/version.html`
(not `.js`); revision stamping is a separate `update-revision.js` step invoked from the npm script,
and the deploy script *warns loudly if called without npm* because that would skip it. Folding
`update-revision.js` into the package's stamping step removes that warning and the failure mode
behind it — that is the main win here.

- [ ] `manage-deployments.js` converted to `runCli`; `update-revision.js` folded into the
      package's stamp step and deleted (or reduced to a thin standalone re-stamp).
- [ ] The "called directly, not via npm" warning and its 5-second countdown are gone, because the
      failure mode no longer exists.
- [ ] `buildInfoStamper` handles the `.html` version file (verify the existing regex still
      matches; extend the stamper's file-type handling in the package if not).
- [ ] `cmd=version` route added (§3.2). PracticeMix's existing `status` action returns a cache
      generation, not a version — extend or add alongside it; do not overload `status`.
- [ ] `tools/call-webapp.js` reduced to a thin wrapper over `lib/webapp.js`. Its live-deployment-
      list URL resolution is the behaviour the package adopted (§3.3) — verify no regression.
- [ ] `pnpm run deploy:test` succeeds, `assertDeployedVersion` passes, standard summary printed.
- [ ] A forced mismatch fails the deploy.
- [ ] `pnpm run verify:test` unchanged in behaviour.
- [ ] `pnpm run test:unit` passes (tier 2).
- [ ] Playwright suites baselined per §4; no new failures.
- [ ] Ledger and `.deploy-metadata.json` still written; `commit-deploy-stamp.js` still consumes
      the metadata correctly.
- [ ] PROD not deployed.

#### 5b — NUUC-Dispatch

Notable: already pnpm; already regenerates `.clasp.json` from `local.settings.json`
(`ensureClaspJson()` — the cleanest version of that idea in any of the seven, and the package's
`writeClasp` should match its richness: `projectId`, `scriptExtensions`, etc.). Version is
`0.0.0`, spike-scoped, with no build counter.

- [ ] `manage-deployments.js` converted to `runCli`.
- [ ] Package's `writeClasp` writes the full `.clasp.json` shape `ensureClaspJson()` produced
      (`projectId`, `scriptExtensions`, `htmlExtensions`, `jsonExtensions`, `rootDir`), driven by
      per-project config — verified against F3Go30/RCV, whose `.clasp.json` is minimal by design.
- [ ] `build` counter added; two consecutive `deploy:test` runs produce distinct versions.
- [ ] `clasp_config_auth` wired (fix #1).
- [ ] `cmd=version` route added (§3.2), replacing the ad-hoc version string currently embedded in
      `WebApp.js`'s `doGet` text body as the machine-readable source.
- [ ] `tools/call-webapp.js` reduced to a thin wrapper over `lib/webapp.js`. Its `sit`/`test` env
      synonym handling is the behaviour the package adopted (§3.3) — verify no regression.
- [ ] `pnpm run deploy:test` succeeds, `assertDeployedVersion` passes, standard summary printed,
      health check still runs.
- [ ] A forced mismatch fails the deploy.
- [ ] `pnpm test` passes (tier 2).
- [ ] PROD not deployed.

#### 5c — Retire the templates

`best-practices/gas-deployment/manage-deployments.js` and
`best-practices/gas-cm-and-deployment/manage-deployments.js` are the two copies that will
otherwise seed the next project with all of §1's drift.

- [ ] Both template `manage-deployments.js` files deleted (and `gas-deployment/update-revision.js`
      if PracticeMix's fold-in made it obsolete).
- [ ] `gas-deployment/README.md` rewritten to: install the package, pick a resolver, pick a
      stamper, declare targets and hooks — with a complete worked `runCli` config for each
      lineage. §Deployment Models (single-project vs. two-projects-per-env, and the bound-container
      driver) is preserved; it is the genuinely durable content in that README.
- [ ] `gas-cm-and-deployment/README.md` keeps only the release/CM workflow (npm→pnpm version, git
      tags, deploy stamp) and links to `gas-deployment/` for deployment mechanics.
- [ ] `best-practices/README.md` index rows updated for both folders.
- [ ] The "Generated `.clasp.json` from `local.settings.json`" entry under §Noted Patterns is
      promoted into `gas-deployment/` — it is now package behaviour, present in all five projects.
- [ ] `gas-deployment/README.md` documents **deploy verification (§3.2)** as a first-class pattern:
      the `cmd=version` contract, why `clasp deploy` exiting 0 proves nothing, and why this
      replaces end-to-end suites as the deploy gate. This is the most transferable practice in the
      whole exercise — it belongs in the README, not buried in this plan.
- [ ] The webapp caller (§3.3) is documented — either folded into `gas-webapp-admin/README.md`
      (which already covers the `cmd=admin` + CLI-caller pattern for F3Go30/NUUC-Dispatch) or
      given its own section here, cross-linked either way. Decide and record which.
- [ ] `gas-webapp-admin/README.md` updated so it does not still present a hand-rolled per-project
      caller as the recommended shape.
- [ ] This RECOMMENDATION.md marked **Status: complete**, with all Handoff Notes filled.
- [ ] A new GAS project can be stood up from `gas-deployment/README.md` alone, with no copying.

**Handoff Notes — Stage 5**
> _(fill in per sub-stage)_

---

## 5. Out of scope

- Migrating any project between lineage A and lineage B. Topology stays as-is.
- Changing what any post-deploy hook does. Hooks move; their behaviour does not.
- Creating or destroying named deployments. Every variant deliberately refuses to create
  deployments so that a new stable URL is always a human decision. The package keeps that refusal.
- PROD deploys. Every stage verifies against SIT/TEST. PROD go-live is a separate, human-initiated
  action after a stage lands.
