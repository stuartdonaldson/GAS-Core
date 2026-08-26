# STAGING — GAS-Core remaining work

**What this is:** the staging document for GAS-Core's remaining work. Authored per
`$DEVSTANDARD/doc-framework/planning-guide.md` §"Pattern D: Staged Execution" using the
`staged-plan` skill. It holds only what the tracker cannot: execution order, why beads are paired,
what each stage delivers, and the handoff notes.

**How to run it:** read this file completely, then *"execute stage 2"* or *"execute stage
`convert-rcv`"* — both address the same row. One stage is one session.

## Terminology

| Term | Meaning |
|---|---|
| **Bead** | The unit of *work*. Owns its acceptance criteria, priority, dependencies and status. Identified by its bd id. |
| **Stage** | The unit of *execution* — what one session claims, closes and hands off. Holds one or more beads. Identified by a **name** (`stage:convert-rcv`), carried as a bd label. |
| **`#`** | The stage's position in execution order. **Lives in this document only, never in a label** — re-ordering the plan edits this file and nothing else. |

A stage is not a synonym for a bead. Most stages here happen to hold one bead; that is a property of
this work, not of the model.

**The beads are authoritative.** Acceptance criteria, dependencies, priority, status, model
selection and owner decisions live on the beads — not here. Read a stage's AC with `bd show <id>`.
Do not copy AC into this file; that is the specific defect Pattern D exists to prevent.

**Stage contract:** planning-guide §Pattern D, nine rules. Not restated here.

**Relationship to `PLAN2.md`:** PLAN2 is the record of the review that produced this work — findings
F1–F21, the decisions taken, and handoff notes for the twelve stages already closed. It is
read-only history. Nothing below requires loading it; where a stage needs a finding's reasoning, its
bead cites the section. PLAN2's own `S1`–`S19` numbering is retired and is not used here.

**Delete this file when** the last stage closes and every *Found* item has been graduated to a
permanent home (README, ADR, `bd remember`, `work-log.md`).

---

## Execution order

Status mirrors bd; **bd is the authority**. Regenerate with `bd list --label stage:<name>`.

**Verify this table against the tracker** — never trust the mirror, check it:

| Command | Answers |
|---|---|
| `bdls --stages` | Roll-up: one row per stage, ordered by stage-level dependency waves — beads, ready, blocked, done, model, and the stage each is waiting on |
| `bdls --check` | The same, plus an audit of the `stage:` labels against the dependency graph (cycles, prerequisites hiding in unstaged beads, batches whose order is not modelled) |
| `bdls --goals --stage <name>` | One stage in context before opening it; prerequisites outside the stage are marked `(ext)` |

Note: `bd list --label-pattern`/`--label-regex` are silently ignored in bd 1.1.0 — they return
everything with no error. Use `bdls --stage '<glob>'` for wildcard stage matching.

| # | Stage | Bead | Status | Title |
|---|---|---|---|---|
| 1 | `pmix-prod` | `GAS-Core-gne` | ✓ | PracticeMix P5b: PROD deploy, `pub/pmix`, start retirement clock |
| 2 | `convert-rcv` | `GAS-Core-d7i` | ✓ | Convert RankChoiceVoting to gas-static (F7a) |
| 3 | `convert-gas` | `GAS-Core-rgh` | ✓ | Convert GActionSheet to gas-static (F7b) |
| 4 | `convert-f3go30` | `GAS-Core-hek` | ○ | Convert F3Go30; settle CSP/static-urls/`from:'resolve'`+CLI (F7c) |
| 5 | `libidentity-and-method` | `GAS-Core-na8` | ○ | `libs/LibIdentity`: canonical `Assertion_verify` for brokered identity |
| 5 | `libidentity-and-method` | `GAS-Core-dof` | ○ | Validate and land the staged-plan skill (F21) |
| — | — | `GAS-Core-f3d` | ✗ | ~~Extract `libs/LibIdentity` from PracticeMix's verifier (F12)~~ — closed **not planned** 2026-08-26 |
| — | — | `GAS-Core-dns` | ○ | GasLogger PII policy vs. identity call sites — owner decision, see *Escalation* |
| — | `drive-direct-read` | `GAS-Core-emk` | ⏸ | PracticeMix: direct Drive read primary, base64 fallback (F16) |
| — | `managed-host-checkout` | `GAS-Core-bsi` | ○ | `gas-static`: managed host checkout, so `staticRepoPath` stops being required |

**Status key:** ○ open · ◐ in progress · ✓ closed · ✗ closed not-planned · ● blocked · ⏸ held · ❄ deferred

`drive-direct-read` is held and carries no `#` — it is not in the execution order. See *Escalation*.

---

## Stages

### 1 · `pmix-prod`

**Deliverable — user-visible.** PracticeMix live on a production static URL at `pub/pmix`, doing one
real end-to-end action. The first production front end on the static-page pattern, and the stage
that starts the retirement clock on the Playwright-session transport.

**Why first:** independent of the conversion chain, and the clock measures elapsed time — starting it
late costs real information that cannot be recovered.

**Alone in its session.** It is a live production deploy; nothing else belongs in a session while one
is running.

**Work-log:** per-stage.

### 2 · `convert-rcv`

**Deliverable — architecturally significant.** The first conversion, and the validation run for
ADR-0002's declared-config shape: if the shape must bend, that surfaces here and the correct response
is a superseding ADR, not an edit to 0002. Also deletes RCV's two hand-rolled build/publish scripts
and elevates `measure-first-paint.js` into `best-practices/`.

**Why second, and why it runs on the more capable model:** it is the conversion most likely to
surface a needed package change, so it runs where one can be designed.

**Work-log:** per-stage.

### 3 · `convert-gas`

**Deliverable — user-visible and significant.** GActionSheet served from the package across *two*
environments (`pub/AS`, `pub/AS-sit`) — the first multi-env consumer, and the stage that brings back
the env-agreement guard GActionSheet originally contributed.

**Why immediately after stage 2:** it is safe on a cheaper model *only because* stage 2 established
the recipe. Run it as the very next session, while copying that recipe is still the obvious move.

**Work-log:** per-stage.

### 4 · `convert-f3go30`

**Deliverable — the one to read.** Three open architecture questions get decided and recorded as
ADRs: whether a consumer-side `transformPage(html, ctx)` hook belongs in `gas-static`, whether
`static-urls.js` earns a second consumer, and whether the standalone-build capability is wanted at
all. Settles `gas-static`'s §Provenance deliberately-dropped list.

**Why last of the three:** its AC are decisions rather than an execution, and deciding them with two
conversions already in hand is strictly better than deciding them with none.

**Work-log:** per-stage.

### 5 · `libidentity-and-method`

Two beads, deliberately paired.

**Re-scoped 2026-08-26.** This stage held `GAS-Core-f3d` until the review recorded in
`/tmp/HANDOFF-2608.md` inverted it. `f3d` is closed **not planned**, unimplemented; `GAS-Core-na8`
takes its slot. See *The identity decision* below before opening this stage — the two beads solve
the same problem by different mechanisms and it is easy to reopen the wrong one.

**Deliverable — architecturally significant.** `GAS-Core-na8`: the *brokered* verifier stops being a
"reference implementation target apps copy" and becomes one library. NUUC-Dispatch keeps
`Assertion_issue` and the `aud`→`kid` registry; GActionSheet's copy-pasted verifier
(`src/AccessControl.js`) is diffed against the reference, then deleted in favour of the library. The
~13 fail-closed verify-side tests in `NUUC-Dispatch/test/assertion.test.js` are the oracle, and
`docs/interfaces/signed-identity-assertion.md` is promoted to an estate-wide contract.
`GAS-Core-dof`: **method, not product** — answers whether a skill actually fires where a document
does not, files the `staged-plan` skill's defects in DevStandard's tracker, and cites this
conversion as the skill's validation evidence.

**Why paired:** `na8`'s existing tests make the extraction mechanical, leaving room in the session
for `dof`, which is an hour of work in a different repo and depends on nothing here. They share no
files, so neither crowds the other.

**No external blocker.** `f3d` waited on **PracticeMix P6**; that dependency died with it. `na8`
touches GAS-Core, NUUC-Dispatch and GActionSheet only — all three are in hand — so this stage can
open immediately, and no longer needs the "run `dof` alone if P6 hasn't landed" fallback.

**Do not batch `GAS-Core-dns` into this stage.** It is an owner decision, not work; see *Escalation*.

**Work-log:** one entry covering both beads. It must still carry each bead's own *Found* /
*Next stages must know* / *Deliberately not done* — batching changes when the entry is written, not
what it contains. Commit-and-push remains per-stage regardless.

#### The identity decision — 2026-08-26

Two mechanisms solve the identical problem (identify a visitor via Google without requesting an
OAuth access token to their Drive data), both over the same primitive: a GIS ID token on the
non-sensitive `openid`/`email`/`profile` scopes. The difference is **where the GCP-setup cost
lands**.

| | Brokered — **canonized** | Direct per-app — **not canonized** |
|---|---|---|
| Who verifies | NUUC-Dispatch verifies once, then mints an HS256 assertion downstream apps check | Every app calls `tokeninfo` itself |
| GCP setup | One project, one Web OAuth client, one consent screen for the estate (`auth-dispatch-503217`, 2026-07-22) | Each consuming app registers its own, independently |
| Consumers today | GActionSheet | PracticeMix (dormant), NUUC-Dispatch internally |
| Proven? | Yes — live, in production | **No.** Never run end-to-end anywhere |
| Bead | `GAS-Core-na8` — proceeds | `GAS-Core-f3d` — closed not planned |

**Decided:** GAS-Core canonizes the brokered path only.

**Deliberately not canonized:** the direct/self-contained verifier. It is a real pattern and the two
copies of it stay exactly where they are — but there is no second consumer for it and none planned,
so it earns no library. **Do not reopen this as "extract both."**

**Why `f3d` lost, given its AC said it would close `na8`:** `f3d` proposed canonizing the
*less*-proven mechanism. PracticeMix's gate has never run: `IDENTITY_REQUIRED_ = false`
(`Api.js:41`), `GIS_CLIENT_ID` has never been set (PracticeMix `atc-flg`), the static page has no
GIS sign-in UI, and `callApi()` never sends an `idToken`. Its "26 tests, verified" are unit tests
against an injected fake `ctx` — `makeIdentityContext_`, the only real `UrlFetchApp` /
`PropertiesService` path, has never been exercised. Meanwhile the proven alternative was already
provisioned and sitting outside `f3d`'s scope, and `f3d` would have left GActionSheet's copy-pasted
verifier untouched.

**One idea survived the close, and is now an AC line on `na8`:** failure posture as a *declared
option* rather than a semantic each copy must remember to invert.

**Where the loose ends went** — nothing here is left in prose:

| Finding | Disposition |
|---|---|
| PracticeMix could consume the broker instead of standing up its own client | PracticeMix `atc-mnt` (P4, **unscheduled**). Mutually exclusive with `atc-t6w`; both left open on purpose, whichever runs closes the other. `atc-flg` and `atc-t6w` both carry a comment saying so. |
| Raw `email`/`sub` logged in the clear (`Identity.js:186`, `Api.js:80`) against `GasLogger.js:73-76`'s own blanket policy | `GAS-Core-dns` (P2, `human`) — see *Escalation* |
| No `hd`/hosted-domain check exists on **either** path, so any verified Google account is admitted regardless of domain | Recorded, not fixed. AC line on `na8` requires the handoff to say so. If domain restriction is ever wanted it is new work, and it belongs at the broker. |
| Canonizing self-contained identity detection as its own pattern | **Out of scope, no plans.** Left as-is deliberately; captured in `bd remember` key `identity-canonical-path-is-brokered`. |

---

## Sequencing constraints

From `bd dep`, reproduced for reading convenience only — the tracker is authoritative.

- **Stages 2 → 3 → 4 are strictly ordered.** Each conversion inherits the recipe of the last.
- **Never batch two conversions.** Each is a whole repo of context, and the second silently inherits
  the first's assumptions instead of re-deriving them.
- **Never batch anything with stage 1.** Live production deploy.
- Stage 1's original dependency on `drive-direct-read` is **discharged** — that spike changed no audio
  code. Stage 1 can open now.

---

## Escalation

Owner decisions are **not** parked in prose. They carry the `human` label and surface in
`bd human list`; answer with `bd human respond <id>`. Currently pending:

| Bead | Decision needed |
|---|---|
| `GAS-Core-e5z` | Retire the `gas-deploy` `postFn` transport override once PracticeMix is `ANYONE_ANONYMOUS`. Revisit at the next `gas-deploy` breaking change. |
| `GAS-Core-dns` | GasLogger's policy (`GasLogger.js:73-76`) forbids a raw email in any logged payload and ships `maskPiiForLog_()`; PracticeMix's `Identity.js:186` and `Api.js:80` log `email`/`sub` in the clear anyway, deliberately, to serve the audit goal ADR-0002 suspended. Either carve a stated exception into the policy or mask at both call sites — the policy must not say one thing while the shipped code does another. Settle before any identity code becomes a library everyone imports. |

**Resolved 2026-08-25 — `GAS-Core-emk` (`drive-direct-read`, still ⏸):** the sharing decision is
answered. The user is assumed to have access to the practice-track folders/files via either
"anyone with the link" sharing or permission on their own Google account — not universal anonymous
access. On a direct-fetch failure, the implementation must give a meaningful error: first prompt the
user to confirm they're signed in to the correct Google account, then direct them to the admin if it
still fails. Full text in the bead's comments; `human` label removed. AC rewrite, unhold, and stage
sequencing are deferred to a dedicated planning pass — this row records the decision only.

---

## Handoff notes

Four parts per stage, written **at close**, into the bead *and* here: **Done** (real output pasted;
correct the stage's Deliverable line above if reality differed) · **Found** · **Next stages must
know** · **Deliberately not done**. Every finding carries a disposition inline — *fixed now* / *bead
`<id>`* / *AC of stage `<name>`* / *deliberately dropped, because…*.

### 1 · `pmix-prod` — ✓ closed 2026-08-26

**Done.** PracticeMix **PROD v1.6.8** is live at <https://nuuc-it.github.io/Static/pub/pmix/>
(PROD-WEB-APP @205) — the first production front end on the static-page pattern, and the first
PROD deploy since v1.6.7 on 2026-07-28. Both pipeline gates passed unaided:

```
✅ https://nuuc-it.github.io/Static/pub/pmix/ serving v1.6.8 (prod) → https://script.google.com/macros/s/AKfycbwPcnwln3A1KI0…B0QK/exec
✅ PRODUCTION verified — serving v1.6.8 (target PRODUCTION)
```

Live end-to-end check, anonymous and from a cold browser against the published CDN URL:

```
title: Practice Mix · version footer: 1.6.8
selection page visible at 5363 ms   (FCP 336 ms)
folder listed at 11012 ms — real Drive read via the PROD backend
folder-info: Folder: CURRENT CHOIR SEASON · tracks listed: 3
playback page visible 4107 ms after play (audio fetched from PROD)
track rows in mixer: 3 · total elapsed 15765 ms
```

**Retirement clock started. D = `2026-08-26T02:51:51.226Z`; backstop 2026-09-25.**
Read it with `node tools/retirement-clock.js` in PracticeMix.

The Deliverable line above stands as written, with one correction: it said the stage *starts*
the clock, which understated the work. The clock could not have been started as the plan
assumed — see *Found*.

**Found.**
- **The retirement criterion was uncountable, not merely unstarted** — *fixed now.*
  `docs/architecture.md §10.2` counts `doGet.start` events "from a non-test client", but the
  event carried only `{ ts }`, and TEST and PROD are two deployments of **one** script project
  writing into **one** GasLogger sink. A Playwright run against TEST and a choir member landing
  on the old PROD page were literally the same record. `src/Code.js` now stamps `env` from
  `APP_DEPLOY_TARGET`, confirmed live on both deployments; `tools/retirement-clock.js` reads
  the criterion, with its pure half unit-tested over six cases (including the never-loaded case
  a "time since last event" implementation gets wrong by having no last event).
- **`AXIOM_DATASET` is unset on the live script, so the documented log sink is dormant** —
  *bead `atc-0hh`* (existing bead, re-found; raised P3 → P2, consequence measured, duplicate
  `atc-9u1` closed into it). One unset **script** property disables the Axiom driver for TEST
  and PROD alike, so GasLogger has used its Drive fallback for its whole life and
  `query_axiom.py` returns nothing over any window. Nothing is lost — the clock reads the Drive
  sink — but it is the silent absorption `AxiomLogger`'s own header says must not happen; the
  guard covers a pipe that breaks, not one never connected. Not fixed here: changing the live
  logging sink is not a thing to do inside a production deploy.
- **`master` was ~30 commits behind the work** — *fixed now.* The entire migration lived on
  `hw0-waveform-graph`. `origin/master`'s one unique commit was GitHub's squash of PR #10, whose
  originals were already ancestors of the branch; merging its *tree* would have resurrected
  `authenticate.js`, `package-lock.json` and `test-auth.js`, all deliberately retired by P2 and
  the pnpm migration, so it was joined with `-s ours`. The resulting tree is byte-identical to
  the branch. `hw0-waveform-graph` is now fully merged and safe to delete.
- **The PROD deploy silently started a second ledger file** — *fixed now.* `gas-deploy` keys
  `deployment-ledger/<targetKey>.jsonl`, so `prod.jsonl` appeared beside the pre-package
  `production.jsonl`. Nothing reads either; folded into `prod.jsonl`.

**Next stages must know.**
- **`gas-static` and `gas-deploy` are now proven on a production target**, not just TEST. The
  three conversion stages (2–4) inherit a recipe with a PROD run behind it. One new behaviour to
  expect on a **first** publish to a brand-new folder: `assertPublishedBuild`'s first eight polls
  404'd on `version.json` while GitHub Pages published the new directory. The poll absorbed it
  and the stage needed no intervention — do not treat that 404 run as a defect when
  `convert-rcv`/`convert-gas` see it.
- `pnpm run deploy:prod` **bumps the semver patch itself** (`counter: 'version'`) — the
  `release:patch` script in PracticeMix's CLAUDE.md would double-bump. Not corrected here; worth
  a look when a conversion stage next touches that project's docs.

**Deliberately not done.**
- **`atc-mta` left open** — the owner's call, taken against the AC line "atc-mta and
  GAS-Core-vo3 closed". `atc-mta` *is* the retirement, whose criterion cannot fire before D+7 at
  the earliest; closing it on day 0 would discard the tracked home for the work the clock exists
  to trigger. `GAS-Core-vo3` is closed — the port and the transport retirement are genuinely
  done. The AC line is recorded on `GAS-Core-gne` as satisfied-as-amended.
- **The `AXIOM_DATASET` drift not fixed** — see *Found*; tracked on `atc-0hh`.
- **No Playwright suite run against PROD.** The live check above is a standalone script; the
  `static` project's baseURL is a locally served `dist`, and pointing it at a published CDN URL
  is a config change that does not belong inside a production deploy. The dual-run evidence on
  TEST (`atc-mta`) is unchanged and is what the retirement criterion rests on.

### 2 · `convert-rcv` — ✓ closed 2026-08-26

**Done.** RankChoiceVoting runs on `gas-static`. `tools/build-static-pages.js` (161 lines) and
`tools/publish-static-pages.js` (136) are deleted, replaced by a `tools/static-pages.js` that is
pure config; `test/test_build_static_pages.js` went with them. Verified by a full SIT deploy,
both gates green:

```
🪝 static publish…
   copied static-pages/dist/sit -> ../F3Static/ballot/sit
   d6808bf..5f634ed  main -> main
🪝 static verify (assertPublishedBuild)…
     attempt 1: sit serving 0.1.6.4, waiting for 0.1.6.5...   (…8 polls)
   ✅ https://f3go30.github.io/static-pages/ballot/sit/ serving v0.1.6.5 (sit) → https://script.google.com/macros/s/AKfycbwRGVywtwcP9zA…C2Ef7uA/exec
✅ SIT verified — serving v0.1.6.5 (target SIT)
```

Summary block, including S9's version row (last line):

```
🧪  SIT deploy summary
   Product version: v0.1.6.5
   Deployment ID:   AKfycbwRGVywtwcP9zAS2HvOJDlgBOa7t_H6l98yKBhR4fWzacDRvAg62fd5HFdhQ97C2Ef7uA
   Revision:        @38
   Static page:     https://f3go30.github.io/static-pages/ballot/sit/
   Spreadsheet:     https://docs.google.com/spreadsheets/d/1RCQlZ8FH5fdmh3ias5iIrttnD_IVLvctrMGvUNVdWeA/edit
   Tooling:         gas-deploy v1.4.0 · gas-static v1.3.1
```

`smokeTestStaticApi.js`: all 18 steps pass. The `?cmd=ballot` tap-through serves
`https://f3go30.github.io/static-pages/ballot/sit/?cmd=ballot&id=Smoke`, confirmed in a real
browser — that is `_staticPagesBaseUrl_` reading `BUILD_INFO.staticUrl` rather than its three
hardcoded URLs.

The Deliverable line above stands, with one correction: it said the stage "deletes RCV's two
hand-rolled build/publish scripts and elevates `measure-first-paint.js`", both of which happened —
but it framed the ADR-0002 validation as the thing that *might* need a package change. The package
that needed changing was `gas-deploy`, not `gas-static`, and `gas-static` needed nothing at all.

**Found.**
- **ADR-0002's content list described the wrong file** — *fixed now, `adr/0004`.* ADR-0002 said the
  committed half holds "envs, anchors, labels, counters, static destinations". Every one of those
  was **already** in a committed, reviewable file — the project's JS config module — and had never
  been in `local.settings.json`, so none of them was drifting per machine, which is the failure
  ADR-0002 §Context exists to cure. What *was* drifting: RCV's three `*ScriptId`s and three
  `*SheetId`s, re-entered by hand on every machine and reviewed by nobody. ADR-0004 narrows the
  committed half to **identifiers of external resources** and leaves declarations in the JS module,
  so the packages keep one declaration mechanism instead of two. ADR-0002 is `Superseded`; its
  Context/Decision/Consequences are byte-untouched. `adr-quality-check` run, all five steps pass.
- **The static host's URL had three copies, one of them unreachable from the others** — *fixed now.*
  `manage-deployments.js`'s `STATIC_ENTRY_BASE_URL`, `publish-static-pages.js`'s `DEST_MAP`, and
  `script/ApiBridge.js`'s `_staticPagesBaseUrl_`. The third is GAS-side and cannot `require()` the
  other two, so no JS module could ever have been the single source. They are now one entry in
  `gas-project.json`, with `liveUrl` **composed** from `pagesUrl + dest` (so the URL polled and the
  folder published to cannot drift) and the composed value stamped into `BUILD_INFO.staticUrl` for
  the GAS side. This is why the static host joined the identifiers in ADR-0004 rather than staying
  a declaration — the user caught the distinction the first framing had collapsed.
- **`gas-deploy` had no `gas-project.json` reader at all** — *fixed now, v1.4.0.* S14's handoff said
  "whoever implements the loader owes it an explicit error" for the declared-but-absent case. All
  three disagreement directions now fail or warn by name: a declared env with no secret throws
  *before anything shells out* (clasp's own check fires later and knows only the key, not the env or
  the file); a target missing from a declared `envs` block throws listing what *is* declared; a fact
  in both files takes the committed value and warns which stale key to delete. 10 new tests.
- **86 pre-existing `gas-deploy` tests pass unchanged**, which is the back-compat claim rather than
  an assertion of it — a repo with no `gas-project.json` is untouched.
- **`callWebapp.js`'s `ENV_MAP` carried `scriptIdKey` entries that nothing read** — *fixed now.*
  Dead config, and after the split they pointed at keys that no longer exist.
- **`.deploy-metadata.json` and `deployment-ledger/` were gitignored but still tracked** —
  *fixed now, own commit.* Pre-existing uncommitted intent; the entries did nothing while the files
  stayed tracked. Same `gas-deploy` per-machine records PracticeMix hit in stage 1.

**Next stages must know.**
- **`convert-gas` (stage 3) inherits a complete recipe, and it is cheaper than stage 2 was.** The
  package changes are done and tagged; GActionSheet should need `gas-static` config only. Note it is
  *already* the lineage-A project — it has `BUILD_INFO` and the env-agreement check today, which is
  where both came from — so Mode A is not a conversion for it, only a hand-off.
- **`gas-static` needed no change for a second consumer.** Both remaining conversions should treat a
  proposed package change as a signal to re-read §Provenance first.
- **The `gas-project.json` migration for the other four repos is smaller than ADR-0002 implied** —
  add the committed file, delete those keys from `local.settings.json`. No config module is
  restructured. `GAS-Core-9iu` is re-amended with this; `-8w0` and `-hl5` too.
- **RCV is on branch `gas-deploy-stage1b-pnpm`, 9 ahead of `origin/main` and 0 behind** — a clean
  fast-forward, unlike PracticeMix's stage-1 divergence. Not merged: that is the owner's call, and
  nothing here needs it. Pushed to its own branch.
- **`placeholders` handles tokens that are not `var … = null;`.** RCV stamps `data-theme="…"` and an
  HTML comment through it. F3Go30's CSP work (stage 4) should weigh that before concluding it needs
  a `transformPage` hook.

**Deliberately not done.**
- **The canonical-key convergence across the estate.** RCV renamed `staticPagesRepoPath` →
  `staticRepoPath` and `nuucStaticPagesRepoPath` → `nuucStaticRepoPath` because it was touching them
  anyway; F3Go30, GActionSheet and NUUC-Dispatch are untouched, and RCV's
  `GAS_LOGGER_PARENT_FOLDER_ID` keeps its shouty spelling rather than becoming `gasLogFolderId`.
  That is `GAS-Core-9iu`'s job, not a conversion's.
- **The managed host checkout** — *bead `GAS-Core-bsi`, filed, blocked on this stage.*
  `staticRepoPath` is now the only machine fact left in RCV's config, and it is reproducible: both
  host repos are plain HTTPS remotes authenticating through the global `gh auth git-credential`
  helper, so `gas-static` could clone a sparse checkout of just this project's own folder and drop
  the key entirely. Declined here to keep the stage a conversion — it touches the publish path that
  `rm -rf`s directories. `gas-project.json` now declares each host's `repo` slug, so the
  prerequisite is in place.
- **No PROD or NUUC deploy.** The AC asked for the test env, and both are configured but unproven on
  the new pipeline. NUUC in particular exercises the second host repo and a second Google account.
- **No Playwright suite for RCV.** The `_staticPagesBaseUrl_` check above was a standalone script
  borrowing PracticeMix's Chromium; RCV has no `@playwright/test` of its own, and adding one is not
  a conversion's business.
- **`measure-first-paint.js` not run for RCV.** It is elevated and generalised (`--ready`, `--static`,
  `--webapp` are arguments now), but RCV's own before/after number was never the point — the
  before-front-end is already retired here.

### 3 · `convert-gas` — ✓ closed 2026-08-26

**Done.** GActionSheet's team-action portal runs on `gas-static`. `scripts/build-static-portal.js`
(179 lines) and `scripts/publish-static-portal.js` (133) are deleted, replaced by
`scripts/static-pages.js`, pure config. Both envs verified by a full deploy:

```
TEST:  https://nuuc-it.github.io/Static/pub/AS-sit/ serving v0.2.2.10 (sit) — full CLI
       deploy green: build, publish, assertPublishedBuild, cmd=version all passed.
PROD:  https://nuuc-it.github.io/Static/pub/AS/ serving v0.2.3 (prod) → matching /exec,
       cmd=version agrees (0.2.3/production).
```

Pushed to its own branch, not merged (owner's call, RCV precedent):
`convert-gas-static-gas-core-rgh` @ `486b819` in GActionSheet.

The Deliverable line above stands as written — the env-agreement guard GActionSheet originally
contributed came back active, confirmed pre-deploy: building `prod` against a TEST-stamped
`Version.js` threw before writing anything.

**Found.**
- **`BUILD_INFO.version` carried a display-form `'v'` prefix, which would have made every deploy
  time out forever** — *fixed now.* `manage-deployments.js`'s stamper overrode `version` to
  `` `v${version}` `` for display (sidebar footer, About dialogs). `gas-static` reads that field
  verbatim into `version.json`, and `gas-deploy`'s own `assertDeployedVersion`/
  `assertPublishedBuild` poll for the **bare** counter — `"v0.2.2.9" !== "0.2.2.9"`, never
  converges. This is the one pre-package copy (`readBuildInfo_`/`ENV_MAP.buildInfoEnv`)
  `gas-static`'s `webappUrl:{from:'buildInfo'}` mode and env-agreement guard were extracted FROM
  (README §Provenance) — and it's the one copy that had drifted onto a display-form version since.
  Fix: dropped the override; `buildInfoStamper`'s own default (bare) is what every other consumer
  already uses. No display callsite needed a compensating change — `BUILD_INFO.version` is shown
  verbatim everywhere it's displayed, so it now just renders without the `'v'` (cosmetic only,
  confirmed against `test_journey.py`'s `expected_version` fixture, which reads the same file field
  it's compared against and so is format-agnostic).
- **PROD's `assertPublishedBuild` hit a live GitHub-wide incident, not a pipeline defect** —
  githubstatus.com showed Pages `degraded_performance` and Actions `major_outage` while this ran;
  the Pages build for the PROD publish stalled ~40 min instead of the usual ~1 min (every prior
  build on `nuuc-it/Static` finished in 35–130s). The GAS side (push, redeploy, `WEBAPP_URL`) had
  already succeeded before the CLI's 300s timeout fired and it exited 1 before the ledger write;
  verified green by hand (`curl` against `version.json` and `cmd=version`) once the Pages build
  cleared. `deployment-ledger/production.jsonl`'s entry for this deploy is hand-appended — same
  schema, no CLI run to attribute it to.
- **Another process/session ran its own `pnpm run deploy:test` mid-session, in the same checkout**
  — visible in `deployment-ledger/test.jsonl`'s `v0.2.3.1` entry, after this conversion's own
  verified `v0.2.2.10` run. Harmless to this bead's AC (both deploys are independently valid), but
  this repo had unrelated concurrent work in flight (a document-export feature on
  `tmp/pr3-pr4-combined`) and the pushed branch here forked from that in-flight branch, so it
  carries those unrelated commits too — flagged for whoever untangles the eventual merge.

**Next stages must know.**
- **`convert-f3go30` (stage 4) inherits the same recipe as stage 2, not a new one.** No
  `gas-static` package change was needed here either — two conversions in, the package's shape
  holds.
- **The `'v'`-prefix bug is GActionSheet-specific** — RCV's `BUILD_INFO.version` was already bare
  (stage 2 found no equivalent issue). Worth a quick grep on F3Go30's stamper before assuming its
  version format is safe by default.

**Deliberately not done.**
- **`scriptId`/`testSheetId` convergence onto `gas-project.json` only** — deferred. Two consumers
  (`tests/conftest.py`'s `script_id` fixture, `tests/playwright/editor_helpers.js`) read
  `local.settings.json` directly, not through `gas-deploy`'s loader, so both files still carry the
  same values. Folding those two readers over is estate-wide key-convergence work
  (`GAS-Core-9iu`-shaped), not a conversion's job.
- **No Playwright suite run against the live PROD portal.** `tests/playwright/team_portal_*.test.js`
  build against a local `dist/`; pointing them at the published CDN URL is a config change outside
  this stage's scope.

### 4 · `convert-f3go30` — *not started*

### 5 · `libidentity-and-method` — *not started* (re-scoped 2026-08-26, see the stage above)

### `drive-direct-read` — ⏸ held

Spike closed 2026-08-24; implementation deferred on the owner's call. Full handoff lives on
`GAS-Core-emk` (AC annotations plus two comments). Not repeated here.
