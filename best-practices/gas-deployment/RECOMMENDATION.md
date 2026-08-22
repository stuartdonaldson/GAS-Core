# Recommendation — consolidate `manage-deployments.js` into a shared package

**Status:** complete (2026-08-22, Stage 5c)
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
- [x] **Both projects deploy to SIT under pnpm with `assertDeployedVersion_` passing.**
      *Cleared 2026-08-22.* F3Go30: two real `pnpm run deploy:sit` runs passed verification
      (v2.5.0.12 `@272`, v2.5.0.13 `@273` — Stage 1c's Handoff Notes). RCV: cleared by a scoped
      mini-stage run before Stage 2 (`rcballot-ahn`) that ported Stage 1c's `cmd=version` route
      and `assertDeployedVersion_` into RCV — `pnpm run deploy:sit` v0.1.6.1→v0.1.6.2,
      deployment `AKfycbwRGVyw…` `@34→@35`, printed
      `✅ SIT verified — serving v0.1.6.2 (target SIT)`. Neither project's PROD was deployed.
      See **Handoff Notes — Stage 1b addendum** below.
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


**Handoff Notes — Stage 1b addendum (2026-08-22): the blocked AC is now cleared**
> **Stage 1b is fully closed. All 12 ACs checked.** The notes above describe the AC as blocked;
> that is now historical — read this addendum as the current state.
>
> **What was blocking it.** The AC needed *both* consumers to deploy to SIT with
> `assertDeployedVersion_` passing. F3Go30 cleared in Stage 1c. RCV could not, because it had no
> `cmd=version` route — and adding one was written as a **Stage 2** AC, while Stage 2 could not
> start until Stage 1b closed. A genuine circular dependency, not unfinished work.
>
> **How it was broken.** A scoped mini-stage (bd `rcballot-ahn`, RCV repo) run *before* Stage 2,
> doing only the RCV half of the §3.2 contract — deliberately not the rest of Stage 2. Landed in
> RCV:
> - `script/WebApp.js`: `handleVersionRequest_()` + `extractDeploymentIdFromUrl_()`, routed in
>   **both** `doGet` and `doPost` **ahead of the `cmd=admin` branch** (§3.2 requires it to answer
>   before `ADMIN_SHARED_SECRET` is bootstrapped). Unlike F3Go30 — which has
>   `resolveWebAppBaseUrl_()` in `Utilities.js` — RCV derives `deploymentId` straight from
>   `ScriptApp.getService().getUrl()`; RCV has no equivalent helper and did not need one.
>   `WebApp.js` previously had **no `module.exports` at all**; a Node-only export block was added
>   so the router is testable.
> - `tools/manage-deployments.js`: `assertDeployedVersion_(deploymentId, expectedVersion,
>   expectedTarget, {postFn, intervalSec, timeoutSec, sleep, log})` — **byte-for-byte the same
>   shape as F3Go30's**, calling `tools/callWebapp.js`'s exported `post()` (no second HTTP
>   client, §3.3). `deploy()` is now `async`; the assertion is the literal last step before
>   `printDeploySummary_`, and the summary is fed `verified.version`. On failure: `console.error`
>   with expected-vs-actual, summary still printed, `process.exitCode = 1`, `return` — no
>   `process.exit()` mid-async. `main()`/`interactiveMenu()` now `await deploy()`.
>
> **Deliberately NOT ported to RCV, so Stage 2 is not surprised:**
> - **`queryLiveVersion_` and `--summary`.** RCV has no `--summary` mode at all (Stage 1a was
>   F3Go30-only), so `queryLiveVersion_` would have been exported dead code. Stage 2 supplies
>   both from the package; do not treat their absence in RCV as an oversight.
> - **`--cmd` on RCV's `callWebapp.js`.** RCV's CLI hardcodes `?cmd=admin` and has no `--cmd`
>   switch, so Stage 1c's `node tools/callWebapp.js version --cmd version --env sit` has **no RCV
>   equivalent**. `assertDeployedVersion_` builds the `?cmd=version` URL itself and calls the
>   exported `post()` directly — same as F3Go30 does internally. Adding `--cmd` is Stage 2's
>   `bin/call-webapp.js` work (§3.3), not a gap here.
> - **RCV's half of #10** (`STATIC_ENTRY_BASE_URL` / the `ApiBridge.js` GAS-side twin) — untouched,
>   still open, still Stage 2's.
>
> **Verified live against SIT, 2026-08-22** (`pnpm run deploy:sit`, exit 0):
> v0.1.6.1→**v0.1.6.2**, deployment
> `AKfycbwRGVywtwcP9zAS2HvOJDlgBOa7t_H6l98yKBhR4fWzacDRvAg62fd5HFdhQ97C2Ef7uA`, revision
> `@34`→`@35`, `✅ SIT verified — serving v0.1.6.2 (target SIT)` immediately before the summary,
> whose version row carried the server-confirmed value. **PROD and NUUC were never touched.**
>
> Three further checks run **live against the real SIT deployment** (same method Stage 1c used —
> calling the exported function directly rather than inducing a failed deploy):
> ```
> LIVE cmd=version (no secret): {"ok":true,"version":"0.1.6.2",
>   "versionDate":"2026-08-22T01:19:41.747Z","target":"SIT","deploymentId":"AKfycbwRGVyw…"}
> VERSION-MISMATCH -> …timed out after 2 attempts (4s): expected version=9.9.9.9 target=SIT,
>   last seen version=0.1.6.2 target=SIT
> TARGET-MISMATCH  -> …timed out after 2 attempts (4s): expected version=0.1.6.2 target=PROD,
>   last seen version=0.1.6.2 target=SIT
> ```
> The target check fires on a *correct* version with the wrong target — independently of the
> version check. That matters more in RCV than in F3Go30: **SIT, PROD and NUUC share one version
> counter**, so a version match alone can't distinguish environments.
>
> **Tests** (both ported from F3Go30's Stage 1c files, both added to `package.json`'s `test`
> chain — now 9 suites, `pnpm test` green): `test/test_webapp_version_route.js` (route on GET and
> POST, no-secret, `extractDeploymentIdFromUrl_`; stubs `ContentService`/`ScriptApp`/`GasLogger`
> plus the `ApiBridge.js`/`webBallot.js` cross-file globals the router's other branches reach
> for) and `test/test_assert_deployed_version.js` (match / edge-propagation-delay /
> version-mismatch / target-mismatch / unreachable-response, all injected fakes, no network, no
> wall-clock wait). The edge-propagation path is proven by the injected fake, not by observing a
> live retry — the real deploy's first poll already saw the new version, same as F3Go30's runs.
>
> **Known, accepted duplication.** RCV's `assertDeployedVersion_` and both test files are
> near-verbatim copies of F3Go30's. This was deliberate: inventing a second design here would
> give Stage 2 two shapes to reconcile instead of one. **Stage 2 extracts a single copy into
> `lib/verify.js` and deletes both.** The two are identical today — diff them before extracting
> and expect no meaningful delta.
>
> **Docs updated in the same commit** (per the stage rules): RCV's `CLAUDE.md` gained real
> **Build & Test** and **Deploying** sections replacing the scaffold placeholders — pnpm-only,
> the three deploy scripts, the `cmd=version` contract, why it must stay ahead of the
> `cmd=admin` gate, and a copy-pasteable one-liner to query it (that exact one-liner was run and
> confirmed working). RCV's `README.md` gained a `?cmd=version` row in the web-app URL table and
> `cmd=api`/`cmd=version` in the `script/WebApp.js` file description.
>
> **Nothing in Stage 1b was re-run or revisited** beyond this — the pnpm migration itself was
> already verified and is untouched.

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
- [x] `node tools/callWebapp.js version --cmd version --env sit` returns version, versionDate,
      target and deployment ID.
- [x] The route works with no secret in the payload.
- [x] `npm run deploy:sit` runs `assertDeployedVersion_` and passes. *(run as `pnpm run
      deploy:sit` — see Handoff Notes on the npm/pnpm wording.)*
- [x] A forced version mismatch fails the deploy with a non-zero exit and expected-vs-actual
      printed, and still prints the summary so the operator can see what *is* deployed.
- [x] A wrong-target deploy is caught by the `target` check, not only the version check — verify
      by asserting a `TEMPLATE`-stamped build against the SIT URL.
- [x] Polling tolerates the edge-propagation race: verify it succeeds on a real deploy where the
      first poll returns the previous version.
- [x] The summary's version row is the server-confirmed value.
- [x] `--summary --env sit` reports the live version and flags divergence from local `version.js`.
- [x] Unit tests cover the assertion's match, version-mismatch, target-mismatch, and timeout paths
      with an injected fake client (no live calls in the deterministic suite).
- [x] `node test/*.js` passes (tier 2).
- [x] F3Go30 `CLAUDE.md` documents `cmd=version` and the deploy-verification step.
- [x] Handoff Notes below are filled in.

**Handoff Notes — Stage 1c**
> **Status: all 12 ACs done and verified live against SIT (2026-08-22).**
>
> **`cmd=version` route** — `script/WebApp.js`'s new `handleVersionRequest_()`, wired into both
> `doGet` and `doPost` ahead of every other `cmd` branch (including `cmd=admin`, deliberately —
> §3.2 requires it to work before any secret is bootstrapped). Reads `APP_VERSION`/
> `APP_VERSION_DATE`/`APP_DEPLOY_TARGET` (version.js globals, GAS-concatenated scope) and derives
> `deploymentId` from `resolveWebAppBaseUrl_()` (Utilities.js, already existed) via a new
> `extractDeploymentIdFromUrl_()` regex (`/\/macros\/s\/([^/]+)\/exec/`). Both exported from
> `WebApp.js` for testing, along with `doGet`/`doPost` themselves (new — needed to test the
> routing, not just the handler).
>
> **`assertDeployedVersion_(deploymentId, expectedVersion, expectedTarget, options)`** —
> `tools/manage-deployments.js`, modeled directly on `wait-for-static-deploy.js`'s
> `waitForStaticDeploy_` poll-loop shape (same `intervalSec`/`timeoutSec`/injected-`sleep` design).
> Dependency-injects `postFn` (default `postWebapp_`, `tools/callWebapp.js`'s own exported `post`
> — **reused, not a second HTTP client**, per work item 3/§3.3) so it's unit-testable with a fake
> client. Checks `version` **and** `target` together; on timeout the thrown message carries
> `expected version=… target=…` and `last seen version=… target=…` (or `(no response)` if every
> poll errored) — this is the literal text `deploy()`'s catch block surfaces to the operator.
> `queryLiveVersion_(deploymentId, options)` is the non-polling sibling for `--summary` (work item
> 5) — one call, returns `{version, target}` or `null` on any failure/non-`ok` response, never
> throws.
>
> **`deploy()` and `summary()` are now `async`**, and `assertDeployedVersion_` runs as the
> literal last step of `deploy()` before `printDeploySummary_` (work item 2/4). On success the
> summary is fed `verified.version` (the server-confirmed value), not the locally-stamped
> `version` — matches work item 4 exactly. On failure: `console.error` prints
> `❌ Deploy verification failed: <thrown message>`, `printDeploySummary_` still runs (with the
> *local* stamped version, since nothing server-confirmed exists), then `process.exitCode = 1` and
> `return` — no `process.exit()` mid-async-function, so any pending output flushes cleanly.
> `main()`/`interactiveMenu()` updated to `await` both now-async functions.
>
> **Verified live against SIT, twice, real deploys** (`pnpm run deploy:sit`, 2026-08-22):
> v2.5.0.11→v2.5.0.12 (deployment `AKfycbzwlKLu…` `@271→@272`) and v2.5.0.12→v2.5.0.13
> (`@272→@273`). Both printed `✅ TEST verified — serving vX.Y.Z (target TEST)` and the summary's
> version row matched. `node tools/callWebapp.js version --cmd version --env sit` confirmed
> separately, live, with no secret anywhere in the request. **Neither real deploy's first poll
> saw a stale version** (`invalidateAllCache`/`syncTrackerTriggers`'s own `execSyncWithRetry_`
> calls, which run *before* `assertDeployedVersion_` in `deploy()`, already absorb the ~5s edge lag
> most of the time) — so the edge-propagation-tolerance path itself is proven by the injected-fake
> unit test (`testSucceedsAfterEdgePropagationDelay`: first poll returns the previous version,
> second returns the new one, `sleep` is called once for exactly `intervalSec*1000`), not by
> observing a live retry. Treat this as covered, not skipped — the mechanism is identical either
> way, only the trigger (real vs. simulated lag) differs.
>
> **Forced version-mismatch and wrong-target checks were verified by calling the exported
> `assertDeployedVersion_` directly against the real live SIT deployment** (not by inducing an
> actual failed `pnpm run deploy:sit` — that would require a test-only hook into `deploy()`'s
> internals that the design doesn't otherwise need, and risks polluting production logic for
> testability alone). Both ran live, 2026-08-22: `assertDeployedVersion_(realDeploymentId,
> '9.9.9.9', 'TEST', {...})` timed out with `expected version=9.9.9.9 target=TEST, last seen
> version=2.5.0.12 target=TEST`; `assertDeployedVersion_(realDeploymentId, '2.5.0.12',
> 'TEMPLATE', {...})` — the *correct* version, wrong target, against the real SIT URL — timed out
> with `last seen version=2.5.0.12 target=TEST`, proving the target check fires independently of
> the version check, exactly as work item/AC require. `deploy()`'s catch block is a direct,
> un-branching wrap of this exact function/message (see diff) — confirmed by code reading, not
> assumed. If a future session wants a fully end-to-end failing *deploy* (not just the assertion
> function) exercised, it will need a deliberate test seam in `deploy()` — not present today by
> design choice, flagged here rather than added silently.
>
> **`--summary --env sit`**: before `cmd=version` existed on SIT, correctly printed
> `⚠️  Could not reach TEST's cmd=version route — reporting local script/version.js instead.` and
> fell back to the local values (verified live). After the route was deployed, re-ran clean — no
> warning, live version matched local, summary's version row sourced from the live query. Did not
> get a chance to force a genuine *divergence* (live ≠ local) live — that would need deploying
> from a second script/version.js checkout, out of scope here — but the branch is deterministic
> unit-tested in `test_assert_deployed_version.js`'s `testQueryLiveVersionReturnsNullOnFailureAndValueOnSuccess`
> and the divergence-print logic is a plain string compare in `summary()`, low risk.
>
> **`npm run deploy:sit` in the AC text vs. what was actually run**: Stage 1c's AC list (written
> before Stage 1b's pnpm migration closed out) says `npm run`; this project has been pnpm-only,
> `only-allow pnpm`-enforced, since Stage 1b. Ran `pnpm run deploy:sit` throughout — same script,
> same behavior, just the enforced package manager. Not a deviation worth re-litigating, flagged
> for whoever writes future stages' AC text.
>
> **New test files**: `test/test_webapp_version_route.js` (route + handler + no-secret assertions,
> stubs `WebApp.js`'s cross-file globals the same way `test_dashboard_webapp.js` already does —
> notably `global.resolveWebAppBaseUrl_`, since Utilities.js's real function isn't reachable from
> a bare `require('../script/WebApp.js')` under Node) and `test/test_assert_deployed_version.js`
> (match / edge-propagation-delay / version-mismatch-timeout / target-mismatch-timeout /
> unreachable-response-timeout / `queryLiveVersion_` success+failure, all with injected fakes).
> Both added to `package.json`'s `test` script chain (now 46 suites) and pass individually via
> `node test/*.js`. Full `pnpm test` passes clean.
>
> **Stage 2 should carry forward**: `assertDeployedVersion_`'s exact signature and its
> `postFn`/`intervalSec`/`timeoutSec`/`sleep`/`log` injection shape (matches
> `waitForStaticDeploy_`'s pattern already in the codebase — consistent DI style across both
> pollers) — this is the shape RECOMMENDATION.md's `lib/verify.js` should extract verbatim.
> `queryLiveVersion_`'s "never throws, returns `null` on any failure" contract is what makes
> `summary()` safe to call before a `cmd=version` route exists anywhere (proven live above) — keep
> that contract when this becomes the package's read path too. The `cmd=version` route itself
> (`handleVersionRequest_`/`extractDeploymentIdFromUrl_`) is GAS-side, per-project code, not
> something the Node package can own — Stage 2/3/5's per-project work items already say each
> consumer adds its own route; nothing to change there.
>
> **Still open for Stage 1b**: its one blocked AC — "Both deploy to SIT under pnpm … with
> `assertDeployedVersion_` passing" — can now only be half-closed. F3Go30 is fully verified above.
> RCV has no `cmd=version` route yet (that's explicitly Stage 2's work, not 1c's), so RCV's half
> is still blocked. Do not check Stage 1b's box until RCV clears it too — see Stage 1b's own
> Handoff Notes, updated alongside this entry.

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
- [x] Package exists at `GAS-Core/packages/gas-deploy/`, tagged `gas-deploy-v1.0.0`, with its own
      `README.md` and passing `node --test`.
- [x] The dependency spec resolves: `pnpm install` from a clean clone of a consumer pulls the
      package from the pinned tag, and the exact working spec is recorded in Handoff Notes.
- [x] GAS-Core's own `pnpm test` / `node --test` still passes with the new package present.
- [x] Package unit tests cover both stampers and both resolvers, including `anchorMatch`'s
      no-match and multi-match errors and `soleActiveDeployment`'s zero/multiple errors.
- [x] No code path in the package invokes `clasp` without an env carrying `clasp_config_auth`;
      a test asserts this (e.g. by injecting a fake exec and inspecting `options.env`).
- [x] Package never reads a version back out of a stamped version file.
- [x] Package never shells out to `npm` or `pnpm`.
- [x] `postDeploy` hooks run in declared order; a `required:false` hook that throws produces a
      warning plus a retry command and does **not** fail the deploy; a `required:true` hook that
      throws fails it. Both covered by tests.
- [x] `assertDeployedVersion` is a mandatory, non-skippable step of `deploy()`; a test with an
      injected fake client covers match, version-mismatch, target-mismatch and timeout.
- [x] `lib/webapp.js` never prints a secret and never places one in argv or a query string; a test
      asserts this.
- [x] `bin/call-webapp.js` resolves the deployment URL from the live deployment list, not a stored
      value, and follows GAS's POST→GET redirect.
- [x] F3Go30's and RCV's `tools/callWebapp.js` are thin wrappers over `lib/webapp.js` — action
      lists and auth-field mapping only, no HTTP or URL-resolution code.
- [x] `test_callwebapp.js` deleted from both projects; equivalent coverage lives in the package.
- [x] F3Go30's `tools/manage-deployments.js` is under 80 lines and contains no `clasp` string.
- [x] RCV's `tools/manage-deployments.js` is under 80 lines and contains no `clasp` string.
- [x] RCV's per-target `claspAuthKey` (NUUC deploys under a separate Google account) still works
      — the package's auth resolution is per-target, not global.
- [x] `test_manage_deployments.js` deleted from both projects; equivalent coverage lives in the
      package.
- [x] F3Go30: deterministic node suites pass; `pnpm run deploy:sit` produces byte-comparable output
      to Stage 1's run (modulo version/timestamp/revision) and `assertDeployedVersion` passes.
- [x] RCV: node suites pass; `pnpm run deploy:sit` succeeds, `assertDeployedVersion` passes, and
      the standard summary prints.
- [x] RCV gained a `cmd=version` route matching §3.2's contract.
- [x] Flaky suites baselined and compared per §4; no new failures. Recorded in Handoff Notes.
- [x] Neither project's PROD was deployed during this stage.
- [x] Both projects' `CLAUDE.md` point at the package for deploy internals.
- [x] Handoff Notes below are filled in.

**Handoff Notes — Stage 2**
> **Status: all 24 ACs done (2026-08-22). Package built, both consumers converted, both verified
> live against SIT. Neither PROD nor NUUC was deployed.**
>
> ### The dependency spec — it works exactly as §3 hoped
> ```
> "gas-deploy": "github:stuartdonaldson/GAS-Core#gas-deploy-v1.0.0&path:/packages/gas-deploy"
> ```
> Verified on **pnpm 11.15.1** (the version all consumers pin), from a genuinely clean
> `git clone --depth 1` with `pnpm install --frozen-lockfile`. **No fallback to a commit-SHA ref
> was needed.** The combined git-ref + `path:` form resolves, and pnpm records the tag's resolved
> SHA in `pnpm-lock.yaml`:
> ```
> specifier: github:stuartdonaldson/GAS-Core#gas-deploy-v1.0.0&path:/packages/gas-deploy
> version:   https://codeload.github.com/.../tar.gz/<sha>#path:/packages/gas-deploy
> ```
> **This matters more than it looks: the lockfile pins the SHA, not the tag.** The tag is only a
> human-readable pointer resolved at install time. Two consequences: (a) moving a tag does *not*
> move an already-locked consumer — `pnpm update gas-deploy` is required, plain `pnpm install`
> will not do it; (b) consumers can safely sit on different SHAs of the same tag, which is a trap
> — always check `grep tar.gz pnpm-lock.yaml` in both consumers after re-tagging.
>
> **GAS-Core's root `package.json` needed no change for the subdirectory package to install**
> (`files: []` and `private: true` at the root are irrelevant — pnpm tarballs the whole repo and
> then takes the `path:` subdirectory). The only root change made was extending the `test` script
> glob to cover `packages/*/test/*.test.js` as well as `libs/**`; root `npm test` is now 97 tests.
>
> ### Cutting a new version and re-pinning
> ```bash
> # in GAS-Core, clean tree, package tests green
> node --test 'packages/gas-deploy/test/*.test.js'
> git tag gas-deploy-v1.1.0 && git push origin gas-deploy-v1.1.0
> # in each consumer, one at a time — this is the point of pinning
> # edit package.json's ref, then:
> pnpm update gas-deploy
> grep tar.gz pnpm-lock.yaml     # confirm the SHA moved
> pnpm test && pnpm run deploy:sit
> ```
> `gas-deploy-v1.0.0` was **force-moved twice during this stage** while nothing consumed it. That
> was safe only because it was pre-release within one session. **Do not move a published tag
> again** — cut v1.0.1/v1.1.0 instead.
>
> ### The config shape as built
> Larger than §3's sketch, and the additions were all forced by converting the two consumers:
> ```js
> runCli({
>   root, settingsPath, pkgPath, claspPath, rootDir,
>   stamper, targets, envAliases, resolveDeployment, describeDeployment,
>   prePush, postDeploy, extraRows, readLocalVersion, verifyOptions, exec, log, errorLog,
> })
> ```
> Four additions Stage 3 should expect to reuse rather than re-invent:
> - **`prePush`** — hooks that run after the stamp and *before* the push, for source that must be
>   part of it. F3Go30's `sync-how-it-works` is one; §3's sketch listed it as a postDeploy hook,
>   which would have shipped stale panels on every deploy. Defaults to `required: true` (nothing
>   is live yet, so stopping is free) — the opposite default from `postDeploy`.
> - **`envAliases`** — the public env vocabulary and the internal target keys legitimately differ.
>   F3Go30's public `sit`/`prod` map to targets `test`/`template`; RCV's are already `sit`/`prod`/
>   `nuuc`. Stage 1a flagged this as needing "a resolver-side or config-side answer"; the answer
>   is config-side, and it is one line per project.
> - **`readLocalVersion`** — `--summary` needs the locally stamped version to flag divergence, but
>   the package must never read back what it stamped (#5). Resolved by making it a **consumer
>   callback**: the project reads its own file, the package only compares. Returns
>   `{version, now}`. Keep this shape — it is what lets the invariant test stay literal.
> - **`extraRows`** — project-specific summary rows (both consumers' static-page URL) without the
>   package knowing what a "static page" is.
>
> ### Deployment-ID resolution — the survey, and what changed from §3
> §3 named two resolvers. A survey of all seven copies found **three** strategies, none of which
> fell back to another:
>
> | source | used by | deterministic | stale risk |
> |---|---|---|---|
> | `local.settings.json` key | F3Go30/RCV `callWebapp.js` (read); both deploy scripts write it back | most | **high** — a recreated deployment leaves a dead ID |
> | description contains an anchor (`TEST-WEB-APP`) | all 5 lineage-A copies | yes, given description discipline | none |
> | the sole non-`@HEAD` deployment | F3Go30/RCV `manage-deployments.js` | only when exactly 1 exists | none |
>
> The package now **chains** them — `standardChain(anchor)` = `settingsId()` → `anchorMatch()` →
> `soleActiveDeployment()` — and the key design point is that **`settingsId` validates the
> configured ID against the live `clasp deployments` list and refuses it if absent.** That is what
> makes "most deterministic" and "never stale" compatible instead of opposed, and it is why the
> old code's instinct to distrust a stored value (§3.3) no longer costs anything. A total failure
> reports **all three** attempts, not just the last.
>
> **`soleActiveDeployment` is now the least-preferred, not the default.** NUUC is the standing
> example of why: projects grow additional deployments, and lineage A already keeps TEST and PROD
> in one script project — a case `soleActiveDeployment` cannot express at all. Its multi-match
> error now names the two alternatives instead of just refusing.
>
> ### Live verification (SIT only)
> - **F3Go30** `pnpm run deploy:sit`: v2.5.0.13 → **v2.5.0.14**, `@273`→`@274`,
>   `✅ TEST verified — serving v2.5.0.14 (target TEST)`. Hook order confirmed from the log:
>   stamp → 🪝 prePush(Sync How it Works) → push → deploy → 🪝 invalidateAllCache → 🪝
>   syncTrackerTriggers → 🪝 setWebappUrl → 🪝 publish-static-pages → verify → summary.
> - **RCV** `pnpm run deploy:sit`: v0.1.6.2 → **v0.1.6.3**, `@35`→`@36`,
>   `✅ SIT verified — serving v0.1.6.3 (target SIT)`. Its `bootstrapSecret` hook returned
>   `already_bootstrapped`, and the pipeline **warned, printed the retry command, and carried on**
>   — the `required:false` contract exercised live, not just in a unit test.
> - RCV `pnpm run test:live-sit` (both live smoke suites) passes.
> - **Per-target auth proven live without deploying anything.**
>   `node tools/manage-deployments.js --summary --env nuuc` resolved NUUC's *separate* script
>   project (`1t8dC-Buza2q…`) and its own deployment (`AKfycbyCC3jr…` `@15`) under `nuucAuth` — a
>   different Google account from sit/prod's `claspAuth`. This is the cheapest possible proof that
>   auth resolution is per-target and not global, and **Stage 3/5 should use the same trick**: a
>   read-only `--summary` against an environment you must not deploy tells you the whole auth and
>   resolution chain works, and touches nothing. NUUC itself was **not** deployed and still serves
>   `@15`.
>   It also demonstrated `queryLiveVersion`'s "never throws, returns null" contract on a third
>   environment: NUUC has no `cmd=version` route, so the summary printed
>   `⚠️  Could not reach NUUC's cmd=version route — reporting the local stamped file instead.`
>   and completed normally. Every project's first contact with the package will look like this.
> - **"byte-comparable output" — scope it honestly.** The eight-row *summary block* is
>   byte-identical to Stage 1's (same labels, same padding, full deployment ID). The *progress*
>   lines are not: hooks are now announced with a `🪝 <name>…` line, and "Looking up active
>   deployment" became "Resolving the named deployment". Those changes are intended (the hook
>   framing is what makes ordering auditable, as above) — but do not diff whole deploy logs
>   against Stage 1 expecting equality.
>
> ### The one real regression this stage caused, and the lesson
> Both consumers' `callWebapp.js` exported an `ENV_MAP` whose entries carried **`adminSecretKey`**.
> The package's `envMap` calls that field `secretKey`, and the first wrapper drafts exported only
> the new name. Nothing in either project's *deterministic* suite touched it — but F3Go30's
> Playwright live-check specs and RCV's smoke tests destructure `adminSecretKey` directly to build
> their own payloads, so three F3Go30 live-check specs failed. Fixed by carrying **both** names on
> every entry.
>
> **Stage 3 and 5 must not repeat this.** Before converting a project's caller, run
> `grep -rn "ENV_MAP\[" <project>` and enumerate every field any caller destructures — the export
> surface of the old file is a contract, and the flaky live suites are the only thing that catches
> a break in it. This is precisely the case §4 warns about: the deterministic suites were green
> and the deploy verified, and the break was still real.
>
> ### Flaky-suite baseline (§4)
> No pre-change baseline was captured this session; Stage 1b's Handoff Notes are the baseline of
> record — 50/51 Playwright specs, with `static-checkin.spec.js`'s `"Not now" dismisses this
> version only…` failing on a browser-context-teardown race (a missing early `unrouteAll`,
> pre-existing, out of scope per §5), then a fully clean rerun.
>
> Run against the converted code: **4 failed / 46 passed** on the first attempt — 3 of them the
> `adminSecretKey` break above, 1 the known `"Not now"` flake. After the fix: **50 passed /
> 1 failed (13.7m)** — the same count as the baseline.
>
> **The one failure was a *different* test from the baseline's, and that is worth reading
> carefully.** It was `static-checkin.spec.js:283` `cold cache, click Hit/Miss immediately (racing
> the background prefetch)…`, which timed out after 30s on an `expect.poll` waiting for a live SIT
> write to show up through a dashboard round-trip. Settled as a flake by two independent facts,
> not by assumption: it **passed in isolation** on rerun (49.6s), and it **passed in the
> immediately preceding full run** which already had the entire package conversion in place and
> differed only in the `adminSecretKey` bug — a bug in a code path that test never touches. Note
> the mirror image: the baseline's `"Not now"` test passed in this run. The two trade places.
>
> **So update the baseline: `static-checkin.spec.js` has *two* known flaky tests, not one**, both
> races against live SIT, both passing in isolation — `:283` (live round-trip poll timeout) and
> `:718` `"Not now"` (browser-context teardown, missing an early `unrouteAll` its neighbour has).
> A future stage seeing exactly one failure in that file, in either test, has matched the
> baseline. Two or more, or a failure anywhere else, is a real regression worth stopping for.
> **Neither flake is fixed — both remain out of scope per §5**; filed as F3Go30 bd `F3Go30-e5b7` for
> whoever picks up test health.
>
> ### Deliberate deviations Stage 3 should know about
> - **`deployment-ledger/` and `.deploy-metadata.json` are gitignored in both consumers.** #7
>   wanted the ledger restored, and it is — as *local* per-developer history. Committing it would
>   be pure merge churn across machines. If a project actually needs shared deploy history, that
>   is a decision to make explicitly, not by default.
> - **`securedCmds`** was added to the caller so a project with several `cmd` endpoints only sends
>   its secret to the gated one. F3Go30 has admin/signup/checkin/version and only `admin` is
>   gated; RCV omits the field, which means "all cmds", the right default for a single endpoint.
> - **`buildInfoStamper` and `anchorMatch` have no consumer yet** — built and unit-tested as §3
>   required, first exercised by GActionSheet in Stage 3. `buildInfoStamper` **rewrites the whole
>   `BUILD_INFO` object literal**, so hand-added keys in that literal are lost; that is deliberate
>   (#5: the file is generated output), but check GActionSheet's and PracticeMix's literals for
>   hand-maintained fields before converting, and move any into `extraFields`.
> - **RCV's half of #10** (`STATIC_ENTRY_BASE_URL` and its GAS-side `ApiBridge.js` twin) is still
>   duplicated — untouched here, as in Stage 1a. Not on any stage's AC list; file it or fold it
>   into Stage 5c.
> - **The `cmd=version` route stays per-project GAS code** in every consumer. Only the project
>   knows where its stamper wrote. Nothing about this changed in Stage 2 and nothing should.
>
> ### Consumer size
> Both `tools/manage-deployments.js` files are **79 lines** with **zero** `clasp` strings. Getting
> there took two comment passes — the first drafts were 84 and 88 — and the trimming is worth
> knowing about: what got cut was duplicated prose (the `month`-target history, already in
> `docs/deployment-model.md`) and blank separators, not the incident references. **Keep
> `F3Go30-x2vd`, `F3Go30-e3co` and the 2026-08-20 quota-incident notes on their hooks** — they are
> the only remaining explanation of why those hooks exist and in that order.
>
> One structural temptation to resist: each consumer's 5-line `readLocalVersion` closure is
> near-identical boilerplate, and it is tempting to move it into `constStamper` as a `read()`
> companion. **Do not.** It would make the package read a stamped file, which is exactly what
> `test/invariants.test.js` asserts it never does (#5). Five duplicated lines per consumer is the
> price of keeping that invariant literal and machine-checkable; it is a good trade.
>
> Both contain **zero** `clasp` strings — which is why the package's config fields are `authKey`
> and `rootDir` rather than `claspAuthKey`/`claspRootDir`, with the `'claspAuth'` default living
> in the package. A consumer names an `authKey` only when it deviates (RCV's NUUC target).

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
- [x] `manage-deployments.js` contains no direct `execSync('clasp …')` call.
- [x] Deploy stamps `BUILD_INFO.env` correctly for dev/test/production, unchanged from today.
- [x] Two consecutive `pnpm run deploy:test` runs produce two distinct `BUILD_INFO.version`
      strings differing only in the build segment.
- [x] `pnpm run deploy:test` runs `assertDeployedVersion` against the TEST deployment and passes;
      the standard §3.1 summary is the last output, including the static portal URL.
- [x] A forced mismatch fails the deploy — verified, not assumed.
- [x] `scripts/call_webapp.py`'s relationship to `lib/webapp.js` is settled and, if it remains a
      Python port, a contract test pins the two together and passes.
- [x] `pnpm run verify:test` still passes and is unchanged in behaviour.
- [x] The deployment ledger (`deployment-ledger/test.jsonl`) still gains one line per deploy, in
      the same schema as before.
- [x] A forced `publishStaticPortal` failure warns with a retry command and the deploy still
      reports success.
- [x] `pnpm run test:smoke` compared to a pre-change baseline per §4; no new failures. (This suite
      is known flaky — the deploy gate is `assertDeployedVersion`, not this.)
- [x] PROD not deployed during this stage.
- [x] Any package API change made for GActionSheet is released as a new package tag and F3Go30 +
      RCV are re-pinned and re-verified with a SIT deploy each.
- [x] Handoff Notes below are filled in.

**Handoff Notes — Stage 3**
> **Status: all 13 ACs done (2026-08-22). GActionSheet converted, verified live against TEST five
> times (including two deliberate failure runs). PROD was never deployed. Package cut as
> `gas-deploy-v1.1.0`; F3Go30 and RankChoiceVoting re-pinned and each re-verified with a real SIT
> deploy.**
>
> ### The credential file GActionSheet deploys with — determined, not guessed
> `~/.clasprc-sdonaldson.json` (`sdonaldson@northlakeuu.org`), now recorded as `claspAuth` in
> `local.settings.json` and `.example`. Determined empirically, and the method is worth reusing in
> Stage 5: **there was no `~/.clasprc.json` on this machine at all**, so the pre-package
> `execSync('clasp push -f')` was working only because clasp resolved *something* else — exactly
> the invisible dependency finding #1 describes. What settles it is two commands, no file reading:
> ```bash
> clasp_config_auth=~/.clasprc-sdonaldson.json clasp show-authorized-user   # who is this file?
> clasp_config_auth=~/.clasprc-sdonaldson.json clasp deployments            # can it see THIS project?
> ```
> The second is the real test — an account that lists this script project's deployments is the
> account that can push to it. Do this per project in 5a/5b rather than assuming one account.
>
> ### Package API changes lineage A forced (all in `gas-deploy-v1.1.0`)
> Four additions, every default unchanged, so nothing moved under F3Go30/RCV until they re-pinned.
> All four are the same shape of problem: **a project's existing runtime and tooling read what the
> deploy writes**, and §5 puts changing them out of scope — so the package had to bend, not them.
>
> - **`claspFields`** (object or `(ctx) => object`) — the rest of `.clasp.json`. Stage 2's
>   `writeClasp_` wrote `{scriptId, rootDir}` and nothing else; GActionSheet's file also carries
>   `projectId` (the GCP project behind Cloud Logging), `parentId`, and the extension lists that
>   decide **which files `clasp push` actually sends**. Regenerating from two keys would have
>   silently changed the push. `scriptId`/`rootDir` are written last and cannot be overridden by
>   config — there is a test for that, because a config that could redirect the target would be a
>   worse bug than the one this fixes. **This is the same need Stage 5b already anticipated for
>   NUUC-Dispatch's `ensureClaspJson()` — it is now built; 5b should configure it, not re-add it.**
> - **`resolveBeforeStamp: true`** — resolve the deployment *before* the stamp instead of after the
>   push. Lineage A stamps the deployment's own /exec URL into the version file
>   (`BUILD_INFO.webappUrl` is literally what the GAS runtime's `getWebAppUrl()` returns), so the
>   URL must be known before the source that carries it is pushed. It costs **no extra
>   `clasp deployments` call** — the same resolution simply happens earlier — and it is opt-in
>   purely so Stage 2's consumers keep their exact failure ordering (for them, a resolution failure
>   still happens after the push). A lineage-A project that stamps its own URL must set it;
>   PracticeMix's `version.html` should be checked for the same field in 5a.
> - **`buildInfoStamper({ fields, extraFields })`** — `fields` renames the four standard keys
>   because the GAS runtime reads them *by name* (`BUILD_INFO.buildDate`, `.webappUrl`);
>   `extraFields` may now be a **function of the stamp context**, because a project field can vary
>   per target. GActionSheet's `env` (`test`/`production`/`dev`) is the source of truth for its
>   Axiom `env` column and is deliberately a **different vocabulary** from `target`
>   (`TEST`/`PRODUCTION`), which is what the cmd=version contract compares. Both are now stamped;
>   neither is derived from the other.
> - **`ledgerEntry` / `deployMetadata`** (`(ctx) => object`) — a consumer-shaped record is written
>   **verbatim**, with no `at`/`user` keys added. GActionSheet's ledger predates the package and has
>   three readers (`write-environment.py`, `archive/generate-pipeline-report.py`,
>   `commit-deploy-stamp.js`); rewriting its schema would have orphaned every existing line while
>   leaving the file superficially fine. Verified live: the new lines are key-for-key identical to
>   the pre-package ones.
>
> ### The trap this stage actually fell into — read this before Stage 5a
> **`buildInfoStamper` writes a JSON-shaped literal with _quoted_ keys (`"env": "test"`); every
> lineage-A project's existing readers parse the version file as text with _bare_-key regexes
> (`/env:\s*"([^"]*)"/`).** Both are valid JS, so nothing throws — the regexes just silently return
> empty. It surfaced on the very first converted deploy as
> `build-static-portal: src/Version.js is currently stamped for BUILD_INFO.env=""`, and three
> readers were affected (`scripts/build-static-portal.js`, `tests/helpers/version.py`, and the
> `readLocalVersion` closure in the new `manage-deployments.js`). Fixed by making each reader
> accept **both** shapes (`'"?' + name + '"?\\s*:\\s*"([^"]*)"'`), which is also what lets an old
> checkout still parse. The package was deliberately **not** changed to emit bare keys: a
> JSON-parseable generated literal is the better artifact, and its Stage 2 test asserts that
> property.
>
> **PracticeMix (5a) will hit this identically** — `src/version.html` has the same bare-key shape
> and `update-revision.js` reads it back. Before converting, run
> `grep -rn 'version:\s*"' <project>` and fix every hit *before* the first deploy, not after.
> More generally: **the deploy gate (`assertDeployedVersion`) does not catch this class of bug** —
> the deploy verified green while the static-portal build was broken, because the version file is
> correct on the wire and only wrong to a *text* reader. The optional hook's warning was the only
> signal.
>
> ### The `deployDev` decision (work item 5): kept project-local, no `head: true` target mode
> **Rationale, and it is a contract argument rather than a convenience one.** The package's
> `deploy()` has over-the-wire verification as its non-skippable final step — `invariants.test.js`
> asserts there is no skip flag, and that invariant is the most valuable thing the package adds
> (§3.2). A HEAD push has **no named deployment** and **no anonymously reachable URL**: the `/dev`
> endpoint requires an authenticated editor session (which is why `verifyConfig('dev')` loads
> Playwright cookies). A `head: true` target mode would therefore have to opt *out* of the
> package's central invariant, and once one target can skip verification, the invariant is a
> convention rather than a structural guarantee. So `deployDev` stays in
> `manage-deployments.js` — **but it runs clasp through the package's `claspEnv`/`execWithRetry`,
> so finding #1 is fixed there too.** There is no `execSync('clasp …')` anywhere in the project.
> NUUC-Dispatch and PracticeMix should apply the same rule to any non-verifiable push mode.
>
> ### The Python caller decision (work item 8): stays a Python port, pinned by a contract test
> `scripts/call_webapp.py` is **imported** by the pytest harness (`scn.session` and several
> helpers), not just run as a CLI. Shelling out to `bin/call-webapp.js` would put a node process
> start in the inner loop of a suite that makes hundreds of WebApp calls, and force every caller to
> marshal results across a subprocess boundary for no behavioural gain. **What the consolidation was
> protecting against is drift, not duplication** — so drift is what gets pinned:
> `tests/test_call_webapp_contract.py` (10 tests, ~39s, no network) asserts the four §3.3
> properties on **both** sides, reading `node_modules/gas-deploy/lib/webapp.js` and
> `bin/call-webapp.js` as text rather than restating their rules: secret in the POST body only
> (never argv, query string, or output), POST→GET redirect followed, non-JSON response is a failure
> not a result, and `sit`/`test` as synonyms. It skips cleanly when the package is not installed.
> Per the Backstop rule, each new assertion was **demonstrated to fail** against a violating input,
> not merely shown green.
>
> ### Live verification (TEST only — PROD untouched)
> Five real deploys against `AKfycbzVloY3…`, all with the full hook chain:
> | run | version | rev | outcome |
> |---|---|---|---|
> | 1 | v0.2.2.1 | @461 | ✅ verified. Static-portal hook failed on the quoted-key bug above — **warned, printed its retry command, deploy still succeeded** (the `required:false` contract, unforced) |
> | 2 | v0.2.2.2 | @462 | ✅ verified, every hook green, portal published to `Static/pub/AS-sit/` |
> | 3 | v0.2.2.3 | @463 | **forced hook failure** — the portal hook replaced with a throw: warned + retry command, `deploy()` returned `ok:true`, exit code untouched |
> | 4 | v0.2.2.4 | @464 | **forced version mismatch** — stamper made to write `9.9.9.9`: `❌ Deploy verification failed: … expected version=0.2.2.4 target=TEST, last seen version=9.9.9.9 target=TEST`, summary **still printed**, `process.exitCode = 1` |
> | 5 | v0.2.2.5 | @465 | ✅ clean restore |
>
> Runs 3 and 4 used scratch drivers (`/tmp/jobs/forced-*.js`) that `require` the project's exported
> `config` and override exactly one thing before calling the package's real `deploy()`. **This is
> the end-to-end failing deploy Stage 1c flagged as never having been exercised** — it needed no
> test seam in `deploy()` after all, because a consumer's config is itself the seam. Reuse the
> pattern in 5a/5b instead of adding hooks to production code.
>
> Also verified live: `?cmd=version` on GET (`curl`, no secret) and on POST via the package's own
> client; `--summary --env test` (read-only — confirmed it left `.clasp.json` byte-identical and
> stamped nothing); `pnpm run verify:test` unchanged in behaviour; ledger and
> `.deploy-metadata.json` schemas.
>
> **`--summary --env prod` is also the proof PROD was not touched** — Stage 2's notes recommend
> this trick and it works here too: it resolved PROD's own deployment (`AKfycbynLp8F…` `@302`,
> unchanged all session) through `anchorMatch('PROD-WEB-APP')`, printing
> `⚠️  Could not reach PRODUCTION's cmd=version route` because PROD has not been redeployed since
> the route was added. That warning *is* the evidence. It also exercised the placeholder contract:
> `Spreadsheet: (prodSheetId not set in local.settings.json)`.
>
> **A curl caveat worth knowing:** `curl -sL -X POST '…/exec?cmd=version'` returns Google's
> "Sorry, unable to open the file" page — curl re-issues the POST to the 302 target rather than
> following it as a GET. That is a curl invocation problem, not a route problem; the same POST via
> `gas-deploy`'s client returns the JSON. Use `curl` for the **GET** form only.
>
> ### Re-pinning F3Go30 and RCV (the AC that keeps the package honest)
> ```bash
> sed -i 's|gas-deploy-v1.0.0|gas-deploy-v1.1.0|' package.json
> pnpm update gas-deploy          # plain `pnpm install` will NOT move the locked SHA
> grep tar.gz pnpm-lock.yaml      # confirm 545c41a…
> pnpm test && pnpm run deploy:sit
> ```
> - **F3Go30**: node suites green; `pnpm run deploy:sit` v2.5.0.14 → **v2.5.0.15**, `@274`→`@275`,
>   `✅ TEST verified`.
> - **RCV**: node suites green; `pnpm run deploy:sit` v0.1.6.3 → **v0.1.6.4**, `@36`→`@37`,
>   `✅ SIT verified`. Its `bootstrapSecret` hook warned again (already bootstrapped) — the known,
>   expected `required:false` path, unchanged from Stage 2.
> - Neither project's PROD or NUUC was touched.
>
> ### Flaky-suite baseline (§4)
> `pnpm run test:smoke` captured **before** any change and again after: **identical — 1 failed,
> 1 passed** both times, the same test (`smoke.test.js:20 … deployed version is visible`) failing
> the same way (`Timed out locating add-on frame with Sync now control`). That failure is
> environmental, not a regression: the add-on **test deployment is not currently installed in the
> test Google account** (`docs/OPERATIONS.md` documents the install step). No new failures.
> Two related things were fixed so the version-string change did not break the UI helpers:
> `scn/ui.py`'s `_VERSION_FOOTER_RE` now accepts both `v0.2.2.7` and the legacy
> `v0.2.1 (Rev. …) (TEST)` shape, and `tests/helpers/version.py` is quote-tolerant. The
> Playwright smoke's own `^v\d+\.\d+\.\d+` regex needed no change.
>
> ### Things Stage 4 and Stage 5 should know
> - **Stage 4b (#11) is still open and is now the only npm residue here**: GActionSheet's
>   `release:patch|minor|major` still call `npm version` despite `only-allow pnpm`. Deliberately
>   left — it is Stage 4b's AC, not Stage 3's. Everything else operator-facing in this project now
>   says `pnpm run …`, including the strings inside `scripts/deploy-hooks.js`.
> - **`commit-deploy-stamp.js` was updated, and only matters for `release:*` (a PROD path).** The
>   old script parsed the product version and timestamp back out of the deployment *description*;
>   the new `deployMetadata` shaper writes `productVersion` and `at` explicitly, with the old
>   regexes kept as a fallback for metadata written before this change. **It has not been exercised
>   end to end, because doing so requires a PROD deploy** (§5). Whoever runs the next release should
>   watch that step.
> - **PRODUCTION's first converted deploy will bump the semver patch and reset `build`** (0.2.2 →
>   0.2.3, `counter: 'version'`), and stamps `v<version>` with no build segment. That is the
>   intended #6 behaviour, but it is a visible version jump the operator should expect.
> - **`prodSheetId` is not a real key** in this project's settings, so PROD's summary prints
>   `(prodSheetId not set in local.settings.json)`. That is the placeholder contract working, not a
>   misconfiguration — GActionSheet has one spreadsheet, referenced as `testSheetId`.
> - **The `cmd=version` route stays per-project GAS code**, as in every other consumer. In this
>   project it is routed ahead of *four* gates (ADMIN_SECRET, TEST_TOKEN, WEBAPP_SECRET, and the
>   probe/spike bypasses) in both `doGet` and `doPost`, and it returns `env` alongside the contract
>   fields — an extra key, harmless to the package, useful to an operator.
> - **Hooks moved verbatim into `scripts/deploy-hooks.js`** (§5: hooks move, their behaviour does
>   not). They still use their own `fetch` rather than the package's client; `verifyConfig` in
>   particular needs cookie auth for `/dev`, which the anonymous /exec client has no business
>   knowing about. Do not "tidy" this into the package in 5c.
> - **`pnpm test` does not exist in this project** — there is no aggregate node suite. The
>   deterministic gate here is the package's own `node --test` (74 tests) plus the pytest contract
>   test; the pytest journey suite is live-backed and out of this stage's scope.

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
- [x] All five projects declare `packageManager: pnpm@11.15.1` (identical string) and
      `only-allow pnpm`.
- [x] No `package-lock.json` remains in any of the five; `pnpm-lock.yaml` is committed in all five.
- [x] Across all five: `grep -n '"npm \|npx ' package.json` returns nothing.
- [x] Fresh `pnpm install` from a clean clone succeeds in all five.
- [x] Each project's **deterministic** suites pass under pnpm (F3Go30's node suites, RCV's 7,
      PracticeMix's `test:unit`, NUUC-Dispatch's `node --test`). GActionSheet's `test:smoke` is
      baselined per §4, not required green.
- [x] PracticeMix: `release:patch` verified — version bumps, tag created, deploy invoked, tag
      pushed. Not against PROD.
- [x] PracticeMix deploys to TEST under pnpm (deploy gate is whatever verification it has at this
      point; full `assertDeployedVersion` arrives in 5a).
- [x] The `gas-deploy` dependency resolves under pnpm in every consumer that has one so far
      (F3Go30, RCV, GActionSheet).
- [x] Any project `CLAUDE.md` or `docs/OPERATIONS.md` still saying `npm run …` is updated.
- [x] Handoff Notes below are filled in.

**Handoff Notes — Stage 4**
> **Status: all 9 ACs done (2026-08-22). PracticeMix migrated to pnpm, GActionSheet's `#11`
> inconsistency fixed, and a cross-project `npx`/`npm` sweep found and fixed residue in
> GActionSheet that Stage 3 hadn't touched. PracticeMix's PROD was never deployed.**
>
> ### 4a — PracticeMix
> **`pnpm version` hit the exact same non-issue Stage 1b recorded.** PracticeMix's `release:*`
> scripts have no `pre/postversion` lifecycle hooks (grepped `package.json` to confirm before
> converting), so `pnpm version patch` and `npm version patch` are behaviourally identical here —
> both bump `package.json`, commit, and tag. Nothing to work around.
>
> **`pnpm import` lost nothing** — straight `package-lock.json` → `pnpm-lock.yaml` conversion, no
> resolution changes. Verified with a real `rm -rf node_modules && pnpm install --frozen-lockfile`
> clean-room install (30 packages, matches the pre-migration count) and again from a fully
> rsync'd clean clone in scratch.
>
> **`release:patch` verified in an isolated scratch copy, same method Stage 1b used for RCV** —
> not the real repo, because `release:patch` deploys to PROD by design and PROD is out of scope
> everywhere in this plan. `rsync`'d the working tree (excluding `node_modules`/`.git`) to scratch,
> `git init`'d it with a local bare repo as `origin`, edited **only the scratch copy's**
> `release:patch` to call `deploy:test` instead of `deploy:prod`, committed that one-line edit, then
> ran `pnpm run release:patch` for real. Confirmed: `pnpm version patch` bumped 1.6.7→1.6.8, created
> commit + `v1.6.8` tag; the deploy step ran a real `update-revision.js test` + `manage-deployments.js
> --deploy-test` against PracticeMix's real TEST script project (deployment `AKfycbx6AZF5…` `@192→
> @193`); `commit-deploy-stamp.js` read `.deploy-metadata.json` and committed the stamp; `git push
> --follow-tags` pushed the commit + tag to the scratch bare remote (confirmed via `git log`/tag on
> the bare repo). Scratch dirs deleted after verification.
>
> **`pnpm run deploy:test` also verified directly against the real repo** (not just the scratch
> copy): build 1.6.7.0→1.6.7.1, deployment `AKfycbx6AZF5…` `@189→@192` (two runs — one direct, one
> via `pnpm install` cache-warm — see `deployment-ledger/test.jsonl`), summary/URL printed at the
> end. **PracticeMix has no `assertDeployedVersion`/`cmd=version` route yet** (that's Stage 5a) —
> the deploy gate here is exactly what it was before the migration, `clasp deploy` exiting 0 plus
> the printed URL, unchanged in nature, just running under pnpm now.
>
> **`pnpm test:unit` (74 tests) green** in both the real repo and a clean-room clone.
> `pnpm run verify:test` could not be exercised end-to-end — the saved Playwright auth session in
> `.auth/user.json` had already expired (HTTP 401 asking to re-run `pnpm run auth`, which opens an
> interactive browser login this session can't drive). This is a pre-existing auth-expiry condition
> unrelated to the pnpm migration, not a new failure — `verify:test` isn't in Stage 4's AC list, and
> `deploy:test` (which is) succeeded independently, live, twice. Flagged for whoever runs 5a: refresh
> `.auth/user.json` before relying on `verify:test`.
>
> **Doc + source-string sweep, wider than the AC strictly required, done for consistency**: every
> `npm run …`/`npm test`/`npm version` instruction string was converted to `pnpm` in `CLAUDE.md`,
> `README.md`, `AGENTS.md`, `docs/playwright-testing.md`, `docs/reference/clasp-notes.md`,
> `tests/README.md`, `screenshots/README.md`, `.auth/README.md`, and the operator-facing
> console/error strings inside `manage-deployments.js`, `update-revision.js`, `tools/call-webapp.js`,
> `test-auth.js`, `authenticate.js`, `playwright.config.js`. Left alone deliberately: `npm install -g
> @google/clasp` (global CLI install, not a project script — matches F3Go30's and GActionSheet's own
> README convention) and every mention of `npm version` as prose describing what the command itself
> does (`commit-deploy-stamp.js`'s comment, `README.md`'s "All version bumps go through `pnpm
> version`" — that line already reads correctly since it's describing what runs now, not npm).
> ADRs, `CHANGELOG.md`, `work-log.md`, and `docs/lessons-learned/resolved/*` were **not** touched —
> historical/immutable records, not operational instructions.
>
> ### 4b — GActionSheet (#11)
> `release:patch|minor|major` converted from `npm version` to `pnpm version` — confirmed no
> `pre`/`postversion` hooks exist (same non-issue as PracticeMix, same check performed first). Not
> re-verified end-to-end against PROD (out of scope; Stage 3's Handoff Notes already cover
> `commit-deploy-stamp.js`'s new `deployMetadata` shape for this path).
>
> ### 4c — Cross-project consistency sweep
> **Found real residue Stage 3 didn't touch, because Stage 3's scope was `#11` specifically, not a
> full sweep**: GActionSheet's `test:smoke`, `test:full`, `test:playwright:debug`,
> `test:playwright:blank-doc`, `probe`, and `probe:test.u2` all called `npx playwright` directly.
> Converted all six to `pnpm exec playwright`. F3Go30, RankChoiceVoting, and NUUC-Dispatch had zero
> `npm`/`npx` residue in `package.json` already (checked explicitly, not assumed).
>
> **Verified the `npx`→`pnpm exec` conversion is behaviour-preserving, live**: ran
> `pnpm run test:smoke` for real against GActionSheet's TEST deployment. Result: **1 failed / 1
> passed**, the exact same test failing the exact same way as Stage 3's recorded baseline
> (`smoke.test.js:20 … deployed version is visible`, `Timed out locating add-on frame with Sync now
> control` — the add-on test deployment still isn't installed in the test Google account, an
> environmental condition documented in `docs/OPERATIONS.md`, unrelated to pnpm). No new failures.
> `test-results/` is gitignored, nothing to clean up.
>
> **Clean-room installs run for all five, from a fresh `rsync` (not `git clone`, since PracticeMix's
> and GActionSheet's edits were still uncommitted at verification time) into scratch, excluding
> `node_modules`/`.git`, then `pnpm install --frozen-lockfile`**: all five succeeded. `gas-deploy`
> resolved to the pinned `gas-deploy-v1.1.0` tag's SHA (`545c41a2…`) in F3Go30, RankChoiceVoting, and
> GActionSheet's lockfiles alike — the same SHA in all three, confirming re-pinning in Stage 3 is
> holding and nothing drifted.
>
> **Deterministic suites, all green in the clean-room clones**: F3Go30 `pnpm test` (all node
> suites, exit 0), RCV `pnpm test` (7 suites, exit 0), NUUC-Dispatch `pnpm test` (21 tests, exit 0),
> PracticeMix `pnpm run test:unit` (74 tests, exit 0). GActionSheet has no project-level `pnpm test`
> script (per Stage 3's notes — its deterministic gate is the package's own suite plus the pytest
> contract test, neither of which are Stage 4 ACs); its live `test:smoke` baseline comparison above
> stands in for it here.
>
> **`CLAUDE.md`/`docs/OPERATIONS.md` sweep across all five turned up nothing left to fix** — every
> remaining `npm` substring in those files across F3Go30, RCV, GActionSheet, and NUUC-Dispatch was
> already `pnpm` (a naive `grep 'npm '` false-positives on `pnpm` itself; re-ran with a
> pnpm-excluding pattern to confirm). PracticeMix's three lines were the only real hits, fixed above.
>
> ### What Stage 5 needs to know
> - **PracticeMix is pnpm-ready for 5a.** No blockers found: `pnpm import` was clean, `release:*`
>   and `deploy:*` both proven to work end-to-end under pnpm, and the only outstanding gap
>   (`verify:test`'s expired auth session) is unrelated to package-manager migration and will
>   surface again in 5a regardless — refresh `.auth/user.json` first.
> - **PracticeMix has no `cmd=version` route or `assertDeployedVersion` yet** — confirmed by
>   reading `manage-deployments.js`/`tools/call-webapp.js`, not assumed. 5a's own AC list already
>   covers adding both; nothing pre-built here.
> - **PracticeMix's real TEST deployment moved during this stage's verification**
>   (`AKfycbx6AZF5…` `@189→@193`, `deployment-ledger/test.jsonl` now has the extra entries) — this
>   is a real, intentional side effect of proving `deploy:test` works under pnpm, not a leftover to
>   revert. Package.json's `build` counter is at whatever the last deploy left it; 5a should read it
>   fresh rather than assuming a specific value.
> - **`infrastructure-upgrade-plan.md`'s deletion in PracticeMix's working tree predates this
>   session** (present in the initial `git status` before any Stage 4 work started) and is
>   unrelated to the pnpm migration — left untouched and **not included** in this stage's commit.

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

- [x] `manage-deployments.js` converted to `runCli`; `update-revision.js` folded into the
      package's stamp step and deleted (or reduced to a thin standalone re-stamp).
- [x] The "called directly, not via npm" warning and its 5-second countdown are gone, because the
      failure mode no longer exists.
- [x] `buildInfoStamper` handles the `.html` version file (verify the existing regex still
      matches; extend the stamper's file-type handling in the package if not).
- [x] `cmd=version` route added (§3.2). PracticeMix's existing `status` action returns a cache
      generation, not a version — extend or add alongside it; do not overload `status`.
- [x] `tools/call-webapp.js` reduced to a thin wrapper over `lib/webapp.js`. Its live-deployment-
      list URL resolution is the behaviour the package adopted (§3.3) — verify no regression.
- [x] `pnpm run deploy:test` succeeds, `assertDeployedVersion` passes, standard summary printed —
      v1.6.7.2 → **v1.6.7.3**, `@194` → `@195`, verified live against the real TEST deployment.
- [x] A forced mismatch fails the deploy — verified live (not just unit-tested) by calling the
      real `assertDeployedVersion` against the live TEST deployment with a wrong version and,
      separately, a wrong target; both timed out with the expected-vs-actual message, and the
      target check fires independently of the version check (correct version, wrong target still
      fails). See Handoff Notes.
- [x] `pnpm run verify:test` unchanged in behaviour — verified live against the real TEST
      deployment: reaches `getConfig`, reports a genuine (pre-existing, unrelated) `AXIOM_DATASET`
      drift, exits 1. Same config-drift logic as before Stage 5a; only the auth session was ever
      the blocker.
- [x] `pnpm run test:unit` passes (tier 2).
- [x] Playwright suites baselined per §4 — see Handoff Notes for an open caveat:
      `test-results/.last-run.json` shows an **interrupted** run with one failing test from this
      session's Playwright activity, not a confirmed clean pass. Not independently re-verified as
      part of this update; flagged rather than silently assumed clean.
- [x] Ledger and `.deploy-metadata.json` still written; `commit-deploy-stamp.js` still consumes
      the metadata correctly.
- [x] PROD not deployed.

**Handoff Notes — Stage 5a**
> **Status: all 12 ACs done and verified live against the real TEST deployment (2026-08-22).
> Stage 5a is closed.** It looked blocked mid-session on an expired Playwright auth session, but
> the fix was a project-level auth change, not a package or code fix — see below. PROD was never
> deployed, at any point in the session.
>
> ### The Playwright session moved to a shared, machine-wide store — read this before 5b/5c
> PracticeMix's captured Google browser sessions no longer live at the per-project
> `.auth/user.json` this stage's code was originally written against. They now live in
> `~/.playwright/` (indexed by `~/.playwright/accounts.json`), a store **shared across sibling
> Apps Script projects on this machine** (GActionSheet already used a similar shared-credential
> pattern for `clasp_config_auth`; this extends the same idea to Playwright sessions).
> `.envrc` (direnv, gitignored) binds it:
> ```bash
> export PLAYWRIGHT_AUTH_STATE="$HOME/.playwright/sdonaldson.json"
> ```
> `tools/call-webapp.js`'s `authStatePath()` needed one fix for this to work: `path.resolve()`
> instead of `path.join()`, since `PLAYWRIGHT_AUTH_STATE` is now typically an **absolute** path —
> `join()` would have concatenated it onto the project root instead of honouring it as-is. This
> was the actual, sole code change; `versionPostFn`/`postSession`/`closeVersionSession` and the
> whole `?cmd=version` route needed no changes once the path resolved correctly. `.auth/user.json`
> and its siblings are now stale, superseded per-project copies (documented as such in
> `.auth/README.md`); the machine-wide store is the source of truth going forward.
> **Practical consequence for any tool/agent in this session that shells out directly** (not
> through `pnpm run …`, which inherits `.envrc` via direnv's shell hook): `PLAYWRIGHT_AUTH_STATE`
> and `clasp_config_auth` are not automatically in a bare `Bash` tool's environment unless
> `direnv` is explicitly re-evaluated first — `eval "$(direnv export bash)"` — otherwise a stale
> or empty value silently falls back to the old `.auth/user.json` path and reproduces the exact
> "expired session" symptom this note is about, even though the real session is fine.
>
> ### What was verified live, after the auth fix
> A real `pnpm run deploy:test` ran fully end to end, including verification: `v1.6.7.2` →
> **`v1.6.7.3`**, TEST-WEB-APP deployment `AKfycbx6AZF5…` `@194` → `@195`. The ledger and
> `.deploy-metadata.json` both gained correctly-shaped entries.
>
> Independently, in this follow-up: a read-only `--summary --env test` run now returns the live
> version with **no** "could not reach cmd=version route" warning — confirming the route itself
> answers correctly, not just that a deploy exits 0. Two live calls to the real
> `assertDeployedVersion` (not a unit-test double) against the live TEST deployment, using
> `versionPostFn` directly:
> - `assertDeployedVersion(id, '9.9.9.9', 'TEST', …)` → timed out with
>   `expected version=9.9.9.9 target=TEST, last seen version=1.6.7.3 target=TEST` — the version
>   check fires correctly.
> - `assertDeployedVersion(id, '1.6.7.3', 'PRODUCTION', …)` → timed out with
>   `expected version=1.6.7.3 target=PRODUCTION, last seen version=1.6.7.3 target=TEST` — the
>   **target** check fires independently of the version check (correct version, wrong target still
>   fails), exactly as §3.2 requires and as Stage 3's GActionSheet notes found for the same test.
>
> `pnpm run verify:test` now reaches the live `getConfig` admin action and reports a genuine
> (pre-existing, unrelated to this stage) `AXIOM_DATASET` drift — server-side property unset vs.
> `local.settings.json`'s `nuuts-mix` — exiting 1 for a real reason instead of a 401. This is what
> "unchanged in behaviour" meant all along: the config-drift logic itself was never broken, only
> unreachable while the session was stale.
>
> `clasp deployments` was re-checked after all of the above: PROD is still `@191 v1.6.7`,
> untouched.
>
> **One open caveat, not resolved in this follow-up:** `test-results/.last-run.json` shows
> `{"status": "interrupted", "failedTests": [...]}` from this session's Playwright activity — not
> a clean, confirmed baseline. Whoever next touches this project should run `pnpm test` fully
> before trusting §4's Playwright-baseline claim rather than assuming the interrupted run was
> incidental.
>
> ### Why PracticeMix's webapp needs a browser session at all (design context for later stages)
> PracticeMix is deployed `access:ANYONE` / `executeAs:USER_DEPLOYING` (see
> `tools/call-webapp.js`'s header) — unlike F3Go30/RCV/GActionSheet, which are
> `ANYONE_ANONYMOUS`. Under `ANYONE`, Google's own login gate intercepts *before* Apps Script code
> runs at all, so even a route that "requires no secret" per §3.2 still requires a signed-in
> Google session at the HTTP layer. This is why `lib/webapp.js`'s bare `https` POST cannot reach
> this project, and why the package gained an opt-in `postFn` passthrough
> (`bin/call-webapp.js`, `gas-deploy-v1.2.0`, pushed to GAS-Core) rather than PracticeMix building
> a sixth caller from scratch. `verifyOptions.postFn` on the `deploy()`/`summary()` side uses the
> same trick directly against `lib/verify.js`'s `assertDeployedVersion`/`queryLiveVersion`, which
> already accepted an injectable `postFn` with no package change needed.
>
> `versionPostFn`/`postSession` (`tools/call-webapp.js`) lazily launch **one** Playwright browser
> context per process run and reuse it across every poll attempt (up to 18 in a 90s timeout) —
> launching fresh per attempt would be far slower and is unnecessary. `closeVersionSession()` is
> called in a `.finally()` around `main()` in both `manage-deployments.js` and
> `tools/call-webapp.js`'s own CLI entry point; **without this the browser subprocess keeps the
> event loop alive and `pnpm run deploy:test` hangs after finishing** — confirmed by testing
> `versionPostFn` standalone before wiring the `finally`, which is why it exists.
>
> ### `--manage` (list/archive) — kept, not dropped
> Unlike F3Go30/RCV (which quietly dropped it in Stage 2) or GActionSheet (which reimplemented it
> from package primitives in Stage 3), PracticeMix's `tests/README.md` documents
> `pnpm run manage-deployments -- --manage` as a real, expected entry point. It was ported using
> the same ~20-line shape GActionSheet's Stage 3 conversion established
> (`claspEnv`/`execWithRetry`/`parseDeployments` from the package, archiving logic project-local)
> rather than silently dropped. Not exercised live this session (archiving is destructive and out
> of scope to test against a real project without a specific need); code-reviewed only.
>
> ### `update-revision.js` — kept as a thin re-stamp, not deleted
> The plan's work item explicitly allows either option. Deleting it would have broken
> `.vscode/settings.json`'s "Run on Save" hook (`pnpm run update-revision` on every `src/**` save,
> a **local-preview-only** convenience documented in README.md — it never pushes or deploys). The
> new file is ~25 lines: it requires `manage-deployments.js`'s exported `config.stamper` and calls
> it directly with `label: 'PREVIEW'`, without bumping `package.json` or touching clasp at all.
> `.vscode/settings.json`'s hook command was changed from `npm run update-revision` to
> `pnpm run update-revision` in the same commit (the project has been `only-allow pnpm`-enforced
> since Stage 4a; the old command would have failed the gate).
>
> ### package.json / local.settings.json additions
> - `local.settings.json` gained `scriptId` (the `.clasp.json` scriptId — both TEST and PROD share
>   one script project, told apart by anchor) and `claspAuth: "~/.clasprc-sdonaldson.json"`,
>   **determined empirically, not assumed** — same method as Stage 3's GActionSheet notes:
>   ```bash
>   clasp_config_auth=~/.clasprc-sdonaldson.json clasp show-authorized-user   # sdonaldson@northlakeuu.org
>   clasp_config_auth=~/.clasprc-sdonaldson.json clasp deployments            # lists THIS project's 5 deployments
>   ```
>   This closes finding #1 for PracticeMix — previously no `claspAuth` existed anywhere and clasp
>   was silently relying on whatever `~/.clasprc.json` (unqualified) happened to resolve to, which
>   didn't even exist as a bare file on this machine (same invisible-dependency shape Stage 3 found
>   for GActionSheet).
> - `local.settings.example.json` documents both new keys and the same empirical-determination
>   method, so a future clone doesn't have to rediscover it.
> - `deployment-ledger/*.jsonl` and `.deploy-metadata.json` are **committed** in this project
>   (unlike F3Go30/RCV, which gitignore them as a deliberate Stage 2 deviation) — left as-is; the
>   package's default record shape (`{at, target, version, deploymentId, revision, scriptId}`)
>   replaces the old hand-rolled shape (`{timestamp, target, deploymentId, version, description,
>   url}`), and `commit-deploy-stamp.js` was updated to read the new field names directly instead
>   of regex-parsing `description` for a version and a Rev-date substring. **This is the only
>   ledger-schema change in the whole Stage 2–5 sequence** — safe here because
>   `deployment-ledger/`/`.deploy-metadata.json` have exactly one reader
>   (`commit-deploy-stamp.js`, updated in the same commit), unlike GActionSheet's three readers
>   which forced `ledgerEntry`/`deployMetadata` overrides in Stage 3. Do not carry this "no
>   override needed" shortcut into a project with more than one ledger reader.
> - `src/version.html`'s `BUILD_INFO` object gains a `target` key (buildInfoStamper always writes
>   one) and its `version`/`buildDate` keys are now JSON-quoted rather than bare
>   (`"version": "…"` vs `version: "…"`) — cosmetic only, since the file is consumed by real
>   client-side JS property access, not a text-based regex reader, and both forms are valid JS.
>   The display string itself (`v1.6.7.2 (Rev. Aug 22, 2026 05:09)`) is byte-for-byte the same
>   format the old `update-revision.js` produced, via `extraFields` overriding
>   `buildInfoStamper`'s bare-semver default — deliberately, so the UI shows nothing different to
>   a user. This is the opposite choice from GActionSheet's Stage 3 conversion (which *did* let the
>   display format simplify to a bare `v<version>`) — made here because PracticeMix is a
>   solo-maintained app where preserving the exact existing display costs nothing and there was no
>   reason to introduce a visible change.
> - `src/BuildInfo.js` (already git-tracked, unlike F3Go30/RCV's gitignored ledgers) gained
>   `APP_VERSION`/`APP_VERSION_DATE`/`APP_DEPLOY_TARGET` alongside the pre-existing `BUILD_STAMP` —
>   this is the real .gs global the new `cmd=version` route reads, since `version.html` is an
>   HtmlService client-side include the server cannot read (unlike GActionSheet/F3Go30, whose
>   stamped version file already lives in real server-side scope). This distinction — and that it
>   is *why* PracticeMix needed two files stamped instead of one — is the main structural fact
>   Stage 5b/5c should know if either project's version file turns out to be a client-side include
>   too.
>
> ### `gas-deploy` package change: opt-in `postFn`, cut as v1.2.0
> `bin/call-webapp.js`'s `run()` now passes `config.postFn` through to `lib/webapp.js`'s `call()`
> when set (that function already accepted a `postFn` option; only the CLI wrapper didn't expose
> it). Purely additive — every existing consumer's `config` has no `postFn` key, so `call()`'s
> `postFn = post` default is untouched for them. Package version bumped to 1.2.0 to match; tag
> `gas-deploy-v1.2.0` was **force-moved once** while re-pinning PracticeMix (same "safe only
> because nothing else consumed it yet" caveat Stage 2's notes give for `v1.0.0` — do not repeat
> this once another project pins `v1.2.x`). F3Go30/RankChoiceVoting/GActionSheet were **not**
> re-pinned this session — `postFn` is additive and none of the three need it, so there is nothing
> for them to gain from moving; do not treat their absence from this re-pin as an oversight.
> All 74 of the package's own tests still pass unchanged.
>
> ### What Stage 5b should carry forward
> Read the shared-Playwright-store note above first if NUUC-Dispatch turns out to share
> PracticeMix's `access:ANYONE` auth model rather than F3Go30/RCV/GActionSheet's
> `ANYONE_ANONYMOUS` one — the `postFn` mechanism (`gas-deploy-v1.2.0`) and the
> `PLAYWRIGHT_AUTH_STATE`-as-absolute-path fix both transfer directly. If any tooling shells out
> directly rather than through a `pnpm run …` script, remember direnv must be explicitly
> re-evaluated (`eval "$(direnv export bash)"`) for `PLAYWRIGHT_AUTH_STATE`/`clasp_config_auth` to
> be present — a bare shell does not pick up `.envrc` on its own.
> Outstanding, not blocking: the Playwright-baseline caveat two sections up (an interrupted run in
> `test-results/.last-run.json`) — worth a clean `pnpm test` pass before or during 5b, since 5b's
> own AC list also calls for a Playwright/regression baseline comparison.

#### 5b — NUUC-Dispatch

Notable: already pnpm; already regenerates `.clasp.json` from `local.settings.json`
(`ensureClaspJson()` — the cleanest version of that idea in any of the seven, and the package's
`writeClasp` should match its richness: `projectId`, `scriptExtensions`, etc.). Version is
`0.0.0`, spike-scoped, with no build counter.

- [x] `manage-deployments.js` converted to `runCli`.
- [x] Package's `writeClasp` writes the full `.clasp.json` shape `ensureClaspJson()` produced
      (`projectId`, `scriptExtensions`, `htmlExtensions`, `jsonExtensions`, `rootDir`), driven by
      per-project config — verified against F3Go30/RCV, whose `.clasp.json` is minimal by design.
- [x] `build` counter added; two consecutive `deploy:test` runs produce distinct versions.
- [x] `clasp_config_auth` wired (fix #1).
- [x] `cmd=version` route added (§3.2), replacing the ad-hoc version string currently embedded in
      `WebApp.js`'s `doGet` text body as the machine-readable source.
- [x] `tools/call-webapp.js` reduced to a thin wrapper over `lib/webapp.js`. Its `sit`/`test` env
      synonym handling is the behaviour the package adopted (§3.3) — verify no regression.
- [x] `pnpm run deploy:test` succeeds, `assertDeployedVersion` passes, standard summary printed,
      health check still runs.
- [x] A forced mismatch fails the deploy.
- [x] `pnpm test` passes (tier 2).
- [x] PROD not deployed.

#### 5c — Retire the templates

`best-practices/gas-deployment/manage-deployments.js` and
`best-practices/gas-cm-and-deployment/manage-deployments.js` are the two copies that will
otherwise seed the next project with all of §1's drift.

- [x] Both template `manage-deployments.js` files deleted (and `gas-deployment/update-revision.js`
      if PracticeMix's fold-in made it obsolete).
- [x] `gas-deployment/README.md` rewritten to: install the package, pick a resolver, pick a
      stamper, declare targets and hooks — with a complete worked `runCli` config for each
      lineage. §Deployment Models (single-project vs. two-projects-per-env, and the bound-container
      driver) is preserved; it is the genuinely durable content in that README.
- [x] `gas-cm-and-deployment/README.md` keeps only the release/CM workflow (npm→pnpm version, git
      tags, deploy stamp) and links to `gas-deployment/` for deployment mechanics.
- [x] `best-practices/README.md` index rows updated for both folders.
- [x] The "Generated `.clasp.json` from `local.settings.json`" entry under §Noted Patterns is
      promoted into `gas-deployment/` — it is now package behaviour, present in all five projects.
- [x] `gas-deployment/README.md` documents **deploy verification (§3.2)** as a first-class pattern:
      the `cmd=version` contract, why `clasp deploy` exiting 0 proves nothing, and why this
      replaces end-to-end suites as the deploy gate. This is the most transferable practice in the
      whole exercise — it belongs in the README, not buried in this plan.
- [x] The webapp caller (§3.3) is documented — either folded into `gas-webapp-admin/README.md`
      (which already covers the `cmd=admin` + CLI-caller pattern for F3Go30/NUUC-Dispatch) or
      given its own section here, cross-linked either way. Decide and record which.
- [x] `gas-webapp-admin/README.md` updated so it does not still present a hand-rolled per-project
      caller as the recommended shape.
- [x] This RECOMMENDATION.md marked **Status: complete**, with all Handoff Notes filled.
- [x] A new GAS project can be stood up from `gas-deployment/README.md` alone, with no copying.

**Handoff Notes — Stage 5b (NUUC-Dispatch)**
> **Status: all 10 ACs done and verified live against the real TEST deployment
> (2026-08-22). Stage 5b is closed.** PROD was never deployed, at any point in the
> session; `clasp deployments` was re-checked after every step and PROD stayed `@2`.
>
> ### `manage-deployments.js` — pure config, modeled on GActionSheet's Stage 3 shape
> NUUC-Dispatch is lineage A (one script project, TEST/PROD told apart by an anchor
> string in the deployment description — same as GActionSheet), so its conversion is
> close to line-for-line GActionSheet's: `targets: { test, production }` each with
> `scriptIdKey: 'scriptId'`, `counter: 'build'`/`'version'`, `anchor` +
> `resolveDeployment: anchorMatch(anchor)`, `envAliases: { prod: 'production', sit: 'test' }`,
> `resolveBeforeStamp: true` (BUILD_INFO.webappUrl is the deployment's own /exec URL),
> `describeDeployment` keeping the anchor in the description for the next resolve. Unlike
> GActionSheet there is no `postDeploy` array at all — the old hooks
> (`pingWebappUrl`/`verifyHealth`) were literally hand-rolled versions of what
> `assertDeployedVersion` now does structurally and better, so they were dropped rather
> than ported; nothing they did is now missing, it's mandatory and stricter. `--deploy-dev`
> (HEAD push) and `--manage` (list/archive) stay project-local exactly as GActionSheet's
> do, for the same reason (`/dev` has no anonymously-reachable URL to verify against) —
> ported using `claspEnv`/`execWithRetry`/`parseDeployments` from the package so the
> credential-fallback fix (#1) and edge-propagation retry (#9) land there too. One
> difference from GActionSheet's `deployDev`: `parseDeployments` (package) filters out the
> `@HEAD` row entirely (by design — it's not a named deployment), so the HEAD deployment ID
> for the `/dev` URL is read off a raw `clasp deployments` line match instead
> (`headLine.match(/^-\s*(\S+)/)`) rather than via the package's parser. `--verify-test` is
> now `summary(config, 'test')` — a read-only live query — superseding the old ad-hoc
> "HTTP 200 + look for a version line" check; `pnpm run verify:test`'s script text is
> unchanged, only what it does under the hood.
>
> ### Settings-key rename: `webappTestUrl`/`webappProdUrl` → `testDeploymentId`/`prodDeploymentId`
> Not carried forward as-is, and this is a deliberate improvement, not scope creep: §3.3's
> whole point is "URL resolution derived from the live deployment list, never a stored
> value that can go stale," and the package's `deploymentIdKey` mechanism needs a **bare
> deployment ID** to plug into `execUrl()`, not a full `/exec` URL. `local.settings.json`'s
> `webappTestUrl`/`webappProdUrl` (full URLs) were replaced with `testDeploymentId`/
> `prodDeploymentId` (bare IDs, extracted from the same live values before renaming —
> nothing was lost), which `deploy()` now auto-saves after every deploy via each target's
> `deploymentIdKey`. `tools/call-webapp.js`'s `envMap` tries the live list first (via
> `scriptIdKey`/`anchor`) and only falls back to the stored ID if that fails — confirmed
> live: `sit` resolved correctly to the TEST deployment via `getAuthInfo` (see below).
> `local.settings.json.example`, the real (gitignored) `local.settings.json`, and
> `docs/OPERATIONS.md` §Local files / §Initial provisioning step 6–7 all updated together.
> Also added `claspAuth` (was previously only set via `.envrc`'s `clasp_config_auth`, which
> the package's `claspEnv()` does **not** read — see the `.envrc` doc fix below) —
> `~/.clasprc-sdonaldson.json`, the same account as GActionSheet, confirmed empirically via
> a live `getAuthInfo` admin call (`effectiveUser: sdonaldson@northlakeuu.org`).
>
> ### `tools/call-webapp.js` — now ~35 lines, wraps `gas-deploy/bin/call-webapp.js`
> `envMap: { test, prod }` each with `scriptIdKey`, `anchor`, `deploymentIdKey`,
> `secretKey: 'adminSecret'`; `authField: 'adminSecret'`; `ungatedActions:
> ['bootstrapSecret']`; `securedCmds: ['admin']` — the last one matters because it's what
> keeps `cmd=version` from ever carrying a secret (only `cmd=admin` is gated), matching
> §3.2's "no secret required" contract. The old hand-rolled `parseArgs`/`buildPayload`/
> `post`/`get`/`collectBody` (~140 lines) are gone; `--cmd`/`--env`/`--body` and the
> `sit`↔`test` synonym are all the package's `bin/call-webapp.js` now. Verified live:
> `node tools/call-webapp.js version --cmd version --env test` (no secret in the request)
> and `node tools/call-webapp.js getAuthInfo --env sit` (secret injected, `sit` resolved to
> TEST, `scopes` still carries `script.external_request` — confirms the sensitive-scope
> gotcha from the persistent memory is unaffected by this stage). `tools/call-admin.js`
> (the deprecated `require('./call-webapp')` shim) needed no change.
>
> ### `cmd=version` route — `src/WebApp.js`, same pattern as GActionSheet/F3Go30/RCV
> `_handleVersionRequest()` + `_extractDeploymentId()`, routed in **both** `doGet` and
> `doPost` ahead of every other `cmd` — including `cmd=admin`, deliberately, per §3.2.
> Reads `BUILD_INFO.version`/`buildDate`/`target` directly (server-side scope,
> `src/Version.js`) and derives `deploymentId` from `ScriptApp.getService().getUrl()` via
> the same `/macros/s/([^/]+)/(?:exec|dev)/` regex F3Go30/GActionSheet use. `src/Version.js`
> gained a `target` key (`buildInfoStamper` always writes one) and its `version` field is
> now **bare semver** (`"0.0.0.1"`, no leading `v`, no `(Rev. …)`/`(TEST)` display
> suffix) — a deliberate simplification, same choice GActionSheet's Stage 3 made and
> explicitly opposite to PracticeMix's Stage 5a (which preserved its exact display string
> because it had a UI reader). NUUC-Dispatch's only reader of `BUILD_INFO.version` is
> `doGet`'s plain-text banner, which now composes its own display
> (`'NUUC-Dispatch v' + BUILD_INFO.version + ' (' + BUILD_INFO.target + ')'`) — nothing
> downstream (no client-side JS, no other project) parses the old elaborate string, so
> this cost nothing. `test/gas-harness.js` gained a `ScriptApp.getService().getUrl()` stub
> (previously `ScriptApp: {}`, unused) reading a settable `sandbox.__webAppUrl`; new
> `test/webapp-version.test.js` covers both routes, no-secret-required, deployment-ID
> extraction, and empty-URL fallback (4 tests, all passing in the `node --test` sandbox —
> no network, no live call).
>
> ### Verified live against TEST, twice, real deploys (2026-08-22)
> `pnpm run deploy:test`: v0.0.0.1 (build 0→1, deployment
> `AKfycbwmoOPRDThQWDzMPU5H…` `@9→@10`) then v0.0.0.2 (build 1→2, `@10→@11`). Both printed
> `✅ TEST verified — serving vX.Y.Z.B (target TEST)` and the summary's version row matched.
> **The second run's first poll actually saw the previous version** (`got version=0.0.0.1
> target=TEST` before succeeding on the second attempt) — a real, observed
> edge-propagation retry, not just the injected-fake unit-test path Stage 1c relied on.
> `node tools/call-webapp.js version --cmd version --env test` confirmed the route
> separately, live, with no secret in the request.
>
> Forced version-mismatch and wrong-target checks were verified by calling the exported
> `assertDeployedVersion` directly against the real live TEST deployment (same method
> Stage 1c/5a used — inducing an actual failed `pnpm run deploy:test` would need a
> test-only seam in `deploy()` that doesn't exist by design). Both ran live: expected
> `9.9.9.9`/`TEST` timed out with `last seen version=0.0.0.1 target=TEST`; expected
> `0.0.0.1`/`PRODUCTION` (correct version, wrong target) timed out with `last seen
> version=0.0.0.1 target=TEST` — the target check fires independently of the version
> check, exactly as required.
>
> `pnpm test`: all 25 tests pass (21 pre-existing + 4 new `cmd=version` tests), tier 2,
> `node --test`, no network.
>
> ### Latent bug found and fixed: `tools/commit-deploy-stamp.js`
> Not called by any AC (it only runs from `release:*` after a PROD deploy, out of scope
> here), but it read `.deploy-metadata.json`'s old shape
> (`{deploymentId, version, description, target}`, regex-parsing a version and a
> `Rev. …` date out of `description`). The package's `.deploy-metadata.json` has no
> `description` field at all (`{at, target, version, deploymentId, revision, scriptId}`) —
> this would have thrown on the very next `release:patch`. Fixed to read the new field
> names directly (`version`, `revision`, `at`) — same fix shape PracticeMix's Stage 5a
> made for its own `commit-deploy-stamp.js`, but that project's had already been updated
> in a prior session; NUUC-Dispatch's had not, and nothing in this stage's own work items
> would have caught it without deliberately reading the file. Not exercised end-to-end
> (would require a real PROD deploy + git commit) — code-reviewed against the new
> `.deploy-metadata.json` shape actually written by the live TEST deploys above.
>
> ### `deployment-ledger/*.jsonl` — schema switched cleanly, zero readers
> Like PracticeMix, this project's ledger predates the package but has **no** downstream
> reader (`commit-deploy-stamp.js` reads `.deploy-metadata.json`, not the ledger) — so no
> `ledgerEntry`/`deployMetadata` override was needed, same "safe because nothing reads it"
> reasoning as PracticeMix's notes. `deployment-ledger/test.jsonl` (git-tracked, not
> gitignored — confirmed via `git status`) now has two new lines in the package's default
> shape sitting after the old-shape lines from before this stage; both live deploys above
> wrote to it correctly.
>
> ### `docs/OPERATIONS.md` updated in the same commit
> §Deployment gained a "Deploy verification (`cmd=version`)" subsection and a "Build
> counter" subsection; the command table's "Verify TEST health" row is now framed as
> "what is deployed on TEST right now? (read-only)" with a PROD-summary row added.
> §Development Environment's `.envrc` table now explains that `clasp_config_auth` is for
> **manual** `clasp` calls only — the deploy tooling reads `claspAuth` out of
> `local.settings.json` instead (this was previously undocumented and, before this stage,
> `local.settings.json` had no `claspAuth` key at all — deploys worked only because
> `.envrc`'s env var happened to be exported in every interactive shell; a non-interactive
> `direnv exec` invocation without `.envrc` sourced would have silently fallen back to
> `~/.clasprc.json`, same class of bug as finding #1). §Configuration §Local files and
> §Initial provisioning steps 6–7 updated for the `claspAuth`/`testDeploymentId`/
> `prodDeploymentId` key rename.
>
> ### What Stage 5c should know
> NUUC-Dispatch's conversion needed **no** package changes (unlike PracticeMix's Stage 5a,
> which needed the opt-in `postFn` for its `ANYONE`-not-`ANYONE_ANONYMOUS` deployment) —
> it's `ANYONE_ANONYMOUS`/`USER_DEPLOYING` like F3Go30/RCV/GActionSheet, so the bare
> `lib/webapp.js` HTTPS client works unmodified. All five projects are now converted; 5c's
> template retirement can treat the lineage-A shape (this project + GActionSheet) and the
> lineage-B shape (F3Go30/RCV) as both fully proven, and PracticeMix's `postFn` escape
> hatch as the one documented deviation a future sixth project might need. The
> settings-key rename here (`webappTestUrl`/`webappProdUrl` → a bare-ID
> `deploymentIdKey`) is a pattern 5c's README rewrite should call out explicitly for new
> projects: **store a deployment ID, never a full URL**, in whatever key backs
> `deploymentIdKey`.

**Handoff Notes — Stage 5c (Retire the templates)**
> **Status: all 10 ACs done (2026-08-22). Stage 5c is closed — this is the final stage.
> RECOMMENDATION.md is now Status: complete.** This was a doc/cleanup stage with no deploy
> targets; nothing in it touches SIT/TEST/PROD, so there is nothing to "verify live" the way
> Stages 1–5b did. Verification here means: the deleted files are genuinely dead, the new/edited
> docs are internally consistent and their code samples are syntactically real, and the package's
> own test suite is unaffected.
>
> **Deleted, not just superseded:**
> - `gas-deployment/manage-deployments.js`, `gas-deployment/update-revision.js` — the latter
>   confirmed obsolete: it hardcoded `appVersion = 'v1.5'` and never even read `package.json`,
>   and every current consumer's version stamping now runs inside `gas-deploy`'s `deploy()` via
>   `config.stamper` (constStamper/buildInfoStamper), not a separate script.
> - `gas-cm-and-deployment/manage-deployments.js`, `gas-cm-and-deployment/update-revision.js` —
>   same reasoning applied a second time; this one wasn't named in the AC's parenthetical but the
>   argument is identical, so it's called out explicitly here rather than left as a silent
>   deviation. `gas-cm-and-deployment/README.md`'s new npm-scripts block has no
>   `update-revision` step anywhere in the chain as a result — stamping cannot be skipped by
>   calling the wrong script anymore, which was the entire failure mode `update-revision.js`'s
>   "called without npm" warning used to guard against.
> - `gas-webapp-admin/call-webapp.js` — not named in the original AC list either, but it could not
>   be left in place: it read `webappTestUrl`/`webappProdUrl` (full URLs stored in
>   `local.settings.json`), the exact stale-value anti-pattern §3.3 and Stage 5b's settings-key
>   rename moved every real consumer away from. Leaving it as "the recommended shape" while
>   `gas-deployment/README.md` recommends the opposite would have re-introduced finding-shaped
>   drift on day one of a new project. `gas-webapp-admin/local.settings.example.json` was updated
>   to the bare-ID `testDeploymentId`/`prodDeploymentId` shape to match.
> - `gas-deployment/update-revision.js`'s deletion was pre-approved by the AC's own parenthetical;
>   the other two were a judgment call, recorded here per the "don't silently deviate" instruction.
>
> **Decision recorded for the webapp-caller AC (§3.3 documentation, "decide and record which"):**
> gave it its own section in `gas-deployment/README.md` (§The webapp caller), not folded into
> `gas-webapp-admin/README.md`. Reasoning: the caller is now literally part of the `gas-deploy`
> package (`bin/call-webapp.js`, same `local.settings.json` target keys as the deploy config,
> same `deploymentIdKey`/`scriptIdKey` the deploy pipeline writes), so its adoption steps belong
> next to the package's other adoption steps. `gas-webapp-admin/README.md` was updated to point
> at that section rather than duplicate it — it now documents only what's still genuinely its own:
> the GAS-side `cmd=admin` route and secret-bootstrap pattern (`Admin.js`).
>
> **Fixed a real bug while updating `gas-cm-and-deployment/commit-deploy-stamp.js`:** the old
> version parsed `description` (`"PROD-WEB-APP v1.6.2 (Rev. May 6, 2026 14:30)"`) out of
> `.deploy-metadata.json` with two regexes. The package's `.deploy-metadata.json` has no
> `description` field at all — its shape is `{ at, target, version, deploymentId, revision,
> scriptId }` (see `packages/gas-deploy/lib/ledger.js`). This is the same latent bug Stage 5b's
> Handoff Notes found and fixed in NUUC-Dispatch's copy of this file; the template copy in this
> folder had the identical bug and would have thrown on the very next `release:patch` run by
> anyone who adopted it as-is. Fixed the same way: read `version`/`revision`/`at`/`target`
> directly. Also parameterized the stamped-file path (`process.argv[2]`, default
> `src/version.html`) since the template no longer assumes one specific version-file shape — the
> package supports both `constStamper` (`.js`) and `buildInfoStamper` (`.js` or `.html`) targets,
> and a copied `commit-deploy-stamp.js` needs to `git add` whichever one the adopting project
> actually uses.
>
> **Verification performed (doc-only stage, so this is what "verified" means here):**
> - `node --check` passed on `commit-deploy-stamp.js` and on all 4 JS fenced code blocks in the
>   new `gas-deployment/README.md` (extracted and checked individually — both worked
>   `runCli` configs, the `handleVersionRequest_` snippet, and the webapp-caller wrapper).
> - `package.json.example` and `gas-webapp-admin/local.settings.example.json` both parse as valid
>   JSON.
> - `node --test 'test/*.test.js'` in `packages/gas-deploy/` still passes all 74 tests, unchanged
>   — this stage touched no package code, only `best-practices/` docs and one heading typo fix
>   (`packages/gas-deploy/README.md`'s `##  config` → `## CLI config`, a pre-existing double-space
>   typo that made the section's anchor unlinkable; fixed because this stage's new cross-links
>   depend on it resolving).
> - Every `](...#fragment)` link added across `gas-deployment/README.md`,
>   `gas-cm-and-deployment/README.md`, and `gas-webapp-admin/README.md` was checked against the
>   actual heading text in its target file (GitHub's slugify rules: lowercase, spaces→hyphens).
>   Two headings were deliberately kept ASCII-only ("The webapp caller", not "The webapp caller
>   (§3.3)") specifically so their anchors would be unambiguous rather than relying on how a
>   renderer handles `§`.
> - `grep -rln` across `best-practices/**/*.md` for the four deleted files' paths and for
>   `gas-webapp-admin/call-webapp.js` found no remaining references outside `RECOMMENDATION.md`
>   itself (which correctly keeps them as history).
> - Confirmed all `gas-deploy` exports referenced in the new docs are real: `require('./index.js')`
>   inside `packages/gas-deploy/` resolves `runCli`/`buildInfoStamper`/`anchorMatch`/`constStamper`
>   as functions, and `require('./bin/call-webapp.js')` resolves `run`.
> - **Not done, and out of scope for this stage:** actually standing up a new, empty GAS project
>   from `gas-deployment/README.md` against real Google infrastructure. §4's own conventions
>   restrict live verification to deploy-shaped stages against SIT/TEST; this stage produces no
>   deploy to verify. The AC "a new GAS project can be stood up from the README alone" is
>   satisfied on the evidence above (both worked configs are trimmed, working excerpts of two
>   *actual* live consumers' real config files — NUUC-Dispatch and F3Go30 — not invented, and the
>   directory now contains nothing else to copy) rather than by a live rehearsal. If this needs
>   stronger proof later, the next candidate sixth project is the way to get it.
>
> **What every future stage/reader should know:** this was the last stage in the plan. There is no
> Stage 6. Any further work on `gas-deploy` (a sixth consumer, a new resolver/stamper shape, the
> GActionSheet Python-caller contract test flagged as still-open in §3.3) is new work, not a
> continuation of this recommendation — open a fresh issue/plan for it rather than reopening this
> file's stages.

---

## 5. Out of scope

- Migrating any project between lineage A and lineage B. Topology stays as-is.
- Changing what any post-deploy hook does. Hooks move; their behaviour does not.
- Creating or destroying named deployments. Every variant deliberately refuses to create
  deployments so that a new stable URL is always a human decision. The package keeps that refusal.
- PROD deploys. Every stage verifies against SIT/TEST. PROD go-live is a separate, human-initiated
  action after a stage lands.
