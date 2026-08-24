# PLAN2 — post-PracticeMix review of the shared packages and best practices

**Doc version:** 6 · **Status:** findings + staged execution plan · **Created:** 2026-08-24 ·
**Revised:** 2026-08-24 (v6 — §6.3's sessions are now one table in preferred execution order with a
status column; see §8) · **Scope:** GAS-Core
`packages/`, `libs/`, `best-practices/`, and the estate that consumes them (F3Go30,
RankChoiceVoting, GActionSheet, NUUC-Dispatch, PracticeMix).

Inputs reviewed: [`PMIX-PLAN.md`](PMIX-PLAN.md) (all 8 stages and their §7 handoff notes),
[`best-practices/gas-static-frontend/RECOMMENDATION.md`](best-practices/gas-static-frontend/RECOMMENDATION.md),
[`best-practices/gas-deployment/RECOMMENDATION-declared-config.md`](best-practices/gas-deployment/RECOMMENDATION-declared-config.md),
`packages/gas-static` v1.1.0 and `packages/gas-deploy` v1.2.1 as shipped, and the five consumer
checkouts under `/home/stuar/proj/`.

---

## 1. Verdict

**The pattern is settled and now proven end to end; the consolidation it was supposed to drive is
about one-fifth done, and none of the evidence for it is committed.**

What the PracticeMix migration actually established:

- The static-front-end pattern is no longer a claim. `pnpm run measure:first-paint` on live TEST:
  **4213 ms → 116 ms to first app paint (≈36×), 282 KB → 43 KB (≈6.6×)**, plus `Cache-Control`
  and an ETag the `HtmlService` page can never have. That number retires the argument.
- `gas-static` v1.1.0 owns the whole chain — build → publish → `assertPublishedBuild` — as
  `required: true` `postDeploy` hooks plus the summary row, and a *stale publish fails the deploy*.
  That was demonstrated once, deliberately, in P4. This is the single most valuable thing built.
- `gas-deploy`'s `postFn`/Playwright-session transport tax is gone from its one consumer, so the
  escape hatch can now be removed from the package (G2, unblocked, not done).
- The security invariant that gated the whole migration (D3: never hand the owner's Drive-scoped
  OAuth token to an anonymous caller) was satisfied by *removing* the two routes rather than gating
  them, and verified against live TEST anonymously with the responses quoted.

What is not true yet, stated plainly:

| Claim | Reality |
|---|---|
| "the static pipeline is consolidated" | 1 of 4 consumers converted. F3Go30, RCV and GActionSheet still run their own copies — there are now **four** implementations, not three. |
| "the copies can't drift any more" | `best-practices/gas-static-frontend/` still ships `build-static-pages.js` + `publish-static-pages.js` as copy-me templates, superseded but present. |
| "the GAS-side libraries are consolidated" | `libs/` holds `LibSheets` and `LibSidebar` only. `LibAdmin` (`GAS-Core-hl5`) and `LibIdentity` (`GAS-Core-na8`) are unstarted, and PracticeMix's `src/Identity.js` is now a **sixth** hand-adapted verifier — with deliberately inverted allowlist semantics against the reference. |
| "the migration is complete" | P5's second half is open. PROD has never been deployed, `pub/pmix` does not exist, and the retirement criterion cannot start counting until it does. |
| "the work is safe" | `PMIX-PLAN.md` and both `RECOMMENDATION*.md` are **untracked**; five PracticeMix stages (P1R–P5) are **entirely uncommitted**. |
| "the findings are recorded" | The measurements, the security finding, the CORS quirk and the propagation numbers exist **only** in `PMIX-PLAN.md` §7 handoff notes. No permanent document in either repo can reach them. See §4. |

---

## 2. Findings, prioritised

Priority is risk × (1 / cost). P0 items are cheap and protect work already done.

| # | Finding | Pri | Cost |
|---|---|---|---|
| **F1** | The record of this whole exercise is uncommitted and untracked | P0 | 1 h |
| ~~**F2**~~ | ~~Five PracticeMix stages exist only in an uncommitted working tree~~ — **done, v2** | — | — |
| **F3** | `gas-static`'s publish does `rm -rf` on a path inside someone else's repo with no shape guard | P0 | 1 h |
| **F4** | `gas-static`'s publish pushes into a shared repo without pulling first | P0 | 1 h |
| **F5** | No CI: two packages consumed by five repos via git tags, tested only by hand | P0 | 1 h |
| **F6** | `assertPublishedBuild` checks `version` only — not `env`, not `webappUrl` | P1 | 2 h |
| **F7** | R1 is one-quarter done; the three original copies are still live, and the blocker is a single missing `webappUrl.from` mode | P1 | 1 stage per project |
| **F8** | Deploy propagation lag is rediscovered every stage and encoded nowhere | P1 | 3 h |
| **F9** | G2 (`postFn` retirement) is unblocked and untouched — **held (v2)** | hold | 1 h |
| **F10** | Consumer version pins have drifted (v1.1.0 / v1.2.0 / v1.2.1) with no way to notice | P1 | 2 h |
| **F11** | `best-practices/gas-static-frontend/` still ships the superseded copy-me scripts | P1 | 1 h |
| **F12** | The identity verifier is now copied a sixth time, with inverted semantics | P1 | 1 stage |
| **F13** | `readBuildInfo_` under-reads and re-diverged at its first consumer | P2 | 1 h |
| **F14** | PracticeMix's `measure-first-paint.js` and the `authStatePath()` fix are project-local | P2 | 2 h |
| **F15** | The declared-config open decision (one file or two) blocks three beads | P2 | decision |
| **F16** | Audio transfer is backwards: the server round-trips base64 as the *primary* path when the files are link-shared and the client can read them directly | P1 | spike + 1 stage |
| **F17** | Empty `packages/gas-static/bin/`; no CLI, and two conversion candidates need one | P3 | 2 h |
| **F18** | Neither package has a CHANGELOG | P3 | 1 h |
| **F19** | `PMIX-PLAN.md` and both `RECOMMENDATION*.md` have no end state — spent scaffolding and durable findings are interleaved in one file | P1 | 1 session |
| **F20** | GAS-Core has no home for package **design decisions** — **decided (v2): add `adr/`**, §4.5 | P1 | 2 h |
| **F21** | The eight-rule stage contract is a reusable process artifact stranded inside a project plan | P3 | 1 h |

---

## 3. Detail and recommendations

### F1 — The record is uncommitted and untracked  *(P0)*

`git status` on `gas-deploy-recommendation-stage1a`: `PMIX-PLAN.md`,
`best-practices/gas-static-frontend/RECOMMENDATION.md`,
`best-practices/gas-deployment/RECOMMENDATION-declared-config.md`,
`best-practices/gas-workspace-addons/`, `docs/demo-config-reference.md`,
`docs/demo-surface-matrix.md` are **untracked**; five READMEs and `work-log.md` are modified.
Nothing in `master` says `gas-static` exists or why. The branch itself is unmerged.

Two strays to deal with in the same pass: `xx` (empty, junk) and `.vscode/settings.json` (decide:
commit deliberately or gitignore).

**Recommend:** commit in three logical commits (recommendations; best-practice README updates +
demo docs; PMIX-PLAN + work-log), merge `gas-deploy-recommendation-stage1a` to `master`, push. This
is `CLAUDE.md` §Session Completion's own standing rule, and it has been deferred across every stage
by the plan's §6.7 conservative-profile clause — which was correct per-stage and is wrong now that
the plan is closed.

Commit them **as the record of a finished exercise, not as living documents** — §4 is the
disposition, and it should be executed close behind, before anyone starts treating a 1176-line
plan as current.

### F2 — Five PracticeMix stages are uncommitted  *(P0 — DONE)*

Every stage from P1R to P5 closed with "Not committed — stage contract §6.7". That tree also holds
unrelated `hw0-waveform-graph` work, `P3stat.md` and `tests/zz-scratch-layout.spec.js`. It includes
`static-pages/src/index.html` (~4.9k hand-ported lines), `src/Api.js`, `src/Identity.js` +26 tests,
`tools/static-pages.js`, `tools/serve-static.js`, `tools/measure-first-paint.js`, and the
`call-webapp.js` collapse. A single bad `git checkout` costs four sessions.

**RESOLVED (v2) — handled by the owner in a separate session.** Kept as the record of what the
exposure was; no action remains.

### F3 + F4 — The host repo should declare who publishes what, and that declaration should be the guard  *(P0)*

**Revised in v2 on the owner's direction:** rather than have `gas-static` infer a safe `dest` from
path heuristics, the **host repo declares the ownership map**, and the package validates against
it. A publisher that is not in the map, or a `dest` registered to a different project, is refused
before anything is written.

**The precedent already exists and is half-built.** `F3Static/README.md` is exactly this document:
it states the repo holds only built output, is never hand-edited, that each app is namespaced under
its own top-level folder, and it lists the layout folder by folder with the owning project and the
live URL. `Static/README.md` is the gap — its entire contents are `# Static`, and `Static/pub/README.md`
is empty, while `pub/` now holds `AS`, `AS-sit`, `ballot`, `pmix-sit` from three different project
repos across two Google accounts.

**The problem this closes (F3).** `packages/gas-static/lib/publish.js:16` — `copyDir_()` opens with
`fs.rmSync(dest, { recursive: true, force: true })`, where `dest = repoRoot + envDef.dest` and
`repoRoot` is another project's checkout read from `local.settings.json`. Nothing validates
`envDef.dest`. A `dest` of `pub` instead of `pub/pmix` deletes `pub/AS`, `pub/ballot` and
`pub/pmix-sit` together; the scoped `git status --porcelain -- pub` then faithfully reports the
deletions, `git add pub` stages them, and a chained publish commits and pushes without a prompt
(`chained: true` skips `confirmFn` by design). The `git add` scoping P4's AC verified protects
against staging *unrelated* work; it does not protect against a destructive `dest`.

**Recommend — one file, two readers:**

1. **`PUBLISHERS.md` at the host repo root** (name chosen over `README.md` because it is the thing
   being looked up, and over a dotfile because a human landing in the repo must find it). Human
   half: what the repo is for, that it is generated-only and never hand-edited, that **each folder's
   content is owned 100 % by the originating project repo**, and the folder → project → live-URL
   table F3Static already has.
2. **A machine-readable block the package reads** — a fenced JSON block inside `PUBLISHERS.md`, or a
   sibling `publishers.json` it stays in sync with. Shape:
   `{ "pub/pmix": { "project": "PracticeMix", "env": "prod", "url": "https://…" }, … }`.
   `publishEnv` resolves `envDef.dest`, requires an exact entry, and requires its `project` to match
   the consumer's declared `projectName`. Absent entry or mismatch ⇒ refuse, naming both the dest
   and the owner it is registered to. A new folder is then a deliberate two-line edit in the host
   repo, reviewed there — which is precisely the "project truth belongs where it can be reviewed"
   argument the declared-config recommendation makes about anchors.

Keep the cheap structural checks as a backstop for the case where the manifest is missing or
malformed: refuse a `dest` that is empty, absolute, contains `..`, resolves outside `repoRoot`,
resolves *to* `repoRoot`, or contains a `.git`. They cost nothing and cover the bootstrap window
before a host repo has a manifest.

**On content ownership and pulling (F4) — one correction worth making.** The owner's point is right
and should be written into `PUBLISHERS.md`: each published folder's content is owned entirely by its
originating repo, no other repo ever edits it, so a *content* merge conflict is impossible and no
"pull to reconcile my folder" step is needed. But that is a statement about content, and the failure
in `publish.js:86-92` is at the **git** level: `Static` is one repository on one branch, and
GActionSheet pushing `pub/AS` moves `main` for everyone. A PracticeMix publish from a checkout that
has not fetched since then is a non-fast-forward and `git push` is **rejected** — after the commit
has already been made — leaving the backend deployed, the page committed locally, and nothing
published. `required: true` then fails the deploy, and a human has to finish it.

So the correct form of "no pull is required" is: **no pull is required to resolve content, and
because of that a rebase can be automatic and unattended.** Recommend `git fetch` +
`git pull --rebase` immediately before the commit, justified in a comment by exactly the ownership
rule above (disjoint paths ⇒ a rebase can never conflict), plus an assertion that the checkout is on
its tracking branch, and on push failure a named diagnostic saying the commit exists locally and how
to finish it. Without it, the shared host repo's failure rate grows with the number of publishers.

### F5 — No CI  *(P0)*

`.github/workflows/` holds only `deploy-pages.yml`. The root `package.json` has a working
`node --test 'libs/**/test/**/*.test.js' 'packages/*/test/*.test.js'`, but nothing runs it. Five
repos consume these packages by **git tag** (`#gas-static-v1.1.0&path:/packages/gas-static`), so a
tag pushed with a broken package is discovered by a consumer mid-deploy.

**Recommend (expanded in v2): CI runs a *declared* entry point, never a hardcoded runner.**

The estate is not uniformly Node. `GActionSheet` carries `pyproject.toml` + `uv.lock` and runs
pytest; `google-sheet-verification/`, `gas-test-reporting/` and `gas-server-logging/` in this repo
ship Python (`download.py`, `test_download.py`, `write-environment.py`, `query-axiom.py`) with their
own test files; the deploy tooling itself is Node. A workflow that hardcodes `node --test` silently
tests half of some repos and none of others, and — worse — the CI file becomes a *second* statement
of how the project is tested, which drifts from what a developer types.

The rule: **one command a human types is the same command CI runs, and it is declared at the top of
the configuration chain.**

- Every repo declares `"test"` in `package.json` `scripts` as the single entry point, even when the
  work is Python. Sub-scripts stay visible beneath it — `test:unit` (`node --test …`), `test:py`
  (`uv run pytest …`), `test:e2e` (`playwright test`) — and `test` composes the ones that must
  always run. A reader sees the whole test surface in one place without opening a workflow file.
- Repos with no Node at all declare the same thing in whatever their equivalent top-of-chain file is
  (a `[tool.uv]`/`Makefile` target named `test`), and the workflow calls *that*. The invariant is
  the name and the visibility, not the runner.
- The workflow is then three lines: check out, set up the toolchains the declared script needs, run
  `pnpm test` (or the declared equivalent). It contains **no knowledge** of which runners exist.
- For GAS-Core specifically: root `test` stays `node --test 'libs/**/test/**/*.test.js'
  'packages/*/test/*.test.js'` today; when the Python helpers in `best-practices/*` get a test
  target it becomes `test: "npm run test:unit && npm run test:py"`, with `test:py` using the
  project's `uv1` venv per the global convention. Nothing in CI changes when that happens — which is
  the point.
- Add the tag guard as a separate job: refuse a `gas-*-v*` tag whose `packages/<name>/package.json`
  version does not match the tag, since consumers pin by tag and a mismatched pair is undetectable
  downstream.

### F6 — Version agreement needs both halves: a deploy-time assertion *and* a runtime contract on the page  *(P1)*

**Expanded in v2 on the owner's direction.** Asserting at deploy time is necessary and not
sufficient: the two halves can diverge *after* a green deploy — a CDN edge serving a stale page, a
visitor holding a cached document, a publish that succeeded while the backend was later rolled back.
So the page must also tell the truth about itself at runtime.

**Half 1 — the deploy-time assertion (as originally filed).**
`RECOMMENDATION` §3.2 justifies `version.json` on the grounds that it "answers both live questions
at once: *is the new build served* **and** *does it point at the deployment we just deployed*."
`lib/assert.js:52` compares `last.version === expectedVersion` and returns `env`/`webappUrl` in the
result without asserting either. The env-agreement guard — the one thing only GActionSheet had, and
the stated reason to prefer `from: 'buildInfo'` — runs at **build** time only. A `dist/prod` copied
into a `test` dest, or a page published from a stale `dist/`, satisfies the current assertion.
**Recommend:** accept `{ expectedEnv, expectedWebappUrl }` (both defaulted from the config and the
resolved deployment, both assertable), fail with the same "published pointing somewhere real"
message the build-time guard uses, and cover mismatch-on-each-field in `test/assert.test.js`.
`deployHooks()` already makes both assertions required whenever a static page exists, so a project
that has one cannot pass a deploy on the backend alone — that part is correct today.

**Half 2 — the runtime contract, which is currently unspecified.** F3Go30 has the worked example and
it is better than "show a version string". From `static-pages/src/index.html:1849-1876` and the
invariants it is pinned by in `test/test_static_page_client_invariants.js`:

- **`formatVersionFooter_(clientBuild, serverVersion)` always shows the *client* build**, never the
  server's, because — in its own comment — "the version a PAX reads back off the footer during
  support must be the one their document is actually running". The server's version is named
  *alongside* it only when they differ: `v2.4.5 (build) · server v2.4.7`.
- **A null client build is not staleness.** Unbuilt `src/` served directly (local dev, Playwright)
  has no build to be behind, so `isUpdateAvailable_` returns false and the footer honestly reads
  `v… (server)` or, in PracticeMix's port, `unbuilt (local)`.
- **The footer paints at load with no network round trip** — `applyVersionState_(STATIC_BUILD_VERSION_, null)`
  runs immediately, then again from the config/identify response once the server version is known.
  A page that cannot reach its backend still shows what it is.
- **A mismatch raises an update banner offering a reload**, and **dismissal is recorded against the
  version dismissed** (`go30UpdateDismissed = '2.4.7'`), not as a boolean — so a later mismatch
  prompts again rather than staying silenced forever.
- **The server version arrives on a response the page already makes** (`cfg.appVersion` on every
  identify), not a dedicated call.
- The other direction is covered too, and is the half nobody asks for: **`callApi` stamps
  `clientVersion: STATIC_BUILD_VERSION_` on every POST**, so the *server* can see which build is
  calling it and stale clients are visible in logs rather than in support calls.

**Recommend:** write this up as a **static page interface contract** in
`best-practices/gas-static-frontend/README.md` — a short numbered list of requirements a static
front end must satisfy, with F3Go30 named as the reference implementation:

1. The page displays its own build version persistently (footer), populated before any network call.
2. Every API response carries the server's version; the page compares it against its own build.
3. On mismatch the page displays *both* versions and offers a reload — it never silently shows the
   client version alone, and never replaces it with the server's.
4. Dismissal of the update prompt is keyed to the version dismissed.
5. An unbuilt/local document is labelled as such and never reported as stale.
6. Every request carries the client build version, so the backend can observe stale clients.

Then close the gap in PracticeMix: P3's notes record a footer that shows `unbuilt (local)` and a
build stamp, and P4 stamps all four literals — but nothing compares the stamp against the backend's
`cmd=version`, so requirement 2, 3, 4 and 6 are unmet there. That is one small stage, and it is the
user-visible backstop for exactly the propagation window F8 measures.

### F7 — R1 is one-quarter done, and one missing mode is why  *(P1)*

Still live and unconverted:

| Project | Own pipeline | Pinned |
|---|---|---|
| F3Go30 | `tools/build-static-pages.js`, `publish-static-pages.js`, `wait-for-static-deploy.js`, `static-urls.js` | gas-deploy v1.1.0 |
| RankChoiceVoting | `tools/build-static-pages.js`, `publish-static-pages.js` | gas-deploy v1.1.0 |
| GActionSheet | `scripts/build-static-portal.js`, `publish-static-portal.js` | gas-deploy v1.1.0 |
| PracticeMix | **converted** — `tools/static-pages.js`, `deployHooks()` + `summaryRows()` | gas-deploy v1.2.1, gas-static v1.1.0 |

G1's own handoff notes name the blocker: `webappUrl.from` implements `'buildInfo'` and nothing
else, while F3Go30 and RCV resolve the backend URL from `local.settings.json` deployment IDs.

**The two modes, in full (expanded in v2).** Both answer one question — *what `/exec` URL does the
static page POST to?* — and they differ in **when** the answer is produced and **what reconciles it
with reality**.

| | **Mode A — `from: 'buildInfo'`** (GActionSheet; the package's only implemented mode) | **Mode B — deployment ID from settings** (F3Go30, RankChoiceVoting) |
|---|---|---|
| Mechanism | `gas-deploy` resolves the named deployment *during this deploy* (`resolveBeforeStamp: true`), `buildInfoStamper` writes `{version, buildDate, env, webappUrl}` into a GAS-side file, and the static build reads that file back | The build reads a deployment ID out of `local.settings.json` and constructs `https://script.google.com/macros/s/<id>/exec` |
| Produced when | by the deploy that is running right now | whenever the ID was last written or hand-entered |
| Reconciled against | the live resolver chain (`settingsId → anchorMatch → soleActiveDeployment`) that same run | nothing, at build time |
| Carries `env`? | yes — enabling the **env-agreement assertion**: refuse to build if `BUILD_INFO.env` disagrees with the static env being built | no — a `prod` dist can be built against a `test` deployment and nothing notices |
| Can build without deploying? | **no** — needs a stamped `BUILD_INFO`, so a clean clone must deploy (or possess a stamped file) before it can produce a correct page | **yes** — build and publish standalone at any time, no clasp auth, no network |
| Failure mode | a missing/stale stamp fails loudly at build time | a deleted or recreated deployment bakes a **dead URL into a published page**, discovered by a user |
| Extra requirement on the project | must adopt `resolveBeforeStamp` + a `BUILD_INFO` literal server-side | none |

**Mode B's advantage is real** and is the reason two projects chose it: it decouples the static
build from the deploy, which matters if you want to republish a page without redeploying the
backend, or build on a machine with no clasp auth. The declared-config recommendation (§3) even
defends keeping a cached deployment ID for exactly those reasons — the no-clasp-auth path, deletion
detection, and cost.

**But it defends the cache as a *fallback for resolution*, not as the binding a published page
inherits.** The distinction matters: `resolveEnvDeploymentId` validates a cached ID against the live
deployment list and refuses loudly when it has vanished; a build-time read of the same file does
neither. That is why the same document recommends R3.

**Recommendation stands: do not add `from: 'deploymentId'`.** Adding it would put the unreconciled
binding inside the package and make it the path of least resistance for the next consumer. Convert
F3Go30 and RCV to Mode A instead — `gas-deploy` already supports `resolveBeforeStamp`, so the change
is a config flag plus a `BUILD_INFO` literal, and it is R3 itself.

**If the standalone-build capability is genuinely needed** (ask F3Go30 before assuming it is), the
right third mode is not "read the cached ID" but **`from: 'resolve'`** — call the same
`resolveEnvDeploymentId` chain the deploy uses, at build time, so the anchor is matched against the
live list and a vanished deployment is refused rather than published. That keeps the reconciliation
and drops the deploy coupling. Build it only if a conversion actually blocks on it.

Suggested order, one stage each, mirroring PMIX-PLAN's stage contract:
1. **RankChoiceVoting** — smallest delta; `smokeTestStaticApi.js` step 11 is subsumed by
   `assertPublishedBuild`, and its extra placeholders (theme, theme-fonts, dev contact) already fit
   the generic `placeholders` config with no package change.
2. **GActionSheet** — multi-page (`index.html` + `doc.html`), asset tree, and a portal env
   vocabulary (`sit`/`prod`) distinct from the deploy targets (`test`/`production`); all three are
   already expressible via `stampedPages`, `copyAssets` and `envs[].deployTarget`. It contributed
   the env-agreement guard, so it should not be the last to get it back.
3. **F3Go30** — last, because it is the only one that forces a package decision: its
   `buildCspMeta_`/`collectScriptHashes_`/`insertCsp_` post-stamp page transform was deliberately
   dropped from G1. Decide then between a consumer-side `transformPage(html, ctx)` hook and leaving
   CSP generation in F3Go30's own tooling. Its `static-urls.js` (R9) becomes decidable at the same
   moment, with a second consumer to justify it.

### F8 — Propagation lag is rediscovered every stage and encoded nowhere  *(P1)*

Three stages independently hit it, and P1R's note says it cost a diagnostic budget: after
`assertDeployedVersion` reports success, the fleet still serves a mix. P1R saw `cmd=version` return
the *old* version while one action answered with new code and another with old, converging in ~1 min
/ 3 retries. P2 saw the same for a **manifest** change, converging in ~90 s. P4 measured ~35 s for a
first GitHub Pages publish. The package's own default `timeoutSec` is **60**, contradicting all
three measurements; only the `deployHooks()` wrapper raises it to 300.

**Recommend:**
- `gas-deploy`: add a settle option to `assertDeployedVersion` — require **N consecutive**
  successful version reads (default 2, configurable), not the first one. This is the direct fix for
  "a single post-deploy assertion is not proof the whole fleet has turned over," and it is a few
  lines in `lib/verify.js`.
- `gas-static`: raise the `assertPublishedBuild` default `timeoutSec` to 300 to match the wrapper
  and the measurements, so a consumer calling it directly gets the honest default.
- `best-practices/gas-deployment/README.md`: one short section, "propagation is not atomic", with
  the three measured numbers.

### F9 — G2 is unblocked and untouched  *(P1 — HELD)*

`GAS-Core-e5z`. P2 shipped on 2026-08-23 and removed the last `postFn` consumer; PracticeMix's
`manage-deployments.js` passes none. The override still sits in `packages/gas-deploy/lib/webapp.js`
and `bin/call-webapp.js`'s public config surface with a comment saying it exists for one consumer.
Its AC are already written in PMIX-PLAN §5 G2, including `grep -r postFn ~/proj`.

**HELD (v2), on the owner's call.** No action for now. Worth recording *why* holding is cheap: the
override is inert — no consumer passes a `postFn`, so it costs nothing at runtime and only clutters
the public config surface. The two reasons to eventually do it stand: it drags a Playwright-session
concept into a package that no longer needs one, and it is the last artifact of the `access: ANYONE`
era. Revisit when `gas-deploy` next takes a breaking change, so the removal rides an existing bump
rather than causing one.

### F10 — Pin drift, with no signal  *(P1)*

Three consumers are two minor versions behind on `gas-deploy` (v1.1.0 vs v1.2.1) and will stay
there silently — including for the `local.settings.example.json` and error-message fixes v1.2.1
shipped precisely to remove onboarding friction. Nothing surfaces "you are behind".

**Recommend:** the deploy summary already prints an env table; add one row — the resolved
`gas-deploy`/`gas-static` version from the installed `package.json`. Pair it with a
`packages/*/CHANGELOG.md` (F18) so a consumer can see what they would gain. A repo-wide "what is
pinned where" check is not worth building for five repos; the summary row is.

### F11 — The best-practice folder still ships the superseded scripts  *(P1)*

`best-practices/gas-static-frontend/` contains `build-static-pages.js` and
`publish-static-pages.js` as copy-me templates. This is the identical critique the declared-config
recommendation makes of `gas-webapp-admin/Admin.js` (§4.2: "the folder currently ships a *copy-me
file*, which is a drift source rather than a drift fix") — and it is now worse there, because a
package exists that a copy would bypass.

**Recommend:** delete both, replace with a pointer to `packages/gas-static/README.md` plus the
~15-line `tools/static-pages.js` config example and the `deployHooks()`/`summaryRows()` two-liner.
**Added in v2:** the same edit is where F6's six-point *static page interface contract* and F3/F4's
`PUBLISHERS.md` convention should land, so a project adopting the pattern meets all three
requirements from one document rather than discovering them one incident at a time.
Keep `gas-backend-example.js`, `cors-fetch-client.html`, `gis-identity-client.html` and
`appsscript.json.example` — those are *page/backend* examples, which the package deliberately does
not own ("the package owns the pipeline, never the page").

### F12 — The identity verifier now has a sixth copy, with inverted semantics  *(P1)*

R6 warned that a copy-pasted verifier "fails open silently". PracticeMix's `src/Identity.js` is a
copy-and-adapt of `gas-backend-example.js` in which the allowlist semantics are **deliberately
inverted** (empty = *any verified identity*, per D2; the example's empty = *nobody*). The
divergence is documented in the module comment so nobody "fixes" it back — which is good practice
and also exactly the evidence that this class of copy diverges on its first reuse, on the security
axis, in the fail-open direction.

The mitigating fact: that copy is the best-tested one in the estate (26 unit tests, every denial
branch, tokeninfo-outage-denies asserted, denial reason never on the wire, token never logged or
keyed on).

**Recommend:** when `GAS-Core-na8`/`libs/LibIdentity` is built, extract it from **PracticeMix's**
implementation and its tests, not from `gas-backend-example.js`, and make the allowlist posture a
**declared option** (`emptyAllowlistMeans: 'anyone-verified' | 'nobody'`) rather than a semantic a
copy must remember to invert. Sequence it with PracticeMix P6, which is the only consumer that will
exercise it — building it earlier repeats the "interface with no user" mistake G1 avoided.
`libs/LibAdmin` (`GAS-Core-hl5`) is the same shape and should follow the same rule: extract at the
next admin-gate touch, not speculatively.

### F13 / F14 / F17 / F18 — the smaller items

- **F13** `lib/buildInfo.js:readBuildInfo_` returns `{version, webappUrl, env}` only, so P4 wrote a
  three-line duplicate regex in PracticeMix to read `buildDate` — the package's own field-reader
  re-diverged at its first consumer. Its regex also matches the first `"name": "…"` occurrence
  anywhere in the file, so a comment or a second literal above `BUILD_INFO` silently wins.
  **Recommend:** scope the match to the `BUILD_INFO` literal and return every field found (or add
  `buildDate` explicitly, which is what `STATIC_BUILD_DATE_` needs).
  **Raised in v2:** F7 decides that `buildInfo` stays the *only* `webappUrl` mode, which makes this
  reader the single point of failure for three more consumers rather than one. Do it before the
  conversions, not after.
- **F14** Two genuinely reusable artifacts are stuck in PracticeMix: `tools/measure-first-paint.js`
  (5 cold CDP contexts per front end, counts bytes over `Network.loadingFinished` because the
  `HtmlService` top document reports no paint entry — the only method that produces a comparable
  number across the two) and `tests/test-utils.js:authStatePath()` (resolves `PLAYWRIGHT_AUTH_STATE`
  the way `playwright.config.js` does; the stale-`.auth/user.json` trap it fixes cost two stages and
  presents as a 30 s `beforeAll` timeout that looks nothing like an auth failure).
  **Recommend:** fold `authStatePath()` + the diagnostic into
  `best-practices/gas-playwright-testing/playwright-helpers.js` now (it is a trap, not a feature),
  and elevate the first-paint harness when the second project converts (F7), not before. Also worth
  one line in the same folder: a server-side `doGet` counter assertion (PracticeMix's `A1`) counts
  *both* front ends during a dual run and is meaningless until it scopes its count.

- **F17** `packages/gas-static/bin/` is committed and empty; there is no CLI. PracticeMix does not
  need one (it drives `runStatic()` directly), but F3Go30 and GActionSheet run build/publish
  standalone today. **Recommend:** delete the empty dir now; decide the CLI question at the RCV
  conversion, where a second consumer's actual usage settles it. **v2:** F7's mode analysis sharpens
  this — a standalone CLI is only useful in combination with a `webappUrl` mode that works without a
  deploy, so the CLI question and the `from: 'resolve'` question are one decision, not two.
- **F18** Neither package has a `CHANGELOG.md`; the commit messages do the job well but are
  invisible from a consumer checkout. **Recommend:** one file per package, backfilled from the
  release commits — cheap, and it is what makes F10's summary row actionable.

### F16 — Audio transfer is backwards: direct read should be primary, base64 the fallback  *(P1)*

**Decided 2026-08-24, on the user's call: the primary path is a direct client-side read of the
Drive file; the server-side base64 route stays as the fallback.**

The files live in a folder shared *anyone with the link may view*. That makes the server round trip
unnecessary work: `listFilesAndFolders` already returns `{id, name, mimeType, size}` (visible in
P2's quoted live evidence), so the client has everything it needs to fetch the bytes itself.

**This does not reopen D3.** D3 is about handing out `ScriptApp.getOAuthToken()` — the *owner's*
credential, broad-Drive-scoped, usable against every file they own. A file ID against a link-shared
folder grants exactly what the folder's sharing already grants, and an API key is not a user
credential. `src/Code.js:352`'s comment block forbids reintroducing the token routes; it does not
forbid this, and the distinction should be written into that comment so a future reader does not
read the two as the same thing.

**The URL matters, and the obvious one does not work.** `audioEngine.js.html:174` does
`fetch(url)` → `.arrayBuffer()` → `decodeAudioData()`, because WSOLA needs the decoded buffer. So
the source must be **CORS-readable**:

| Candidate | Verdict |
|---|---|
| `drive.google.com/uc?export=download&id=…`, and its redirect target `drive.usercontent.google.com/download` | **No.** No `Access-Control-Allow-Origin`, so `fetch().arrayBuffer()` is blocked — the same class of failure P0 hit, where the browser rejects before any body is readable. |
| `<audio src="…">` element instead of `fetch` | **No.** A cross-origin media source without CORS taints the stream and `MediaElementAudioSourceNode` outputs silence; it also does not yield the buffer WSOLA needs. |
| `https://www.googleapis.com/drive/v3/files/<id>?alt=media&key=<API_KEY>` | **Yes.** The Drive API endpoint sends CORS headers, an API key alone authorizes a link-shared file, and it supports Range requests — so progressive loading becomes possible, which the base64 round trip can never do. |

**Why the fallback stays base64 rather than binary:** Apps Script's `ContentService` can only emit
text MIME types — there is no `octet-stream`, and a web app cannot return a `Blob`. The ~33 %
inflation is therefore structural to *any* through-the-server path, not an implementation choice.
That is itself an argument for making the server path the exception.

**Work, in order:**

1. **Spike it first, exactly as P0 did** — fetch one real track from `127.0.0.1` against the
   API-key URL, confirm the response's CORS headers and that `decodeAudioData()` succeeds. This
   project's own history is the argument: P0's notes record that assumed Google CORS behaviour was
   wrong in the details and cost a stage's diagnostic budget.
2. Enable the Drive API in the script's GCP project; create an API key restricted to the Drive API
   and referrer-restricted to the Pages origin. Stamp it into the page as a build-time placeholder
   alongside the existing four, or serve it from `cmd=version` — it is not a secret, but it should
   not be hand-edited into the source.
3. `loadTrackFile()` tries the direct read, falls back to `getFileAsBase64` on any failure. Keep
   the fallback complete and tested — it is what makes a per-file permission gap degrade instead of
   break, the same posture that made P1R's removal cheap.
4. Verify sharing is genuinely inherited per file. Files *uploaded* into a link-shared folder
   inherit it; files *moved* in can carry their own permissions. A track that silently falls back
   forever should be visible, not invisible — log it.
5. Measure both paths on a real multi-megabyte track. This finally produces the delta P1R could not
   record, because the direct-fetch code was deleted before anyone measured it.

**The consequence to state plainly, because it changes what P6 can promise:** once the folder is
link-shared, the **file IDs are the access boundary**, independently of the app. Anyone who obtains
a listing can fetch those files indefinitely. That is already true today — P2's evidence shows an
anonymous caller listing the folder and pulling real audio bytes — so this is no regression. But it
means a future identity gate on the app is **cosmetic** for anyone who has already seen the IDs
unless the Drive folder's sharing is tightened at the same time. Restricting access to the choir is
therefore a two-sided change (app ACL **and** Drive sharing), not a one-line `IDENTITY_REQUIRED_`
flip. P6's scope should say so.

**What this retires:** P6's open question "restore a *gated* `getFileDownloadInfo` for the
direct-fetch speed path?" is moot in the good direction — the speed comes back with no credential
to protect and no gate to build.

**Interaction with F6 (v2):** a per-file fallback to base64 is exactly the kind of silent
degradation the runtime contract exists to surface. Whatever F6's footer/diagnostic work lands
should make "this track loaded via the slow path" visible somewhere — a log line at minimum — so a
sharing gap on one file does not present as "the app is just slow today".

### F15 — The declared-config decision is still open, and it blocks three beads  *(P2)*

`RECOMMENDATION-declared-config.md` §6 leaves "one config file or two" undecided, with a stated
recommendation of two (a committed `gas-project.json` + the gitignored `local.settings.json`).
`GAS-Core-9iu`, `-8w0` and `-hl5` all sit behind it. PracticeMix's P4 did adopt the canonical
`staticRepoPath` key, which is a real datapoint in favour: the canonical-key half of the
recommendation cost nothing at adoption time.

**Recommend:** take the two-file decision as recommended, but **do not run it as a standalone
migration**. Fold it into the next consumer conversion (RCV, per F7) so it is validated against a
real project before five repos move. If it survives that conversion unchanged, do the remaining
four in one pass.

---

## 4. Disposition of `PMIX-PLAN.md` and the `RECOMMENDATION*.md` files  *(F19, F20, F21)*

### 4.1 The rule

Neither file is a long-term artifact **as a file**, and both contain findings that are the most
valuable output of the whole exercise. They are different kinds of temporary, and they end
differently:

- **An implementation plan** is scaffolding for work that beads drive. Its stages, dependency
  graph, AC checklists and "not committed yet" notes are spent the moment the beads close. Its
  §7 handoff notes are **not** — they are where every measured number, protocol quirk and
  deliberately-dropped behaviour was recorded, and nothing else in the estate holds them.
- **A recommendation** is a proposal with a lifetime bounded by its own recommendations. Each one
  ends in exactly one of two places: **implemented** — the content moves into the artifact it
  describes (a package README, a best-practice README, an ADR) — or **tracked** — it becomes a bead
  and the prose is deleted. What a recommendation must never become is a permanent shadow document
  restating what the package README already says; that is a second source of truth for the same
  fact, which is the failure both recommendations were written to stop.

DevStandard's `doc-framework/doc-standard.md` §Graduation Rules is the applicable table
(resolved decision → ADR; confirmed architecture → DESIGN/README; observed operational behaviour →
OPERATIONS/README; protocol quirk → interface doc + ADR; risk → `bd remember`). GAS-Core does not
run the framework, so its equivalents are: **`packages/*/README.md`** (contract, config, provenance),
**`best-practices/*/README.md`** (pattern, evidence, traps), **`docs/`** (cross-cutting),
**beads** (`bd remember` for insight, issues for work), **`work-log.md`** (narrative). PracticeMix
*does* run it, and has `adr/` and `docs/architecture.md`.

**Placement note worth stating once:** `PMIX-PLAN.md` lives in GAS-Core but ~80% of it describes
work in PracticeMix. That is a placement defect on its own, and it is why the numbers below are
currently unreachable from either repo's permanent docs.

### 4.2 `PMIX-PLAN.md` — graduate, then retire

| Content | Durable? | Goes to |
|---|---|---|
| **First-paint measurement** — 4213 ms → 116 ms app-visible, 282 KB → 43 KB, 5 cold contexts/front end; *and the method*: app-visible is the only cross-comparable metric because the `HtmlService` top document reports **no paint entry at all** (pixels composited by a cross-origin iframe), bytes counted over CDP `Network.loadingFinished` not `content-length` | **yes — highest value** | `best-practices/gas-static-frontend/README.md` §"What you get", replacing/joining the older F3Go30 numbers. This is the estate's evidence for the entire pattern. |
| **D3's security finding** — `ScriptApp.getOAuthToken()` under `executeAs: USER_DEPLOYING` returns the **owner's** token, and because one file calls `DriveApp.getRootFolder()` the inferred scope is broad `…/auth/drive`, so the token carries full read/write to the owner's entire Drive for ~1 h. `access: ANYONE` is the only thing standing between that and the internet; `ANYONE_ANONYMOUS` removes it | **yes — most transferable** | `best-practices/gas-static-frontend/README.md` §"The security boundary this creates", as a **named pre-flight check**: *before flipping the manifest, enumerate every route that returns a token or a credential, and prefer removal to gating.* Plus a PracticeMix ADR (below). |
| **The `google.script.run` second door** — removing a route from the `cmd=api` action map is not enough while the `HtmlService` page is still deployed | **yes** | same section; it is the non-obvious half of the check above. |
| **CORS/401 protocol quirk (P0)** — a cross-origin `fetch()` to an `access: ANYONE` `/exec` does **not** resolve with a readable sign-in body; it rejects outright (`TypeError: Failed to fetch`) because the access-denied response carries no `Access-Control-Allow-Origin`. From Node the same URL is **HTTP 401** with body `<title>Page Not Found</title>` — not sign-in markup. Therefore classify by **HTTP status** (401/403 ⇒ sign-in; other non-JSON ⇒ mid-propagation), never by body text | **yes** | `best-practices/gas-static-frontend/README.md` §Step 1 (the CORS spike). Text-matching on "accounts.google.com" is the obvious wrong answer and this is the record of why. |
| **Propagation is not atomic** — ~1 min / 3 retries (code), ~90 s (manifest, old and new instances answering concurrently mid-request-set), ~35 s (first GitHub Pages publish into a new dir). `assertDeployedVersion` passing is not evidence the fleet turned over | **yes** | `best-practices/gas-deployment/README.md` + `packages/gas-deploy/README.md` §Deploy verification. Drives F8's settle-on-N. |
| **Base64 transfer table** — 1386–2015 ms for 0.09–0.24 MB, server round trip dominating, decode flat ~120–150 ms; ~33 % inflation; `getFileAsBase64` hard-fails > 50 MB | **yes** | `best-practices/gas-static-frontend/README.md` §Constraints (the honest cost of "no raw token"), and PracticeMix `docs/architecture.md`. |
| **`PLAYWRIGHT_AUTH_STATE` trap** — a stale in-repo `.auth/user.json` returns blanket HTTP 401 with a Google HTML body on *every* route including `cmd=version`, and presents in specs as a 30 s `beforeAll` timeout waiting for a frame body | **yes** | `best-practices/gas-playwright-testing/` — README + the `authStatePath()` helper (already F14). |
| **Dual-run verification technique** — `getUserFrame()` **detecting** the absence of `#sandboxFrame` and returning the `Page` (a `Page` and a `FrameLocator` both answer `.locator()`), so 57 specs run unchanged against both front ends; one suite as two Playwright projects; `--retries=0 --max-failures=99` because retries re-run whole `describe.serial` blocks and distort the failure list; parity-not-green as the acceptance signal | **yes** | `best-practices/gas-static-frontend/README.md` §Step 6, which currently asserts that both front ends should be regression-tested but does not say how to make one suite do it. |
| **Retirement criterion shape** — 7 consecutive days with no `doGet.start` from a non-test client (that event fires only for page loads, so its count *is* the count of stragglers), backstop D+30, and retirement blocked while any defect reproduces on the static page only | **yes, as a recipe** | `best-practices/gas-static-frontend/README.md` §Step 6. The instance already lives in PracticeMix `docs/architecture.md` §10.2. |
| **G1 provenance + deliberately-dropped list** — which of the three copies each behaviour came from; why F3Go30's CSP generation, RCV's theme stamping, `static-urls.js`, `wait-for-static-deploy.js` and `smokeTestStaticApi` step 11 were *not* ported | **yes** | `packages/gas-static/README.md`, new §Provenance. Without it, F7's conversions will re-add dropped behaviour or re-litigate settled calls. |
| **`BUILD_INFO` vs `version.html` footgun** — a server-side `src/BuildInfo.js` bare semver is the only thing `gas-static` reads; the client-side `version.html` carries a *display string* (`v1.6.7.8 (Rev. …)`) the GAS runtime cannot read at all, so pointing `webappUrl.file` at it compares a display string to a semver | **yes** | `packages/gas-static/README.md` §Config reference, on the `webappUrl` row. |
| `runStatic()` config table, returned-object shape | already permanent | `packages/gas-static/README.md` — verify no drift, then delete from the plan. |
| Stage sequence, dependency graph, bead table, AC checklists, D5 revision narrative, "not committed" notes | **no** | delete with the file. |
| §8 housekeeping (stuck beads export, no dolt remote) | **no** | beads, not docs. |
| Standing test defects (`atc-6bw`, `atc-fvv`, `atc-c1m`, `atc-1zs`, `atc-zo8`) | **no** | already beads in PracticeMix. |

**PracticeMix ADRs this generates** (its `adr/` is the right home; these are project decisions, not
estate ones):

1. **ADR-0001 (`base64-data-uri-for-drive-files`) is superseded twice over.** It was written when
   base64 was the *fallback*; P1R deleted the direct-fetch path and made it the only path; F16 now
   makes a direct client-side read of the link-shared file the primary and base64 the fallback
   again — but for a different reason and by a different mechanism (public file ID + API key, not
   the owner's OAuth token). An accepted ADR is not edited: write **one** superseding ADR that
   states the end position, carrying P1R's measurements and F16's spike result as context.
2. **New ADR — remove the raw-token routes rather than gate them (D3).** A decision with a real
   rejected alternative (gate behind verified identity, built and then deferred), a stated cost
   (base64 round trip instead of direct fetch) and an invariant. This is textbook ADR content and
   currently exists only as a bullet in a plan file.
3. **New ADR — ship the static front end open and anonymous (D5), deferring identity to P6.**
   Records D1 (direct GIS over the broker, for a single app) and D2 (empty allowlist = any verified
   identity) as its design, and relates to ADR-0002 whose audit goal stays suspended.

**Then, on the "history file" question (v2) — there is a precedent, and it is not a new folder.**
I proposed `docs/history/` in v1; that was wrong, and the survey says so:

- **The estate's history convention is `work-log.md`.** It exists in *every* surveyed repo —
  F3Go30, RankChoiceVoting, GActionSheet, NUUC-Dispatch, PracticeMix, DevStandard, GAS-Core — it has
  a `work-log` skill that appends to it in a defined v3 format (objective / rationale / outcome with
  a user/developer/internal facing tag, stamped with the session id), a `work-log-audit` skill that
  lints it and cross-references sessions against transcripts, and `blog-generate` / `changelog-generate`
  which explicitly treat it as "the capture substrate that blog and changelog renders read from".
  Nothing else in the estate is that well established.
- **PMIX-PLAN §7's handoff notes are work-log entries that were written to the wrong file.** Each
  one already has an objective, a rationale, an outcome and evidence. The stage contract's rule 6
  produced exactly the v3 shape and then filed it in a plan.
- **The anti-precedent is visible and loud.** F3Go30's root carries `PLAN.md`, `PLAN-08-19.md`,
  `PLAN-08-20.md`, `PLAN-08-21.md`, `OPEN.md`, `4jmo.md`, `NAGMAILBUG.md`, `fix-this-stuff.txt`;
  GActionSheet's carries `PLAN-bd.md`, four `HANDOFF-*.md`, `TD-PLAN-20-08.md`, `TD-PLAN-21-08.md`,
  `plan-0726.txt`, `plan-0726a.txt`, `plan-0730-*.txt`, `plan-0806-*.md`, `REVIEW-2026-06-17.md`,
  `webapp-proxy-poc.md`. That is what happens when a plan has no end state: it is never deleted,
  never updated, and eventually indistinguishable from current state. Inventing `docs/history/`
  would formalise the same accumulation with a tidier name.
- Where a repo *does* keep retired material deliberately, it uses `archive/` (GActionSheet,
  DevStandard) — a fine home for a file with genuine forensic value, and one that signals "not
  current" by its name. That is the fallback, not the default.

**Recommend:** write the durable §7 content as **work-log entries in PracticeMix's `work-log.md`**
(via the `work-log` skill, one segment per stage, preserving the session ids the notes already
carry), graduate the estate-level findings per the table above, and then **delete `PMIX-PLAN.md`**.
Git history holds the file itself if anyone ever needs the original; the work-log holds what it
*said*. Its cross-repo tracking role belongs to `GAS-Core-vo3`. Do not keep a 1176-line plan as a
living document — the failure mode is a future reader treating a struck-through P1 and a deferred
P5 as current state, and the two repos above show that failure at scale.

### 4.3 `gas-static-frontend/RECOMMENDATION.md` — mostly implemented; graduate and delete

| Section | Status | Disposition |
|---|---|---|
| §1 survey table (4 projects × 12 rows) | evidence, decaying — F7's conversions make it false row by row | Compress to a short "why this package exists" paragraph in `packages/gas-static/README.md` §Provenance (4.2 above). Keep no per-project table after the conversions land. |
| §2.1 the page pattern is settled | already permanent | Verify it is in `best-practices/gas-static-frontend/README.md`; delete here. |
| §2.2 **identity model A vs B comparison** | **durable, and not in any permanent doc** | `best-practices/gas-static-frontend/README.md` §"identity & access control". This table is the reason someone picks the right model; it should not die with the recommendation. R5 (document B as the multi-app default) is then satisfied by that edit. |
| §2.2's three weaknesses of B (copy-paste verifier, symmetric key, no revocation before `exp`) | durable | The limits go in NUUC-Dispatch's `docs/interfaces/signed-identity-assertion.md` (R7 — doc-only, unblocked). The copy-paste point is F12's bead. |
| §2.3 `ANYONE` vs `ANYONE_ANONYMOUS` coupling | R8 claims "done" | **Verify** it actually landed in a permanent doc rather than in the other recommendation's §2; if not, land it. |
| §2.4 the "who answers this question today" table | spent — the package answers all of them now | delete. |
| §2.5 `sync-how-it-works.js` | still one project | one line in `best-practices/gas-static-frontend/README.md` §not-yet-generalised, or `bd remember`. |
| §3 / §3.1 / §3.2 target architecture, config shape, `version.json` contract | implemented | `packages/gas-static/README.md` is the contract. Delete here after checking for drift (F6 changes §3.2's assertion). |
| §4 R1–R10 table | this is a tracker, not a document | → beads. R2/R3/R4 done; R1 partial (F7); R5/R7 doc-only and unblocked; R6 → `GAS-Core-na8`; R9 deferred to F3Go30's conversion; R10 → `GAS-Core-e5z`. |
| §4 "deliberately not recommended" (no framework/bundler; the package owns the pipeline never the page; don't fold into the demo harness) | **durable — these are the guardrails** | `packages/gas-static/README.md` §"What this package deliberately does not do" (exists — extend it) and `best-practices/README.md`. |
| §5 PracticeMix application, §6 sequencing, §7 scope | spent, and superseded twice over | delete with the file. |

**Then delete the file.** Its remaining unimplemented content (R5, R6, R7, R9) is four beads, not
343 lines of prose.

### 4.4 `RECOMMENDATION-declared-config.md` — still a live proposal; graduate two sections now

This one is **not** ready to retire: `GAS-Core-9iu`, `-8w0` and `-hl5` are all open, and §6's
one-file-or-two decision is unmade (F15). Keep it. But three parts are durable regardless of
whether `LibAdmin` is ever built, and should not wait on it:

| Section | Disposition |
|---|---|
| §2 **the two orthogonal auth axes** (operator secret vs visitor identity; a project needs neither, either or both; neither is implied by adopting `gas-deploy`) | Graduate **now** to `best-practices/gas-deployment/README.md`. It is the single clearest thing in the file, it is true independently of every open bead, and it is what stops a project from building the wrong gate. |
| §5 **canonical `local.settings.json` keys** + the two rules (env-scoping is structural not a prefix; project-specific keys are fine if they don't restate a canonical concept) | Graduate **now** to `packages/gas-deploy/README.md` §`local.settings.json` (v1.2.1 just created that section) and `local.settings.example.json`. Already validated once: PracticeMix P4 adopted `staticRepoPath` at zero cost. Every new consumer needs this before it needs `LibAdmin`. |
| §3 anchor declared / deployment ID cached, and why the cache stays (no-clasp-auth path, deletion detection, cost) | Graduate **now** into `packages/gas-deploy/README.md` §"Deployment description & the anchor" (exists — extend). |
| §4 `LibAdmin` design, §4.4 the deadlock and the three-part admission test for `ungatedActions` | **Keep as a proposal** — attach as design input to `GAS-Core-hl5`. It is unbuilt, and a design for unbuilt code belongs on the bead, not in a README. |
| §6 open decision (one config file or two) | Keep until F15 decides; then the decision itself graduates (4.5). |

After those three graduations the file shrinks to the `LibAdmin` proposal plus the open decision —
at which point it should become a bead description, not a document.

### 4.5 Where decisions live — GAS-Core gets an `adr/`  *(F20 — DECIDED, v2)*

**Decided by the owner, 2026-08-24:** add `adr/` to GAS-Core and keep durable decision content
there, scoped to **GAS-Core's own modules and best practices**. Project-specific decisions stay in
the project's own `adr/`. This resolves F20 and gives §4.2 and §4.3 a real destination instead of
"prose in a recommendation".

The split, with the owner's own example as the test case:

| Decision | Home | Why |
|---|---|---|
| "`webappUrl.from` supports `buildInfo` only; a `deploymentId` mode would consecrate the unreconciled binding" (F7) | **GAS-Core `adr/`** | It constrains every consumer of the package. |
| "The published-folder ownership manifest is the publish guard" (F3/F4) | **GAS-Core `adr/`** | It defines a contract between the package and every host repo. |
| "One config file or two" (F15) | **GAS-Core `adr/`** | Five repos change behaviour on it. |
| "The package owns the pipeline, never the page" (R4's guardrails) | **GAS-Core `adr/`** | It is the boundary that keeps the package from growing a framework. |
| "PracticeMix reads Drive files directly by ID, relying on the folder's *anyone with the link may view* permission" (F16) | **PracticeMix `adr/`** | The assumption is about *that folder's* sharing and *that app's* threat model. Another project adopting the pattern makes its own call. |
| "Remove the raw-token routes rather than gate them" (D3) | **PracticeMix `adr/`** | Specific to that app's routes and manifest. |

The generalisable half of the PracticeMix decisions still travels — as **pattern** content in
`best-practices/gas-static-frontend/README.md` ("if the content is link-shared, the client can read
it directly with an API key; note that the file IDs then *are* the access boundary"), not as a
GAS-Core ADR. The rule: **a GAS-Core ADR constrains code GAS-Core ships; a best-practice README
describes a pattern a project may adopt; a project ADR records what that project chose.**

Practical notes: create `adr/` with its first real ADR, not empty. Use the same format PracticeMix
already uses (`adr/000N-slug.md`) so the estate stays uniform, and run the `adr-quality-check` skill
before committing each one — accepted ADRs are superseded, never edited. `bd remember` stays for
working insight that is not a decision (the existing five memories are the right shape for it); the
ADR is for choices a future reader must not silently reverse.

### 4.6 The stage contract  *(F21)*

PMIX-PLAN §6's eight rules — claim the bead first; invoke `implementation-gate`; tests before the
change; do not widen the stage (file a bead instead); paste real gate output; **write handoff notes
into the bead *and* the plan before closing, with each stage naming what its notes must contain**;
no commit without explicit authority; record blockers and finish the unblocked remainder — ran
across eight stages in two repos and are the reason §7's notes are good enough to graduate at all.
Rule 6 in particular is why this review had measurements to work from.

That is a reusable process artifact and it is not GAS-specific. It should not be deleted along with
the plan that happens to contain it.

**Recommend:** fold it into DevStandard's `doc-framework/planning-guide.md` as a named
"staged plan contract", citing this exercise as the evidence (8 stages, what it caught: two
superseded-but-preserved stages, four defects filed rather than folded in, zero scope drift). If
DevStandard is too heavy a target, `GAS-Core/docs/staged-plan-contract.md` is the fallback — but
the DevStandard home is the right one, because the next plan of this shape will not be about GAS.

---

## 5. What is already right — do not revisit

Recorded so a later reader does not re-open settled questions:

- **The page pattern.** Hand-written self-contained HTML, no framework, no bundler, `text/plain`
  POST to stay CORS-simple, build-time `var STATIC_X_ = null;` placeholders, named diagnostics for
  the non-JSON case. Four independent implementations converged; the package owns the pipeline and
  never the page.
- **The ownership boundary between the packages.** `gas-deploy` knows nothing about static hosting;
  it offers `postDeploy` and `extraRows`, and `gas-static` supplies what goes in them. v1.1.0's
  `deployHooks()`/`summaryRows()` is the correct fix for P4 hand-rolling 34 lines and losing the
  summary row in the process.
- **Verification as a required gate.** `assertDeployedVersion` for the backend and
  `assertPublishedBuild` for the page, both `required: true`, with a stale publish demonstrated to
  fail a deploy. This is the estate's best idea; F6 sharpens it rather than changing it.
- **D3's invariant and how it was satisfied.** Removing the raw-token routes rather than gating
  them — including closing the `google.script.run` door, not just the `cmd=api` one — is stronger
  than the gate would have been, and was verified anonymously against a live deployment.
- **Direct GIS (model A) for a single app.** D1's reasoning holds. The brokered model (B) remains
  right for multi-app/long-session, and R5/R7's documentation work is independent and still worth
  doing — but not on any critical path.
- **Not merging the static pipeline into the demo harness**, and not generalising
  `sync-how-it-works.js` until a second project needs it.
- **`F3Static/README.md`'s host-repo convention** — generated-only, never hand-edited, one
  namespaced folder per app, layout table with owner and live URL. v2's F3/F4 recommendation is that
  document promoted to a checked contract, not a replacement for it.
- **`work-log.md` as the estate's history substrate**, with its skill-defined v3 format. §4.2 routes
  PMIX-PLAN's handoff notes into it rather than inventing a parallel convention.

---

## 6. Execution plan — stages, acceptance criteria, handoff

**Status key:** ✅ done · ⏸ held · ◐ decided, not implemented · ○ open · ▶ in progress

### 6.0 How this section is used

Work is executed as numbered **stages**. A stage is the unit a session claims, closes and hands
off. The rules are PMIX-PLAN §6's stage contract (F21), restated here because that file is due for
deletion:

1. Claim the stage's bead(s) first; if a bead does not exist, file it before starting.
2. Invoke the `implementation-gate` skill before writing implementation code.
3. Tests before the change where the stage changes behaviour.
4. **Do not widen the stage.** Anything discovered outside its AC becomes a new bead or a new stage,
   never an in-flight addition.
5. Paste real gate/test/command output into the handoff notes — not a summary of it.
6. Write the handoff notes into the bead **and** into this document's stage block before closing.
7. No commit without explicit authority — **except** where the stage's AC says otherwise. From S1
   onward the default is inverted: each stage ends committed and pushed, per `CLAUDE.md` §Session
   Completion. S1 exists to make that possible.
8. Record blockers explicitly and finish the unblocked remainder of the stage.

**A stage closes only when every AC box in it is checked.** A stage with an unchecked box is ▶, not
✅, regardless of how much of it is done. Partial completion is recorded by checking the boxes that
are genuinely met and leaving the rest, with a note in *Handoff* naming what is left and why.

Each stage block carries:

- **Goal** — one sentence.
- **Findings** — which §3 findings it discharges.
- **Depends on** — stages that must be ✅ first.
- **AC** — checkbox list; every box must be objectively checkable by a reader who was not there.
- **Handoff** — filled in *at close*: what was done, what was found, what the next stages must know,
  what was deliberately not done.
- **Next prompt** — the literal instruction to open the following session with.

**Next prompts assume §6.1's index order; §6.3's batching overrides them.** Where a session covers
two stages (A, C, G, H, M), run the second stage in the same session and skip the intervening next
prompt — then pick up the chain at the first stage that is still ○. §6.1's *Session · model* column
is the authority on which stages share a session.

### 6.1 Stage index

| Stage | Title | Findings | Pri | Status | Depends on | Session · model |
|---|---|---|---|---|---|---|
| — | *(prior)* PracticeMix stages committed | F2 | P0 | ✅ | — | — |
| **S1** | Secure the record | F1 | P0 | ✅ | — | **A** · Sonnet |
| **S2** | A home for decisions — GAS-Core `adr/` | F20 | P1 | ◐ | S1 | **C** · Opus |
| **S3** | CI on a declared test entry point | F5 | P0 | ✅ | S1 | **A** · Sonnet |
| **S4** | Publish safety — ownership manifest + rebase | F3, F4 | P0 | ○ | S2 | **D** · Opus, solo |
| **S5** | Package hygiene — empty `bin/`, CHANGELOGs | F17, F18 | P3 | ✅ | S1 | **A** · Sonnet |
| **S6** | Graduate the observed-reality findings | F19a | P1 | ○ | S1, S2 | **E** · Opus, solo |
| **S7** | PracticeMix: direct Drive read (spike, then ship) | F16 | P1 | ◐ | S2 | **F** · Opus, solo |
| **S8** | Version agreement — reader, assertion, page contract | F13, F6 | P1 | ○ | S3 | **G** · Sonnet |
| **S9** | Propagation and pin visibility | F8, F10 | P1 | ○ | S3, S5 | **G** · Sonnet |
| **S10** | Playwright auth-state trap → best practice | F14 | P2 | ○ | S1 | **A** · Sonnet |
| **S11** | Retire the copy-me scripts | F11 | P1 | ○ | S4, S8 | **H** · Opus |
| **S12** | Graduate package behaviour; delete the sources | F19b | P1 | ○ | S6, S8, S9, S11 | **H** · Opus |
| **S13** | PracticeMix P5b — PROD, `pub/pmix`, retirement clock | P5b | P1 | ○ | S7 | **I** · Sonnet, solo |
| **S14** | Decide one config file or two | F15 | P2 | ○ | S2 | **C** · Opus |
| **S15** | Convert RankChoiceVoting | F7a | P1 | ○ | S8, S14 | **J** · Opus, solo |
| **S16** | Convert GActionSheet | F7b | P1 | ○ | S15 | **K** · Sonnet, solo |
| **S17** | Convert F3Go30; settle CSP/CLI/`from:'resolve'` | F7c | P1 | ○ | S5, S16 | **L** · Opus, solo |
| **S18** | Extract `libs/LibIdentity` | F12 | P1 | ○ | PracticeMix P6 | **M** · Sonnet |
| **S19** | Stage contract → DevStandard | F21 | P3 | ○ | S12 | **M** · Sonnet |
| — | Retire the `postFn` override | F9 | — | ⏸ | *revisit at the next `gas-deploy` breaking change* | — |

---

### S1 — Secure the record  *(F1 · P0 · ✅)*

**Goal:** get every artifact of this exercise into `master` and pushed, so no later stage is written
on top of untracked work.

**Depends on:** —

**AC**

- [x] `xx` deleted; `.vscode/settings.json` either committed deliberately or added to `.gitignore` (state which, and why, in *Handoff*).
- [x] Three commits exist on `gas-deploy-recommendation-stage1a`: (a) the two `RECOMMENDATION*.md` + `PLAN2.md`, (b) best-practice README updates + `docs/demo-*.md` + `best-practices/gas-workspace-addons/`, (c) `PMIX-PLAN.md` + `work-log.md`.
- [x] `git status` reports a clean tree — no untracked files other than deliberately ignored ones.
- [x] Branch merged to `master` and pushed; `git status` shows "up to date with origin".
- [x] `git log --oneline master -5` pasted into *Handoff*.
- [x] A bead exists for every stage S2–S19 (see §7), each with its AC referenced.

**Handoff** *(fill at close)*
- Done: Deleted `xx`. Added `.vscode/` to `.gitignore` (Peacock editor theming — personal/per-machine,
  not project config; not committed). Made 5 commits on `gas-deploy-recommendation-stage1a`: (1)
  `PLAN2.md` + both `RECOMMENDATION*.md` + the `.gitignore`/`xx` cleanup, (2) best-practice README
  updates + `docs/demo-*.md` + `gas-workspace-addons/`, (3) `PMIX-PLAN.md` + `work-log.md`, (4) filed
  beads for S2–S19 and re-exported `.beads/*.jsonl` (2 commits — the export hook re-writes the file
  again post-commit, which needed a trailing commit). Filed 18 beads (`GAS-Core-7kh` S2 ...
  `GAS-Core-dof` S19; full map in §7-adjacent scratch, and each stage block above should be
  cross-referenced by ID when next opened) wired with `blocks` deps matching §6.1's *Depends on*
  column, plus `relates_to` links from S7→`GAS-Core-vo3`, S13→`GAS-Core-vo3`, S14→`GAS-Core-9iu`,
  S9→`GAS-Core-8w0`, S18→`GAS-Core-na8`. Merged the branch to `master` with `--no-ff` and pushed both
  `master` and the feature branch. `git log --oneline master -5`:
  ```
  596b85d bd: re-export issues.jsonl after S2-S19 bead filing
  da76b63 bd: file S2-S19 tracking beads for PLAN2's staged execution plan
  650a031 Add PMIX-PLAN.md (PracticeMix migration plan) and its work-log entries
  88fe9e9 best-practices/docs updates from the gas-static/gas-deploy consolidation
  feaeb0f Add PLAN2 review and its two recommendation source documents
  ```
- Found: The merge to `master` was much larger than the S1-authored commits alone (64 files,
  10355 insertions) — `master` had never absorbed the branch's earlier work (`packages/gas-deploy`,
  `packages/gas-static`, the `gas-cm-and-deployment`/`gas-webapp-admin` template deletions). That
  work is now on `master` too, which is correct and expected (the whole branch was due to merge, not
  just this session's commits) but worth flagging since it wasn't scoped in this stage's AC.
  `git checkout master` triggers bd's post-checkout hook, which re-imports and locally modifies
  `.beads/issues.jsonl` before you've done anything — `git restore` it before merging or committing,
  it's a regenerable export.
- Next stages must know: The bead IDs for S2–S19 are `GAS-Core-7kh`(S2) `GAS-Core-8r9`(S3)
  `GAS-Core-j3b`(S4) `GAS-Core-3rg`(S5) `GAS-Core-gsf`(S6) `GAS-Core-emk`(S7) `GAS-Core-nuy`(S8)
  `GAS-Core-8bp`(S9) `GAS-Core-y5k`(S10) `GAS-Core-98s`(S11) `GAS-Core-7bd`(S12) `GAS-Core-gne`(S13)
  `GAS-Core-4gx`(S14) `GAS-Core-d7i`(S15) `GAS-Core-rgh`(S16) `GAS-Core-hek`(S17) `GAS-Core-f3d`(S18)
  `GAS-Core-dof`(S19). Each bead's description points back at this file's §6 stage block rather than
  restating AC — check boxes here as the source of truth, then `bd close` when a stage's block is
  fully `[x]`.
- Deliberately not done: Did not claim S2's bead yet — S1's own AC stop at "a bead exists for every
  stage," not starting S2. (Session A continues into S3 next per §6.3, not S2 — S2 is session C.)

**Next prompt**
> S1 is closed. Open S2: create `adr/` in GAS-Core and write its first real ADR — the
> `webappUrl.from` constraint from PLAN2 §3 F7 — using PracticeMix's `adr/000N-slug.md` format, and
> run the `adr-quality-check` skill before committing.

---

### S2 — A home for decisions: GAS-Core `adr/`  *(F20 · P1 · ◐ decided)*

**Goal:** create `adr/` **with real content**, so S4, S14 and S17 have somewhere to put their
decisions at the moment they are made.

**Depends on:** S1

**AC**

- [ ] `adr/README.md` states the scope rule from §4.5: a GAS-Core ADR constrains code GAS-Core ships; a best-practice README describes a pattern; a project ADR records what a project chose.
- [ ] `adr/0001-*.md` exists and records the F7 decision (`webappUrl.from` supports `buildInfo` only; `from: 'resolve'` named as the correct third mode if standalone build is ever required).
- [ ] Format matches PracticeMix's `adr/` convention (`000N-slug.md`, same field set).
- [ ] `adr-quality-check` skill run against ADR-0001; output pasted into *Handoff*.
- [ ] `adr/` is not empty at close and contains no placeholder/TODO ADR.
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S2 is closed and `adr/` exists. Stay in this session (§6.3 session C) and open **S14**: decide one
> config file or two per PLAN2 §3 F15, record it as a GAS-Core ADR in the format you just
> established, and migrate no consumer. If S14 is already closed, go to S3 instead.

---

### S3 — CI on a declared test entry point  *(F5 · P0 · ✅)*

**Goal:** every package change from S4 onward is covered by something that runs without a human.

**Depends on:** S1

**AC**

- [x] Root `package.json` declares `"test"` as the single entry point; sub-scripts (`test:unit`, and `test:py` if/when it exists) are visible beneath it.
- [x] `.github/workflows/` gains a test workflow that checks out, sets up toolchains, and runs the declared script — containing **no** knowledge of which runner is used.
- [x] A second job refuses a `gas-*-v*` tag whose `packages/<name>/package.json` version does not match the tag.
- [x] Both jobs observed green on a real push; run URL or pasted output in *Handoff*.
- [x] The tag-guard job demonstrated to fail on a deliberately mismatched tag (test tag deleted afterwards).
- [x] Committed and pushed.

**Handoff**
- Done: `package.json`'s `"test"` now runs `npm run test:unit` (composing, per F5's recipe) instead of
  being the runner directly; `test:unit` is the same `node --test` glob, extended to
  `scripts/test/*.test.js`. Added `.github/workflows/test.yml` with two jobs: `test` (checkout, Node
  22, `npm test`, no runner knowledge) and `tag-guard` (`if: startsWith(github.ref, 'refs/tags/gas-')`,
  runs `scripts/check-tag-version.js "$GITHUB_REF_NAME"`). New `scripts/lib/tagVersion.js`
  (`parseTag`/`checkTagVersion`, unit-tested, 6 tests, TDD red→green) backs the guard. Trigger needed
  `tags: ['gas-*-v*']` added to `on.push` — the job's `if:` alone doesn't make the workflow run on a
  tag push. Verified live: branch-push run green —
  https://github.com/stuartdonaldson/GAS-Core/actions/runs/32772147709 (`test: success`,
  `tag-guard: success` on that push). Deliberately mismatched tag
  `gas-static-v9.9.9-test-mismatch` pushed and observed to fail tag-guard (`test: success`,
  `tag-guard: failure`) at the same run URL pattern; log: `Tag "gas-static-v9.9.9-test-mismatch"
  claims version 9.9.9-test-mismatch, but packages/gas-static/package.json declares 1.1.0.` Tag
  deleted locally and on origin afterward. Committed in 3 pieces (entry-point + workflow + guard;
  Node-version fix after CI caught a Node-20-vs-24 glob discrepancy; tag-trigger fix) and pushed.
- Found: **Node 20's built-in test-runner glob resolution does not recurse `**` the same way Node 24
  does** — `node --test 'libs/**/test/**/*.test.js' ...` passed locally (Node v24.14.0) and failed on
  GitHub Actions' `setup-node@v4` with `node-version: '20'` (`Could not find
  'libs/**/test/**/*.test.js'`) even though the file exists. Pinned CI to Node 22, confirmed green.
  This is a portability trap for anyone copying this glob pattern into another repo's CI without
  matching the Node version it was authored against — worth a line in whichever doc eventually
  documents the CI recipe (S12).
- Next stages must know: the `test` job runs on every push to `main`/`master` and every PR; the
  `tag-guard` job only runs on a `gas-*-v*` tag push. S4 onward can rely on both.
- Deliberately not done: no `test:py` sub-script — no Python test target is wired into `npm test` yet
  (the existing `best-practices/google-sheet-verification/test_*.py` files are not invoked by CI);
  per F5 this stays deferred until a Python test target actually exists, per the AC's own "if/when it
  exists" framing. Not widened to add one here.

**Next prompt**
> S3 is closed and CI is green. Open S4, the last P0: implement the published-folder ownership
> manifest per PLAN2 §3 F3+F4 — `PUBLISHERS.md` in `Static` and `F3Static`, `gas-static` validating
> `dest` against it, structural backstop checks, and `git fetch` + `git pull --rebase` before the
> publish commit.

---

### S4 — Publish safety: ownership manifest + automatic rebase  *(F3, F4 · P0 · ○)*

**Goal:** make a destructive or losing publish impossible rather than unlikely. This is the only P0
with a destructive failure mode and it touches two repos GAS-Core does not own.

**Depends on:** S2 (the decision needs an ADR home)

**AC**

- [ ] `Static/PUBLISHERS.md` exists: human half (generated-only, never hand-edited, each folder owned 100% by its originating repo) + folder → project → live-URL table covering `AS`, `AS-sit`, `ballot`, `pmix-sit`.
- [ ] `F3Static/PUBLISHERS.md` exists with the same shape, promoted from its existing `README.md`.
- [ ] A machine-readable ownership map exists (fenced JSON in `PUBLISHERS.md` or a synced `publishers.json`) with the `{ "pub/<name>": { project, env, url } }` shape.
- [ ] `publishEnv` refuses a `dest` with no exact entry, and refuses an entry whose `project` differs from the consumer's declared `projectName`, naming both the dest and its registered owner in the message.
- [ ] Structural backstop refuses a `dest` that is empty, absolute, contains `..`, resolves outside `repoRoot`, resolves *to* `repoRoot`, or contains a `.git` — active even when no manifest is present.
- [ ] Unit tests cover each refusal branch and the happy path; `rm -rf` is proven unreachable before validation passes.
- [ ] `git fetch` + `git pull --rebase` runs immediately before the publish commit, with a code comment justifying safety by the disjoint-path ownership rule; an assertion confirms the checkout is on its tracking branch.
- [ ] Push failure emits a named diagnostic stating the commit exists locally and how to finish it.
- [ ] A real PracticeMix publish to `pub/pmix-sit` succeeds end-to-end after the change; output pasted.
- [ ] `adr/000N-publish-ownership-manifest.md` written and passing `adr-quality-check`.
- [ ] `gas-static` version bumped, tagged, and PracticeMix repinned; committed and pushed in all touched repos.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S4 is closed; publishing is guarded. Open S5, a short cleanup stage: delete the empty
> `packages/gas-static/bin/` and backfill a `CHANGELOG.md` for both packages from the release
> commits (PLAN2 §3 F17, F18).

---

### S5 — Package hygiene  *(F17, F18 · P3 · ✅)*

**Goal:** remove the misleading empty `bin/` and give consumers a reason to upgrade that they can
read from their own checkout.

**Depends on:** S1

**AC**

- [x] `packages/gas-static/bin/` deleted; no reference to it remains in README or `package.json` `files`.
- [x] `packages/gas-static/CHANGELOG.md` backfilled through v1.1.0 from the release commits.
- [x] `packages/gas-deploy/CHANGELOG.md` backfilled through v1.2.1.
- [x] Each entry names the consumer-visible change, not the commit subject.
- [x] The CLI question is recorded as deferred to S17 (not decided here) — one line in `packages/gas-static/README.md` or on the bead.
- [x] Committed and pushed.

**Handoff**
- Done: Deleted the empty `packages/gas-static/bin/` (`rmdir`; it held nothing, `package.json`'s
  `files` array never referenced it, and the README's only `bin`-adjacent text was an unrelated
  `#!/usr/bin/env node` shebang in a usage example). Wrote `packages/gas-static/CHANGELOG.md`
  (v1.0.0, v1.1.0) and `packages/gas-deploy/CHANGELOG.md` (v1.0.0–v1.2.1), both backfilled from
  `git log` on each package's path and each version-bump commit's own body, phrased as
  consumer-visible changes rather than commit subjects. Added the CLI-deferral line to
  `packages/gas-static/README.md` §"What this package deliberately does not do", naming S17 and the
  coupling to `webappUrl.from: 'resolve'`. `npm test` still green (127/127) after the deletion.
  `grep -rn "gas-static/bin"` across the repo returns only PLAN2.md's own historical findings text
  (F17, its stage prompts, this AC line) — no stale pointer in any README or config.
- Found: nothing unexpected — the `bin/` dir really was inert, exactly as F17 stated.
- Next stages must know: `packages/gas-static/CHANGELOG.md` and `packages/gas-deploy/CHANGELOG.md`
  now exist; S8/S9's version bumps should append to them rather than starting fresh (their own AC
  say "CHANGELOG updated").
- Deliberately not done: did not decide the CLI question itself — only recorded it as deferred, per
  the AC's own wording.

**Next prompt**
> S5 is closed. Open S6, the safe half of the graduation (PLAN2 §4.2/§4.3, F19a): move the findings
> that describe *observed reality* into their permanent homes — first-paint numbers and method, D3's
> security finding and the `google.script.run` second door, the CORS/401 quirk, the Playwright
> auth-state trap, the dual-run technique, the retirement criterion — and write PMIX-PLAN §7's
> handoff notes into PracticeMix's `work-log.md` via the `work-log` skill. Do not delete any source
> document in this stage.

---

### S6 — Graduate the observed-reality findings  *(F19a · P1 · ○)*

**Goal:** get the irreplaceable measurements and traps out of an untracked plan file and into
documents that a reader can reach, while the detail is still fresh — without waiting on package fixes.

**Depends on:** S1, S2

**AC**

- [ ] `best-practices/gas-static-frontend/README.md` §"What you get" carries the first-paint numbers (4213 ms → 116 ms, 282 KB → 43 KB, 5 cold contexts per front end) **and the method** (app-visible is the only cross-comparable metric because the `HtmlService` top document reports no paint entry; bytes counted over CDP `Network.loadingFinished`, not `content-length`).
- [ ] Same README gains §"The security boundary this creates" with D3 stated as a **named pre-flight check** — enumerate every route returning a token or credential before flipping the manifest, prefer removal to gating — including the `google.script.run` second door.
- [ ] Same README §Step 6 carries the dual-run technique (`getUserFrame()` detecting the absent `#sandboxFrame`; one suite as two Playwright projects; `--retries=0 --max-failures=99` and why; parity-not-green as the acceptance signal) and the retirement-criterion recipe (7 consecutive days with no non-test `doGet.start`, backstop D+30, blocked while a static-only defect reproduces).
- [ ] Same README carries §2.2's identity model A vs B comparison table and its three weaknesses of B.
- [ ] The CORS/401 quirk is recorded in a permanent doc (name which).
- [ ] PMIX-PLAN §7 handoff notes written into PracticeMix `work-log.md` via the `work-log` skill, one segment per stage, preserving the recorded session ids.
- [ ] PracticeMix ADRs written: supersede ADR-0001; new ADR for D3 (remove rather than gate); new ADR for D5 (ship open and anonymous, identity deferred to P6). Each passes `adr-quality-check`.
- [ ] No source document deleted in this stage; `PMIX-PLAN.md` and both `RECOMMENDATION*.md` still present.
- [ ] Each graduated item is traceable — a table in *Handoff* mapping source section → destination file and heading.
- [ ] Committed and pushed in both repos.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S6 is closed; the observed-reality findings are safe. Open S7 in PracticeMix: spike the direct
> client-side Drive read per PLAN2 §3 F16 — fetch one real track from `127.0.0.1` against
> `https://www.googleapis.com/drive/v3/files/<id>?alt=media&key=<API_KEY>`, confirm the CORS headers
> and that `decodeAudioData()` succeeds. Do not write the implementation until the spike result is
> recorded.

---

### S7 — PracticeMix: direct Drive read primary, base64 fallback  *(F16 · P1 · ◐ decided)*

**Goal:** stop round-tripping audio through the server when the files are already link-shared —
spike first, exactly as P0 did, because assumed Google CORS behaviour has already cost a stage here.

**Depends on:** S2 (PracticeMix `adr/` and the superseding ADR from S6 are the destination)

**AC — spike (must close before implementation begins)**

- [ ] One real track fetched from `127.0.0.1` against the Drive API + API-key URL; response CORS headers pasted.
- [ ] `decodeAudioData()` confirmed to succeed on the fetched buffer.
- [ ] Range-request support confirmed or refuted; result recorded.
- [ ] Spike result written into *Handoff* **before** any implementation edit.

**AC — implementation**

- [ ] Drive API enabled in the script's GCP project; API key created, restricted to the Drive API and referrer-restricted to the Pages origin.
- [ ] The key is stamped as a build-time placeholder or served from `cmd=version` — never hand-edited into source.
- [ ] `loadTrackFile()` tries the direct read and falls back to `getFileAsBase64` on any failure; the fallback path remains complete and tested.
- [ ] A fallback occurrence is **visible** (log line at minimum), so a per-file sharing gap does not present as "the app is slow today".
- [ ] Per-file sharing inheritance verified for files *moved* into the folder as well as uploaded ones; result recorded.
- [ ] Both paths measured on a real multi-megabyte track; the delta P1R could not record is pasted into *Handoff*.
- [ ] `src/Code.js:352`'s comment block amended to distinguish the forbidden owner-token routes from this file-ID path.
- [ ] A PracticeMix ADR supersedes ADR-0001 with the end position, carrying P1R's measurements and this spike's result.
- [ ] `atc-t6w` (P6) amended: the gated-`getFileDownloadInfo` question dropped as moot; the two-sided nature of any future tightening (app ACL **and** Drive sharing) recorded in P6's scope.
- [ ] The generalisable half written into `best-practices/gas-static-frontend/README.md` as pattern content — including that the file IDs then *are* the access boundary.
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S7 is closed. Open S8 in GAS-Core: fix `readBuildInfo_` (scope the regex to the `BUILD_INFO`
> literal, return every field including `buildDate`), then extend `assertPublishedBuild` to assert
> `env` and `webappUrl`, and write the six-point static page interface contract from PLAN2 §3 F6
> into `best-practices/gas-static-frontend/README.md`.

---

### S8 — Version agreement: reader, assertion, page contract  *(F13, F6 · P1 · ○)*

**Goal:** make the single reader three more consumers are about to depend on correct, and make
version agreement true at runtime as well as at deploy time.

**Depends on:** S3 (CI must be green before package changes land)

**AC — F13**

- [ ] `readBuildInfo_`'s regex is scoped to the `BUILD_INFO` literal; a comment or a second `"name": "…"` above it can no longer win. Test proves it.
- [ ] The reader returns every field found, `buildDate` included.
- [ ] PracticeMix's three-line duplicate regex deleted and replaced by the package reader.

**AC — F6 half 1 (deploy-time)**

- [ ] `assertPublishedBuild` accepts `{ expectedEnv, expectedWebappUrl }`, both defaulted from the config and the resolved deployment.
- [ ] Each mismatch fails with the same "published pointing somewhere real" message the build-time guard uses.
- [ ] `test/assert.test.js` covers mismatch on `version`, on `env`, and on `webappUrl` independently.
- [ ] A `dist/prod` published into a `test` dest is demonstrated to fail.

**AC — F6 half 2 (runtime contract)**

- [ ] `best-practices/gas-static-frontend/README.md` carries the six-point static page interface contract as a numbered requirement list, naming F3Go30 as the reference implementation.
- [ ] PracticeMix's gaps against it (requirements 2, 3, 4, 6) are filed as beads with the contract cited — or closed in this stage; state which in *Handoff*.
- [ ] `gas-static` version bumped and tagged; CHANGELOG updated (S5's file).
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S8 is closed. Open S9: add settle-on-N to `assertDeployedVersion`, raise `assertPublishedBuild`'s
> default `timeoutSec` to 300, write the "propagation is not atomic" section with the three measured
> numbers, and add the resolved package-version row to the deploy summary (PLAN2 §3 F8, F10).

---

### S9 — Propagation and pin visibility  *(F8, F10 · P1 · ○)*

**Goal:** stop rediscovering the propagation window every stage, and make a consumer able to see
that it is behind.

**Depends on:** S3, S5 (the CHANGELOG is what makes the version row actionable)

**AC**

- [ ] `assertDeployedVersion` requires **N consecutive** successful version reads (default 2, configurable); tests cover N=1, N=2 and a flap between reads.
- [ ] `assertPublishedBuild`'s default `timeoutSec` raised to 300 so a direct caller gets the honest default; the `deployHooks()` wrapper still agrees.
- [ ] `best-practices/gas-deployment/README.md` gains a "propagation is not atomic" section carrying all three measured numbers (P1R ~1 min / 3 retries for code; P2 ~90 s for a manifest change; P4 ~35 s for a first Pages publish).
- [ ] The deploy summary prints the resolved `gas-deploy` and `gas-static` versions read from the installed `package.json`.
- [ ] A real deploy shows the new row; output pasted.
- [ ] `gas-deploy` version bumped, tagged, CHANGELOG updated; committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S9 is closed. Open S10, a small stage: fold `authStatePath()` and its stale-`.auth/user.json`
> diagnostic into `best-practices/gas-playwright-testing/playwright-helpers.js`, and add the one-line
> note about scoping the server-side `doGet` counter assertion during a dual run (PLAN2 §3 F14).

---

### S10 — Playwright auth-state trap → best practice  *(F14 · P2 · ○)*

**Goal:** stop a 30-second `beforeAll` timeout that looks nothing like an auth failure from costing
another two stages.

**Depends on:** S1

**AC**

- [ ] `authStatePath()` lives in `best-practices/gas-playwright-testing/playwright-helpers.js`, resolving `PLAYWRIGHT_AUTH_STATE` the way `playwright.config.js` does.
- [ ] The named diagnostic for a stale `.auth/user.json` ships with it, and its message describes the symptom (30 s `beforeAll` timeout) as well as the cause.
- [ ] PracticeMix's local copy replaced by the shared helper, or a bead filed to do so at its next test touch; state which.
- [ ] One line in the same folder notes that a server-side `doGet` counter assertion counts **both** front ends during a dual run and is meaningless until scoped.
- [ ] `measure-first-paint.js` recorded as deferred to S15 (elevate at the second conversion, not before).
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S10 is closed. Open S11: delete `build-static-pages.js` and `publish-static-pages.js` from
> `best-practices/gas-static-frontend/`, and make that README the one document a new adopter reads —
> pointer to `packages/gas-static/README.md`, the ~15-line config example, the
> `deployHooks()`/`summaryRows()` two-liner, S8's interface contract and S4's `PUBLISHERS.md`
> convention (PLAN2 §3 F11).

---

### S11 — Retire the copy-me scripts  *(F11 · P1 · ○)*

**Goal:** remove the drift source, and make one document carry all three requirements an adopter
must meet.

**Depends on:** S4 (the `PUBLISHERS.md` convention), S8 (the interface contract)

**AC**

- [ ] `best-practices/gas-static-frontend/build-static-pages.js` and `publish-static-pages.js` deleted.
- [ ] The README points at `packages/gas-static/README.md` and carries the ~15-line `tools/static-pages.js` config example plus the `deployHooks()`/`summaryRows()` two-liner.
- [ ] S8's six-point interface contract and S4's `PUBLISHERS.md` convention are both reachable from that one README.
- [ ] `gas-backend-example.js`, `cors-fetch-client.html`, `gis-identity-client.html` and `appsscript.json.example` are **retained** — the package owns the pipeline, never the page.
- [ ] `grep -rn 'build-static-pages\|publish-static-pages' best-practices/ docs/` returns no stale pointer; output pasted.
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S11 is closed. Open S12, the closing graduation: move the package-behaviour text into the package
> READMEs (`version.json` contract as amended by S8, propagation guidance, the `BUILD_INFO` vs
> `version.html` footgun, G1's provenance and deliberately-dropped list), then delete
> `PMIX-PLAN.md` and `best-practices/gas-static-frontend/RECOMMENDATION.md` and graduate §2/§3/§5 of
> the declared-config recommendation (PLAN2 §4.2–§4.4, F19b).

---

### S12 — Graduate package behaviour; delete the sources  *(F19b · P1 · ○)*

**Goal:** the source documents survive exactly until their replacements are correct — then they go.

**Depends on:** S6, S8, S9, S11

**AC — into `packages/gas-static/README.md`**

- [ ] New §Provenance: which of the three copies each behaviour came from, and why F3Go30's CSP generation, RCV's theme stamping, `static-urls.js`, `wait-for-static-deploy.js` and `smokeTestStaticApi` step 11 were **not** ported.
- [ ] §Config reference's `webappUrl` row carries the `BUILD_INFO` vs `version.html` footgun (a display string is not a semver, and the GAS runtime cannot read `version.html` at all).
- [ ] The `runStatic()` config table and returned-object shape checked against the plan for drift, then confirmed authoritative.
- [ ] §"What this package deliberately does not do" extended with R4's guardrails (no framework/bundler; the package owns the pipeline never the page; not folded into the demo harness); `best-practices/README.md` carries the same.

**AC — into `packages/gas-deploy/README.md`** *(from `RECOMMENDATION-declared-config.md`)*

- [ ] §`local.settings.json` carries the canonical key list and the two rules (env-scoping is structural not a prefix; project-specific keys are fine if they do not restate a canonical concept); `local.settings.example.json` matches.
- [ ] §"Deployment description & the anchor" extended with the anchor-declared / ID-cached reasoning (no-clasp-auth path, deletion detection, cost).
- [ ] `best-practices/gas-deployment/README.md` carries the two orthogonal auth axes (operator secret vs visitor identity).

**AC — deletions and residue**

- [ ] R5, R6, R7, R9 confirmed to exist as beads; `best-practices/gas-static-frontend/RECOMMENDATION.md` deleted.
- [ ] `PMIX-PLAN.md` deleted, with S6's work-log entries confirmed present first.
- [ ] `RECOMMENDATION-declared-config.md` reduced to the `LibAdmin` proposal + the open decision, attached as design input to `GAS-Core-hl5`.
- [ ] `grep -rn 'PMIX-PLAN\|RECOMMENDATION.md' .` returns no live cross-reference; output pasted.
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S12 is closed; the scaffolding is gone and the findings are in permanent homes. Open S13 in
> PracticeMix: finish the migration — deploy PROD, create `pub/pmix`, publish, and start the
> retirement clock, closing `atc-mta` and `GAS-Core-vo3`.

---

### S13 — PracticeMix P5b: PROD, `pub/pmix`, retirement clock  *(P5b · P1 · ○)*

**Goal:** the highest-value *product* item in the list; the retirement criterion cannot start
counting until it exists.

**Depends on:** S7

**AC**

- [ ] PROD backend deployed; `assertDeployedVersion` green with S9's settle-on-N.
- [ ] `pub/pmix` registered in `Static/PUBLISHERS.md` (S4) before the first publish.
- [ ] Static page published to `pub/pmix`; `assertPublishedBuild` green on `version`, `env` and `webappUrl` (S8).
- [ ] The live PROD static URL loads and completes one real end-to-end action; evidence pasted.
- [ ] The retirement clock started: the `doGet.start` non-test-client count is being recorded, with day 0 stated.
- [ ] `atc-mta` and `GAS-Core-vo3` closed.
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S13 is closed and PracticeMix is fully migrated. Open S14: decide one config file or two per
> PLAN2 §3 F15, record it as a GAS-Core ADR, and do **not** run it as a standalone migration — it
> gets validated inside S15's RankChoiceVoting conversion.

---

### S14 — Decide one config file or two  *(F15 · P2 · ○)*

**Goal:** unblock `GAS-Core-9iu`, `-8w0` and `-hl5` with a decision, without migrating five repos on
an unvalidated one.

**Depends on:** S2

**AC**

- [ ] The decision is made and written as a GAS-Core ADR (recommended: two files — a committed `gas-project.json` + the gitignored `local.settings.json`); passes `adr-quality-check`.
- [ ] The ADR records PracticeMix's zero-cost `staticRepoPath` adoption as the supporting datapoint.
- [ ] `GAS-Core-9iu`, `-8w0`, `-hl5` amended with the decision and the fold-into-S15 sequencing.
- [ ] **No consumer repo migrated in this stage** — explicitly confirmed.
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S14 is closed. Open S15: convert RankChoiceVoting to `gas-static` — Mode A (`from: 'buildInfo'`)
> with `resolveBeforeStamp` and a `BUILD_INFO` literal, its theme/theme-fonts/dev-contact
> placeholders through the generic `placeholders` config, `smokeTestStaticApi` step 11 dropped in
> favour of `assertPublishedBuild`, and S14's config shape validated in the process.

---

### S15 — Convert RankChoiceVoting  *(F7a · P1 · ○)*

**Goal:** the smallest delta of the three, and the validation run for S14's config decision.

**Depends on:** S8, S14

**AC**

- [ ] RCV's `tools/build-static-pages.js` and `publish-static-pages.js` deleted; the pipeline runs through `gas-static` with `deployHooks()` + `summaryRows()`.
- [ ] Converted to Mode A: `resolveBeforeStamp: true` + a server-side `BUILD_INFO` literal; **no** `from: 'deploymentId'` mode added to the package.
- [ ] Theme, theme-fonts and dev-contact placeholders expressed through the generic `placeholders` config with no package change.
- [ ] `smokeTestStaticApi.js` step 11 removed as subsumed by `assertPublishedBuild`.
- [ ] RCV repinned to current `gas-deploy` and `gas-static` tags.
- [ ] A full deploy + publish run green against RCV's test env; summary output pasted, including S9's version row.
- [ ] S14's config shape adopted here; any change it needed is recorded and the ADR amended or superseded accordingly.
- [ ] `measure-first-paint.js` elevated to `best-practices/` now that a second project can use it (F14's deferred half).
- [ ] Committed and pushed in both repos.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S15 is closed and the config decision survived a real conversion. Open S16: convert GActionSheet —
> multi-page via `stampedPages`, its asset tree via `copyAssets`, and its `sit`/`prod` portal
> vocabulary via `envs[].deployTarget`. It contributed the env-agreement guard, so confirm it gets
> that guard back.

---

### S16 — Convert GActionSheet  *(F7b · P1 · ○)*

**Depends on:** S15

**AC**

- [ ] `scripts/build-static-portal.js` and `publish-static-portal.js` deleted; pipeline runs through `gas-static`.
- [ ] `index.html` + `doc.html` handled by `stampedPages`; the asset tree by `copyAssets`; `sit`/`prod` mapped to deploy targets via `envs[].deployTarget` — all with **no** package change, or the package change is recorded and justified.
- [ ] The env-agreement guard it originally contributed is demonstrably active again (a deliberate mismatch fails; output pasted).
- [ ] Both `pub/AS` and `pub/AS-sit` entries present in `Static/PUBLISHERS.md` and validated by the publish.
- [ ] Repinned to current tags; full deploy + publish green for both envs.
- [ ] Committed and pushed in both repos.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S16 is closed. Open S17, the last conversion: F3Go30. It forces three package decisions — the
> post-stamp CSP transform (consumer-side `transformPage(html, ctx)` hook vs leaving CSP in F3Go30's
> tooling), `static-urls.js` (R9), and whether the standalone-build capability is genuinely needed,
> which is the CLI and `from: 'resolve'` question as one decision.

---

### S17 — Convert F3Go30; settle the deferred package questions  *(F7c · P1 · ○)*

**Depends on:** S5, S16

**AC**

- [ ] The CSP question decided: either a consumer-side `transformPage(html, ctx)` hook lands in `gas-static`, or CSP generation stays in F3Go30's tooling — decision recorded as a GAS-Core ADR either way.
- [ ] R9 (`static-urls.js`) decided with a second consumer to justify it; recorded.
- [ ] F3Go30 asked whether the standalone-build capability is genuinely needed. If yes, `from: 'resolve'` is implemented (calling the same `resolveEnvDeploymentId` chain, refusing a vanished deployment) **and** the CLI is built; if no, both are closed as declined. One decision, recorded either way.
- [ ] `tools/build-static-pages.js`, `publish-static-pages.js`, `wait-for-static-deploy.js` retired or explicitly retained with a stated reason.
- [ ] Repinned to current tags; full deploy + publish green.
- [ ] `packages/gas-static/README.md` §Provenance updated — the deliberately-dropped list is now settled rather than pending.
- [ ] Committed and pushed in both repos.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S17 is closed — all four consumers now run one pipeline. Open S18 when PracticeMix P6 lands:
> extract `libs/LibIdentity` from PracticeMix's tested verifier (not from `gas-backend-example.js`),
> making the allowlist posture a declared `emptyAllowlistMeans` option.

---

### S18 — Extract `libs/LibIdentity`  *(F12 · P1 · ○)*

**Goal:** collapse the sixth copy of the verifier at the moment there is a real consumer — not
before, which is the "interface with no user" mistake G1 avoided.

**Depends on:** PracticeMix P6

**AC**

- [ ] `libs/LibIdentity` extracted from **PracticeMix's** `src/Identity.js` and its 26 tests, not from `gas-backend-example.js`.
- [ ] Allowlist posture is a declared option (`emptyAllowlistMeans: 'anyone-verified' | 'nobody'`), not a semantic a copy must remember to invert.
- [ ] All 26 denial-branch tests ported and green, including tokeninfo-outage-denies, denial reason never on the wire, token never logged or keyed on.
- [ ] PracticeMix consumes the library; its local copy deleted.
- [ ] `GAS-Core-na8` closed; `GAS-Core-hl5` (`LibAdmin`) confirmed to follow the same rule — extract at the next admin-gate touch, not speculatively.
- [ ] Committed and pushed in both repos.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S18 is closed. Open S19, the last stage: fold the eight-rule stage contract into DevStandard's
> `doc-framework/planning-guide.md` as a named "staged plan contract", citing this exercise as the
> evidence.

---

### S19 — Stage contract → DevStandard  *(F21 · P3 · ○)*

**Depends on:** S12

**AC**

- [ ] The eight rules land in DevStandard's `doc-framework/planning-guide.md` as a named "staged plan contract" (fallback, only if DevStandard is rejected as a target: `GAS-Core/docs/staged-plan-contract.md` — state which and why).
- [ ] The evidence is cited: 8 stages across two repos; two superseded-but-preserved stages; four defects filed rather than folded in; zero scope drift.
- [ ] Rule 6 (handoff notes into the bead **and** the plan, each stage naming what its notes must contain) is called out as the rule that made this review possible.
- [ ] Filed in DevStandard's own tracker, not GAS-Core's.
- [ ] Committed and pushed.

**Handoff** — Done: / Found: / Next stages must know: / Deliberately not done:

**Next prompt**
> S19 closes PLAN2. Review the remaining held item (F9, the `postFn` override) against whether
> `gas-deploy` has taken a breaking change since; if it has, retire the override on that bump. Then
> delete this document, since its findings now live in the artifacts each stage named.

---

### 6.2 Why this order

**S1–S5 protect what exists** and cost about one session between them. S1 first because everything
else is written on top of work that is currently untracked. S2 second because S4, S14 and S17 each
produce a decision that needs somewhere to go, and an `adr/` created after the fact gets backfilled
badly or not at all. S3 before any package change so the changes are covered. S4 is the only P0 with
a destructive failure mode and it needs edits in two repos GAS-Core does not own, so starting it
early leaves room for that to be slow.

**S6 is half of the graduation, deliberately.** F6, F8 and F13 change what the graduated text should
*say* — but only the text describing *package behaviour*. Findings that describe *observed reality*
(the measurements, the security finding, the CORS quirk, the traps, the dual-run technique) do not
depend on the packages being fixed, so they graduate immediately while the plan is fresh. The rest
waits for S12, and only then are the source documents deleted.

**S7–S11 make the packages right.** S7 leads because its spike is half a session and its result
changes an ADR, P6's scope, and the base64 paragraphs S12 graduates — doing it later means writing
those twice. S8's F13 half precedes everything else because `buildInfo` staying the only `webappUrl`
mode makes that reader the single point of failure for three more consumers. S11 is last of the
group because it is the document that must carry S8's contract and S4's convention together.

**S13 finishes the migration.** It is the highest-value *product* item and it is stuck behind
nothing but a decision to run it. Every day it waits is a day the two ~4.9k-line front-end copies
drift, with only a structural DOM-parity test watching them.

**S14–S19 spread it.** One project per stage, in ascending order of difficulty, each carrying the
config decision and the interface contract with it. S18 and S19 ride on work that has to happen
anyway rather than being scheduled on their own.

### 6.3 Session batching and model selection

19 stages do **not** mean 19 sessions. The grouping below packs stages that share context and
separates the ones that compete for it.

**The Sonnet test:** a stage runs on Sonnet when its AC are *closed-form* — the decision is already
made in §3 and the AC asks only for execution plus evidence. A stage stays on Opus when its AC
contain the word **decide**, when it requires editorial judgement about what a paragraph should
*say*, or when it designs a shape §3 only sketches.

#### Session order

**The table below is in preferred execution order** — a topological sort of §6.1's stage
dependencies, which for these twelve sessions is also alphabetical. Run them top to bottom. Where
two adjacent sessions have no dependency between them (D / E / F after C; I after F) the order given
is the preferred one, not a constraint: it front-loads the P0 with the destructive failure mode (D)
and the read-heavy graduation (E) while the plan is fresh. The only hard sequencing rules beyond
§6.1's *Depends on* column are **J → K immediately** (§6.3 anti-pairings) and **nothing after H's
deletions in the same session**.

**Status key** (same as §6.1): ✅ done · ▶ in progress · ○ open · ◐ decided, not implemented ·
⏸ held. A session's status is the aggregate of its stages: ✅ only when every stage in it is ✅,
▶ as soon as any stage in it is claimed.

| # | Session | Stages | Model | Status | Why this grouping | Context load |
|---|---|---|---|---|---|---|
| 1 | **A** | S1 + S3 + S5 + S10 | Sonnet | ▶ | All GAS-Core repo plumbing, and none of them reads a package's internals, so they do not compete. S1 leaves the tree clean and pushed, S3 adds the workflow, S5 deletes `bin/` and backfills two CHANGELOGs, S10 moves one helper. | Medium — S1's bead-filing AC is the heavy part, and it needs §6 in view, which the session already has |
| 2 | **C** | S2 + S14 | Opus | ○ | Both are pure ADR authoring against the same conventions and the same `adr-quality-check` loop; one session that learns the format writes both. **S14 depends only on S2**, so pulling it forward from its index position costs nothing — its AC explicitly forbid migrating any consumer. This is the one deviation from §6.1's order, and dependencies already permit it. | Medium |
| 3 | **D** | S4 — solo | Opus | ○ | Designs a cross-repo schema §3 only sketches, edits two repos GAS-Core does not own, and is the only P0 with a destructive failure mode. Early, because the cross-repo half may be slow. | Medium |
| 4 | **E** | S6 — solo | Opus | ○ | The context hog of the whole plan: 1176 lines of `PMIX-PLAN.md` plus both recommendations read as *source*, written out to five destinations across two repos. If it does not fit, **split at the repo boundary** — GAS-Core best-practices first, then PracticeMix work-log + the three ADRs — rather than dropping AC. | Very high |
| 5 | **F** | S7 — solo | Opus | ○ | The implementation AC are contingent on a spike outcome that is unknown by construction. Both halves belong in one session so the spike result feeds the code directly. | High |
| 6 | **G** | S8 + S9 | Sonnet | ○ | Both are `packages/` internals with tests and a version bump, over the same files (`lib/buildInfo.js`, `lib/assert.js`, `lib/verify.js`, `lib/summary.js`, both test dirs). Together they take **one** coordinated bump/tag/CHANGELOG pass instead of two. F6's six-point contract is quoted verbatim in §3, so the authoring half is transcription. | High but coherent |
| 7 | **H** | S11 + S12 | Opus | ○ | Both edit `best-practices/gas-static-frontend/README.md` and the package READMEs, and S12's deletions are only safe once S11's README is correct. One session holds the source documents and their replacements side by side, which is exactly what "graduate, then delete" requires. | High |
| 8 | **I** | S13 — solo | Sonnet | ○ | Live PROD deploy. Nothing else belongs in a session while a deploy is running. | Low |
| 9 | **J** | S15 — solo | Opus | ○ | First conversion: it validates S14's decision against reality and is the stage most likely to surface a needed package change. | High (whole repo) |
| 10 | **K** | S16 — solo, immediately after J | Sonnet | ○ | Sonnet-safe *only because* S15 established the recipe. Run it as the very next session, while copying that recipe is still the obvious move. | High (whole repo) |
| 11 | **L** | S17 — solo | Opus | ○ | Its AC are three open decisions (the CSP hook, R9, `from: 'resolve'`/CLI). | High (whole repo) |
| 12 | **M** | S18 + S19 | Sonnet | ○ | S18's 26 existing tests are an oracle, which makes a security extraction mechanical. S19 is an hour in a different repo and can ride along, or run anywhere after S12. **S18 additionally waits on PracticeMix P6**, which is outside this plan — if P6 has not landed, run S19 alone here and re-queue S18. | Medium |

Five Sonnet sessions (A, G, I, K, M) cover eight stages; seven Opus sessions (C, D, E, F, H, J, L)
cover the remaining eleven. Session **B** is deliberately unused — the letters were assigned by
model group in v5 and are kept stable so the stage index's *Session · model* column does not have to
be re-lettered on every re-order.

#### Anti-pairings

- **Never batch two conversions** (S15 / S16 / S17). Each is a full repo of context, and the second
  silently inherits the first's assumptions instead of re-deriving them.
- **Never batch across S12's deletions.** A session that deletes `PMIX-PLAN.md` and then starts new
  work has lost the ability to check its own graduation.
- **Never pair anything with S6 or S7.** Both are read-heavy in a way that crowds out the writing.

**Net: 19 stages → 12 sessions**, five of them Sonnet covering eight stages.

## 7. Beads to file

Not yet filed — all of the above is new. **S1's last AC is that a bead exists for every stage
S2–S19**, each referencing its stage's AC list rather than restating it; this table is the mapping
from findings to the records that already exist, and the raw material for that filing pass.

| Finding | Bead |
|---|---|
| F9 | `GAS-Core-e5z` (exists, unblocked) |
| F7 | new epic + one issue per project; supersedes R1's scope in the recommendation |
| F12 | `GAS-Core-na8` (exists) — amend to "extract from PracticeMix's implementation" |
| F15 | `GAS-Core-9iu` (exists) — amend with the fold-into-RCV-conversion sequencing |
| F2, P5 remainder | `GAS-Core-vo3` (exists, open) and PracticeMix `atc-mta` |
| F19 | new epic — "graduate and retire the PMIX-PLAN/RECOMMENDATION artifacts", one issue per §4 target document; blocks the deletion issues |
| F20 | new — GAS-Core design-decision home (`bd remember` + package §Design decisions) |
| F21 | new — stage contract → DevStandard `planning-guide.md`; DevStandard's own tracker, not GAS-Core's |
| F16 | new, in PracticeMix's tracker — spike + implementation; amend `atc-t6w` (P6) to drop the gated-direct-fetch question and add the Drive-sharing half of any future tightening |
| F1, F3, F4, F5, F6, F8, F10, F11, F13, F14, F17, F18 | new |
| PracticeMix ADRs (supersede 0001; D3; D5) | new, in PracticeMix's tracker |

---

## 8. Revision log

**v6 — 2026-08-24.** §6.3 restructured: the two model-grouped tables (Sonnet, then Opus) become a
**single table in preferred execution order** — A · C · D · E · F · G · H · I · J · K · L · M — a
topological sort of §6.1's *Depends on* column that for these twelve sessions is also alphabetical.
Model moves from being the table's organising axis to a column, and a **Status** column is added
using §6.1's key, with the rule that a session's status is the aggregate of its stages (✅ only when
all are ✅; ▶ as soon as any is claimed). *Context load* is now carried for every session, not just
the Sonnet ones. Added: which adjacent orderings are preference rather than constraint, the two hard
sequencing rules (J → K immediately; nothing after H's deletions), a note that S18 additionally
waits on PracticeMix P6 with the fallback of running S19 alone, and a note that session letter **B**
is deliberately unused so the *Session · model* column in §6.1 need not be re-lettered. No stage, AC,
finding or session membership changed.

**v5 — 2026-08-24.** §6.3 added: session batching and model selection. 19 stages group into **12
sessions** — five Sonnet sessions covering eight stages (A: S1+S3+S5+S10; G: S8+S9; I: S13; K: S16;
M: S18+S19) and seven Opus sessions (C: S2+S14; D: S4; E: S6; F: S7; H: S11+S12; J: S15; L: S17),
with three named anti-pairings. The Sonnet test is stated: a stage runs on Sonnet when its AC are
closed-form — the decision already made in §3, the AC asking only for execution plus evidence. §6.1
gains a *Session · model* column, and §6.0 records that next prompts assume index order while §6.3's
batching overrides them. One ordering deviation: **S14 pairs with S2** rather than following S13,
which its dependencies (S2 only) already permitted. No stage, AC or finding changed.

**v4 — 2026-08-24.** §6 rewritten from an ordered item table into a **staged execution plan**. The
22 ordered items become 19 stages (S1–S19), each carrying: a one-sentence goal, the findings it
discharges, its stage dependencies, a checkbox **AC list** written so a reader who was not present
can verify each box, a **Handoff** block (Done / Found / Next stages must know / Deliberately not
done) filled in at close, and a literal **next prompt** to open the following session with. §6.0
restates PMIX-PLAN §6's eight-rule stage contract inline — that file is due for deletion in S12 —
with rule 7 inverted from v3 onward (each stage now ends committed and pushed; S1 exists to make
that possible) and the closing rule stated explicitly: **a stage closes only when every AC box is
checked**; an unchecked box makes it ▶, not ✅. §6.1 is the stage index carrying priority, status
and dependencies; §6.2 keeps v3's ordering rationale, re-expressed in stage numbers. No finding's
content changed, and no item was added or dropped — S7's spike/implementation split and S8's
F13/F6-half-1/F6-half-2 split are v3's own sequencing made into separate AC groups.

**v3 — 2026-08-24.** §6 replaced with an ordered work table carrying a status column, dependencies
and target artifact for every finding, plus the reasoning behind the order. F19 split into **F19a**
(graduations that describe observed reality — safe to do immediately) and **F19b** (text describing
package behaviour, which must wait for F6/F8/F13 and gates the deletion of the source documents),
resolving v2's sequencing caveat. No finding's content changed.

**v2 — 2026-08-24.** Owner review of F1–F11.

- **F2 resolved** — handled in a separate session; kept as a record.
- **F3 + F4 merged and re-based on a host-repo manifest** (`PUBLISHERS.md` + a machine-readable
  ownership map the package validates against) rather than path heuristics, per the owner's
  direction. `F3Static/README.md` identified as the existing half-built precedent; `Static/README.md`
  is the gap. One correction retained: content ownership removes *merge* conflicts, not the
  git-level non-fast-forward, so an automatic rebase is still needed — and is provably safe
  precisely because the paths are disjoint.
- **F5 expanded** — CI must run a *declared* test entry point visible at the top of the
  configuration chain, not a hardcoded runner, because parts of the estate are Python/pytest.
- **F6 substantially expanded** — split into the deploy-time assertion and a new **static page
  interface contract** (six requirements) drawn from F3Go30's `formatVersionFooter_` /
  `isUpdateAvailable_` / per-version dismissal / `clientVersion`-on-every-POST implementation.
  PracticeMix meets 1 and 5 of the six.
- **F7 expanded** — full two-mode comparison with the standalone-build tradeoff stated; the
  recommendation not to add `from: 'deploymentId'` stands, with `from: 'resolve'` named as the
  correct third mode if the capability is genuinely needed.
- **F9 held** at the owner's request, with the cost of holding recorded.
- **F20 decided** — GAS-Core gets an `adr/`; §4.5 rewritten with the GAS-Core-vs-project split and
  the owner's direct-download example as the worked test case.
- **§4.2's "history file" recommendation withdrawn and replaced** — `work-log.md` is the estate's
  actual precedent (universal, skill-supported, the declared capture substrate); `docs/history/`
  was an invention, and the root-level plan litter in F3Go30 and GActionSheet is the anti-precedent.
- Knock-ons recorded on F11, F13, F16 and F17; F3Static's convention and `work-log.md` added to §5.
- F8, F10, F11 accepted unchanged.

**v1 — 2026-08-24.** Initial review: 18 findings; §4 (artifact disposition) added in the same day's
follow-up, with F16 rewritten after the direct-read decision.
