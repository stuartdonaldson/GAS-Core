# Recommendation — consolidate the static front-end pipeline and the identity broker

Companion to [`README.md`](README.md) (the *pattern*) and to
[`../gas-deployment/RECOMMENDATION.md`](../gas-deployment/RECOMMENDATION.md) (the *deploy*
consolidation that produced `packages/gas-deploy/`). This document is the same exercise for the
half `gas-deploy` deliberately left alone: **building, publishing and verifying the static entry
page, and establishing who the visitor is once it loads.**

Surveyed: `F3Go30`, `RankChoiceVoting`, `GActionSheet` + `NUUC-Dispatch`, `PracticeMix`, plus the
static hosting repos `F3Static` and `Static`, and this repo's own `static/` demo.

---

## 1. Problem

The static entry page is no longer an experiment — three of five surveyed projects ship one, on two
hosting repos, and the pattern is documented and demoed here. But every project built its own
pipeline for it, and the copies have already drifted:

| | F3Go30 | RankChoiceVoting | GActionSheet | PracticeMix |
|---|---|---|---|---|
| Source | `static-pages/src/` | `static-pages/src/` | `static-portal/src/` | — none — |
| Build | `tools/build-static-pages.js` | `tools/build-static-pages.js` | `scripts/build-static-portal.js` | — |
| Publish | `tools/publish-static-pages.js` | `tools/publish-static-pages.js` | `scripts/publish-static-portal.js` | — |
| Placeholders stamped | version, webapp URL | version, webapp URL, theme, theme-fonts, dev contact | version, webapp URL, env label | — |
| Backend URL learned from | `local.settings.json` deployment IDs | `local.settings.json` deployment IDs | `src/Version.js` `BUILD_INFO.webappUrl` (stamped by the deploy that just ran) | — |
| Stamps >1 page | yes (`how-it-works.html`) | no | yes (`index.html`, `doc.html`) | — |
| Copies non-HTML assets | yes | no | yes (icons, privacy/terms, consent text) | — |
| Env vocabulary | `sit`/`prod` == deploy targets | `sit`/`prod`/`nuuc`, 2 repos, 2 Google accounts | portal `sit`/`prod` ≠ deploy `test`/`production` | — |
| Missing static repo path | `exit(1)` | `exit(1)` | warn and continue | — |
| Cross-repo push confirmation | never prompts | never prompts | prompts unless `--yes`/chained | — |
| Publish landed on the CDN? | `tools/wait-for-static-deploy.js` polls the live page's stamp | `smokeTestStaticApi.js` step 11 asserts the live page carries this deployment's exec URL | **not checked** | — |
| Cross-origin regression test | Playwright live-SIT specs (serve `src/` from `127.0.0.1`) | `smokeTestStaticApi.js` (`cmd=api`, unauthenticated) | `tests/playwright/cors_team_portal.test.js` (fail-closed contract) | — |

The three build scripts are recognisably the same script — the same
`var STATIC_BUILD_VERSION_ = null;` placeholder convention, the same `dist/<env>/`, the same
`version.json` companion, the same scoped `git add`/commit/push into a sibling generated-only repo,
the same chaining as the final step of `deploy()`. Each header says so
("adapted from F3Go30's `tools/build-static-pages.js`"). This is exactly the state
`manage-deployments.js` was in before `gas-deploy`: seven copies, three strategies, no fallback.

The drift is not yet painful, but two rows above are already load-bearing defects:

- **Publish verification is optional and inconsistent.** `gas-deploy` made backend deploy
  verification a mandatory, non-skippable gate (`assertDeployedVersion` against `cmd=version`)
  precisely because `clasp deploy` exiting 0 proves nothing. `git push` to a Pages repo exiting 0
  proves exactly as little — GitHub Pages builds asynchronously and the CDN serves stale edges for
  minutes. Two projects noticed and improvised a check; one has none. **The static half of a deploy
  is currently unverified in the general case**, and the front end is the half users actually load.
- **The backend URL is bound two different ways, and only one of them can be wrong.**
  F3Go30/RCV read deployment IDs out of `local.settings.json` at build time — a recorded value that
  may be stale, and that nothing reconciles against the deploy that just happened. GActionSheet
  reads `BUILD_INFO.webappUrl`, which `gas-deploy`'s `resolveBeforeStamp` wrote from the live
  resolver chain moments earlier, and *asserts* that `BUILD_INFO.env` matches the portal env being
  built, failing loudly rather than baking last deploy's URL into this one's output. That guard is
  the difference between "published" and "published pointing somewhere real".

---

## 2. Findings

### 2.1 The page pattern itself is settled — don't re-derive it

Every implementation converged on the same shape without coordination, which is the strongest
signal available that it is right:

- One hand-written, self-contained `index.html` — no framework, no bundler, no design-tool export.
- `fetch()` POST with `Content-Type: text/plain` so the request stays CORS-simple (Apps Script has
  no useful `OPTIONS` handler). Every project's transport helper carries the same comment.
- Response parsed defensively, with a *named* diagnostic for the non-JSON case
  ("the deployment may be mid-propagation" / "you got a Google sign-in page"). Both are real,
  frequent failure modes; both are otherwise unreadable.
- Build-time placeholders (`var STATIC_X_ = null;`) rather than a config file or a query param, so
  the unbuilt source still runs directly from a local server for testing.
- A distinct in-flight view between "visitor did something" and "we know who they are"
  (GActionSheet's `showLaunch`/`showAppShell` split; the README's Step 4 "identifying…" state).

That is the reusable core. It is already documented in [`README.md`](README.md) and demoed in
[`../../static/`](../../static/). Nothing here proposes changing it.

### 2.2 Two identity models exist, and the better one is not the documented one

| | **A — direct GIS** | **B — brokered assertion** |
|---|---|---|
| Where | `../../static/index.html` + [`gas-backend-example.js`](gas-backend-example.js); this repo's demo | `Static/pub/AS/index.html` → NUUC-Dispatch → GActionSheet |
| Flow | page gets a Google ID token → POSTs it to the app → app calls `tokeninfo` → checks `aud`/`iss`/`exp` → allowlist on `sub` | page gets an ID token → POSTs to the **dispatcher** with a target `aud` → dispatcher verifies, returns an HS256 assertion (`iss`/`sub`/`email`/`aud`/`exp`, 45-day TTL) → page caches it → sends it to the target app, which verifies locally with a shared per-target secret |
| Per-request cost | one `UrlFetchApp` round trip to Google, every privileged call | HMAC only — no network call |
| Session length | Google ID token lifetime (~1h) → re-prompt | 45 days, cached in `localStorage`, renewed by a normal sign-in near `exp` |
| Estate cost | one OAuth client ID + consent screen **per app** | one, shared; adding an app is a row in `ASSERTION_TARGETS` + a minted key |
| Failure posture | fail-closed on `sub` allowlist | fail-closed (`tier: 'NONE'`), keyed on `sub`, `aud`-scoped so an assertion for one app is useless at another |
| Contract | prose in this README | `NUUC-Dispatch/docs/interfaces/signed-identity-assertion.md`, ADR-0002/0003 |

Model B is a genuinely better piece of architecture than the one this folder currently documents:
it removes a Google round trip from every privileged call, gives the iOS/Safari story a 45-day
artifact instead of a 1-hour one (see README §"Storage persistence"), and makes "add a second app"
cheap. Model A remains the right answer for a **single** anonymous app with a small allowlist —
it needs no dispatcher, no key distribution, no second deployment.

Three weaknesses of B to fix before it spreads further:

1. **`Assertion_verify` is copy-paste.** `Assertion.js` says so explicitly: "reference
   implementation target apps copy (first: GActionSheet)". This is the same duplication
   `gas-deploy` eliminated on the Node side, on the side that matters more — a verifier is
   security code, and a fail-open divergence in one copy is silent. `libs/` already hosts
   `LibSheets`/`LibSidebar` as canonical GAS libraries; the verifier belongs there.
2. **HMAC is symmetric.** Every target app holds a key that can *mint* assertions for itself.
   Acceptable inside one owner's estate; it should be a stated limitation in the contract, with
   the upgrade path (RS256 + a dispatcher-published JWKS route) named, not discovered later.
3. **No revocation inside the 45-day window.** The only lever is rotating `kid`, which invalidates
   every session for that app at once. Fine for the current tiers; state it, and pair a shorter TTL
   with any future tier that can destroy data.

### 2.3 The access model is the hidden coupling — and PracticeMix is paying for it

A static front end on a different origin can only talk to a web app deployed
`access: ANYONE_ANONYMOUS`. `access: ANYONE` returns HTTP 401 and a Google sign-in page to any
cross-origin `fetch()`. This single manifest field decides whether the whole pattern is available.

The cost of getting it wrong is visible in the tooling. PracticeMix is `access: ANYONE`, so
`tools/call-webapp.js` cannot use the shared `bin/call-webapp.js` — it launches **a headless
Chromium with a captured Playwright session** to make an HTTP POST, and feeds that back into
`gas-deploy` as a `postFn` transport override. That override exists in the package's public config
surface for one consumer. Downstream: a `pnpm run auth` capture chore, a session that expires and
fails deploys, `authenticate.js`, `.auth/`, and an error path dedicated to "you got a sign-in page
instead of JSON". None of that is Practice Mix functionality; all of it is the `ANYONE` manifest
value, and all of it disappears the moment the app moves to `ANYONE_ANONYMOUS` + an app-level ACL.

The trade is real and must be stated plainly: `ANYONE` outsources a weak gate ("must be some
signed-in Google account") to Google. Removing it means **the app-level ACL becomes the entire
security boundary** — the point README.md already makes under "The security boundary this creates".
For PracticeMix that boundary is not theoretical: see §5.

### 2.4 Dev-side calling is consolidated; dev-side *static* verification is not

The "call the web app from the development environment" family is in good shape and needs no
rework — `gas-deploy`'s `lib/webapp.js` + `bin/call-webapp.js` own URL resolution, secret
injection, the POST→GET redirect and the non-JSON diagnostic; each project contributes only its
env map, auth field and ungated actions (RCV ~40 lines, NUUC-Dispatch ~20). `cmd=version` is a
uniform, secret-free route across every project. That is the model to copy, not to change.

What is *not* consolidated is everything on the static side of the same question:

| Question the developer actually asks | Who answers it today |
|---|---|
| Is the backend serving the build I just stamped? | `gas-deploy` `assertDeployedVersion` — **every project, mandatory** |
| Is the static page serving the build I just published? | F3Go30 only (`wait-for-static-deploy.js`), ad hoc |
| Is the published page pointed at the deployment I just deployed? | RCV only (`smokeTestStaticApi.js` step 11), ad hoc |
| Does a real cross-origin browser still reach the API? | all three, three different ways |
| What URL is this env's static page? | F3Go30 only (`tools/static-urls.js`, reading the GAS-side constant back rather than re-hardcoding the host — a fix worth generalising) |

### 2.5 Content duplication between the two front ends is handled once, well

F3Go30's `tools/sync-how-it-works.js` renders one canonical Markdown fragment into every page that
shows it, and runs automatically before every `clasp push`. That is the right answer to the manual
sync point README.md §"Constraints" flags as a known hazard ("grep both periodically for drift").
It is currently one project's private tool. Generalising it is low value *unless* a second project
needs it — noted here so it isn't re-invented.

---

## 3. Target architecture

```
  package: gas-deploy  (exists)             package: gas-static  (proposed)
  ─────────────────────────────             ──────────────────────────────
  auth → stamp → push → redeploy  ──┐    ┌── build(stamp placeholders, per-env dist/)
  → postDeploy hooks → verify       │    │   publish(copy → sibling repo → scoped commit/push)
  → summary                         │    │   assertPublishedBuild(poll live page's stamp)
                                    │    │
                          postDeploy└───►┘   (one hook, ordered, required)

  library: LibIdentity  (proposed)          service: identity dispatcher (NUUC-Dispatch, exists)
  ────────────────────────────────          ─────────────────────────────────────────────────
  Assertion_verify(jwt, aud) ─ fail-closed  verify_identity(idToken, aud)
  used by every target app                  → tokeninfo → HS256 assertion (aud-scoped, 45d)
```

### 3.1 `packages/gas-static` — build, publish, verify

Consumer-side becomes pure config, matching `gas-deploy`'s shape:

```js
// tools/static-pages.js
const { runStatic } = require('gas-static');

module.exports = runStatic({
  root: __dirname + '/..',
  srcDir: 'static-pages/src',
  distDir: 'static-pages/dist',
  stampedPages: ['index.html'],            // default: every .html at srcDir root
  copyAssets: true,                        // everything else under srcDir, verbatim
  // Where the backend URL comes from. Prefer 'buildInfo' — it cannot name a deployment
  // this deploy did not land in, and asserts env agreement before writing anything.
  webappUrl: { from: 'buildInfo', file: 'src/Version.js', envField: 'env' },
  placeholders: {                          // extra project-specific stamps
    STATIC_THEME_: (ctx) => THEME[ctx.env],
  },
  envs: {
    sit:  { deployTarget: 'test',       repoKey: 'staticRepoPath', dest: 'pub/AS-sit', label: 'SIT' },
    prod: { deployTarget: 'production', repoKey: 'staticRepoPath', dest: 'pub/AS',     label: 'PROD' },
  },
  liveUrl: (env) => `https://nuuc-it.github.io/Static/${envs[env].dest}/`,
});
```

Owned by the package (one implementation, not four):

- placeholder stamping with **missing-placeholder = hard failure** (all three copies already do
  this; keep it), `version.json` companion, per-env `dist/`, asset tree copy;
- the `deployTarget ↔ static env` mapping as *declared config* rather than a per-project constant —
  this is the row every project drew differently, and the one a newcomer gets wrong;
- publish: resolve sibling repo from `local.settings.json`, refuse a non-git path, `git add`
  **scoped to `dest`** (RCV's comment explains why: an unscoped add publishes a different app's
  half-finished work from the shared host repo), commit with a version-stamped message, push;
- one policy for the two divergences: **missing repo path = warn and skip** (GActionSheet's
  posture — a fresh clone without the sibling repo should not fail a deploy), **prompt before a
  cross-repo push unless chained or `--yes`**;
- `assertPublishedBuild(env, version)` — poll `liveUrl` for the stamped
  `STATIC_BUILD_VERSION_`/`version.json` until it matches, with the same interval/timeout config
  shape as `verifyOptions`.

### 3.2 `version.json` becomes the static-side `cmd=version`

All three projects already write it; RCV's comment concedes it is "not currently read back". Make
it the contract:

```jsonc
{ "version": "2.5.0.9", "env": "sit", "webappUrl": "https://script.google.com/macros/s/AKfy…/exec", "builtAt": "…" }
```

`assertPublishedBuild` polls it — cheap (no HTML regex), CDN-cacheable, and it answers both live
questions at once: *is the new build served* **and** *does it point at the deployment we just
deployed*. That subsumes F3Go30's `wait-for-static-deploy.js` and RCV's `smokeTestStaticApi.js`
step 11, and gives GActionSheet the check it lacks. Chained as a `required: true` `postDeploy`
step, the static half of the deploy becomes as non-skippable as the backend half.

### 3.3 `libs/LibIdentity` — one verifier, not one per app

Move `Assertion_verify` out of "copy this into your app" and into a canonical GAS library beside
`LibSheets`/`LibSidebar`, with the fail-closed unit tests that currently live only in
NUUC-Dispatch. The dispatcher keeps `Assertion_issue` and the `aud → kid` registry. Promote
`docs/interfaces/signed-identity-assertion.md` to `best-practices/` (or `docs/interfaces/` here) as
the estate-wide contract, extended with the symmetric-key and revocation limitations from §2.2.

---

## 4. Recommendations

| # | Recommendation | Why | Cost |
|---|---|---|---|
| **R1** | Extract `packages/gas-static` from the three copies; convert F3Go30, RCV, GActionSheet | Three drifting copies of one script; the drift already includes a security-relevant guard (env agreement) present in only one | ~1 stage each, same shape as `gas-deploy` Stages 2–3 |
| **R2** | Make `assertPublishedBuild` a required `postDeploy` step everywhere a static page exists | A published front end that the CDN hasn't picked up is indistinguishable from a failed fix; two projects improvised the check, one has none | small — the polling logic already exists twice |
| **R3** | Standardise on `webappUrl: from buildInfo` + env-agreement assertion | Removes the only way to publish a page pointed at the wrong (or a deleted) deployment | requires each consumer to stamp `webAppUrl` into its version file — `gas-deploy`'s `resolveBeforeStamp` already supports this, no new mechanism |
| **R4** | Publish `version.json` with `{version, env, webappUrl, builtAt}` and make it the verification contract | One cheap, uniform route answering both liveness questions; mirrors `cmd=version` | trivial |
| **R5** | Promote the brokered-assertion model (B) to the documented default for **multi-app or long-session** front ends; keep direct GIS (A) documented for single-app | B removes a `UrlFetchApp` per privileged call, turns a 1-hour session into 45 days on the platform where that matters most (iOS/ITP), and makes app #2 cheap | doc + one worked example; the implementation exists and is in production |
| **R6** | Move `Assertion_verify` into `libs/LibIdentity` with its tests; keep issuance in the dispatcher | A copy-pasted security verifier fails open silently; `libs/` exists for exactly this | one library, one migration per target app |
| **R7** | State the assertion contract's limits explicitly: symmetric key (targets can self-mint), no revocation before `exp` | Both are acceptable *inside one owner's estate* and unacceptable to discover later; name the RS256/JWKS upgrade path now | doc only |
| **R8** | Fold "static front end requires `ANYONE_ANONYMOUS`; the app-level ACL then **is** the security boundary" into the deployment model — **done**, as the two-auth-axes section of [`../gas-deployment/RECOMMENDATION-declared-config.md`](../gas-deployment/RECOMMENDATION-declared-config.md) §2 | The manifest value silently decides whether this whole pattern is available, and it is currently discovered per project | doc only |
| **R9** | Generalise F3Go30's `static-urls.js` idea into the package: the static base URL is declared **once**, GAS-side, and read back by Node tooling | Same class of fix as R3 — a host move should not need a coordinated multi-file edit to stop printing stale links | small |
| **R10** | Retire the `postFn` transport override from `gas-deploy`'s public config once PracticeMix moves to `ANYONE_ANONYMOUS` (§5) | It is a one-consumer escape hatch for a manifest choice, and it drags a Playwright session capture into the deploy path | follows R11–R14 |

Deliberately **not** recommended:

- **A shared static "framework", component library, or bundler.** Every project hand-wrote one
  self-contained HTML file and every one of them says that was the right call. The package should
  own the *pipeline*, never the page.
- **Merging the static pipeline into `push-demo.sh`/the demo harness.** An `HtmlService`-rendered
  demo page is a different, lesser thing (see this repo's stored rationale) and must not be
  presented as demonstrating this pattern.
- **Generalising `sync-how-it-works.js`** until a second project needs it (§2.5).

---

## 5. Applying this to PracticeMix

> **Now planned in detail:** [`../../PMIX-PLAN.md`](../../PMIX-PLAN.md) turns this section into
> eight executable stages across both repos, with acceptance criteria and required handoff
> notes, and settles the two open decisions below (D1: direct GIS, not the broker, for this
> single app; D2: any *verified* Google identity, logged, with an empty-by-default allowlist).

PracticeMix is the sharpest test of the pattern: it is the surveyed project that would benefit most
and the one with a real blocker in the way.

**Why it is the strongest candidate.** ~150 KB of hand-written client code
(`ui.js.html` 53 KB, `audioEngine.js.html` 39 KB, `styles.css.html` 31 KB, plus WSOLA, WAV encoder,
ffmpeg exporter) is inlined by `include()` and pushed through the `HtmlService` sandbox on **every
load**, with no CDN and no `Cache-Control`, in front of a mobile audience opening it repeatedly on
phones — precisely the ~100× first-paint cost the README quantifies. It is a client-side
application that uses Apps Script as a Drive broker; the backend does folder listing, an OAuth
token handoff, and admin routes. There is essentially no server-rendered content to lose.

**Secondary payoffs.** The `postFn`/Playwright-session tax (§2.3) disappears. ADR-0002's own
alternatives table already chose `executeAs: ME` while listing "`executeAs: ME` + GIS" as blocked
on "GAS iframe/CSP compatibility unverified" — a static first-party page is exactly what unblocks
that row, restoring the user-email logging ADR-0002 suspended. Its unbound/standalone project type
is *not* an obstacle: nothing in the pattern depends on a container, and unbound is in fact the
easier case (no bound-container two-project split, per `gas-deployment` §Deployment Models).

**The blocker, stated precisely.** `Code.js:361` `getOAuthToken()` returns
`ScriptApp.getOAuthToken()` — under `executeAs: USER_DEPLOYING` that is the **owner's** Drive-scoped
token, handed to the browser so it can fetch audio directly from the Drive API. Today
`access: ANYONE` means a caller must at least be a signed-in Google account. Under
`ANYONE_ANONYMOUS`, which the static front end requires, that route would hand the owner's
Drive-scoped OAuth token to **any anonymous caller on the internet**. This is not a
static-front-end defect — it is a pre-existing thin gate that the migration removes, and it must be
replaced *before* the manifest changes, not after.

Sequenced accordingly:

| Stage | Work | Gate |
|---|---|---|
| **P0 — CORS spike** | Serve an unbuilt page from `127.0.0.1` via Playwright against a live TEST deployment; `text/plain` POST to a new `cmd=api` route. Do this before porting anything (README Step 1). | Round trip returns JSON cross-origin |
| **P1 — identity + ACL first** | Register `practicemix` as an assertion `aud` in NUUC-Dispatch; verify with `LibIdentity` (R6) — or copy the reference verifier if R6 has not landed. Gate `getOAuthToken` and every Drive route on a verified, allowlisted `sub`, default-deny. Concentrate tests here: this is the entire security boundary. | Unauthenticated `getOAuthToken` returns denied; a verified non-allowlisted `sub` returns denied |
| **P2 — flip the manifest** | `access: ANYONE_ANONYMOUS`. Retire `authenticate.js`, `.auth/`, `pnpm run auth`, and the `postFn` transport; `tools/call-webapp.js` collapses to the standard `bin/call-webapp.js` wrapper (~20 lines, cf. NUUC-Dispatch). | `node tools/call-webapp.js version` works with no browser; deploy verification passes without a session |
| **P3 — port the page** | Hand-port `index.html` + the six `.js.html` includes into `static-pages/src/index.html`, DOM ids/classes verbatim so the existing Playwright locators carry over. Replace `google.script.run` with the `callApi()` `text/plain` client. Set `<title>`/favicon client-side; `history.replaceState` for bookmarkable folder deep links (a real gain here — folder navigation is currently invisible to the address bar). | Existing UI specs pass against the static page |
| **P4 — pipeline** | Adopt `gas-static` (R1); publish to a `pub/practicemix` folder on the existing `Static` repo rather than standing up a new one (RCV's precedent); chain build → publish → `assertPublishedBuild` as required `postDeploy` steps. | A deploy fails if the CDN is not serving the new build pointed at the new deployment |
| **P5 — run both, retire later** | Keep the `HtmlService` page live and regression-tested alongside; retire on its own schedule. | Both front ends green in one suite |

Open decisions for you, not derivable from the code:

1. **Who is allowlisted?** Today the app is open to every signed-in Google account. A `sub`
   allowlist is a behaviour change for choir members. Options: allowlist by `sub` (tightest);
   allow any *verified* Google identity and log it (restores ADR-0002's audit goal, same openness
   as today); or keep listing anonymous and gate only `getOAuthToken`/export. My recommendation is
   the second for launch, third as a fallback — the first is an operational burden for a choir.
2. **Does P1 ship before P3, or together?** I have sequenced ACL-before-manifest as
   non-negotiable; whether the port lands in the same release is a scheduling call.

---

## 6. Sequencing

R5/R7/R8 (documentation) are independent and can land immediately. R1–R4 + R9 are one package
extraction with three conversions, mirroring `gas-deployment`'s Stages 2–3. R6 (`LibIdentity`) is
independent of the package and gated only on GActionSheet's willingness to re-point its verifier.
PracticeMix (§5) depends on R6 for P1 and R1 for P4, and on nothing else — P0–P3 can proceed
against a copied verifier if the library slips.

## 7. Out of scope

Design languages/theming (RCV's `data-theme` mechanism is one project's concern), the demo
harness (`scripts/push-demo.sh`, `libs/harness-hosts.json`), Workspace add-on surfaces, and any
change to the page-authoring style itself (§4, "deliberately not recommended").
