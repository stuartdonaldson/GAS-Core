# PMIX-PLAN — PracticeMix static front-end migration

**Status:** in execution · **Created:** 2026-08-22 · **Revised:** 2026-08-22 (see §3 D5) · **Executor:** Sonnet, one stage per session

Derived from [`best-practices/gas-static-frontend/RECOMMENDATION.md`](best-practices/gas-static-frontend/RECOMMENDATION.md)
§5 and [`best-practices/gas-deployment/RECOMMENDATION-declared-config.md`](best-practices/gas-deployment/RECOMMENDATION-declared-config.md).
This plan takes only the parts of those recommendations that PracticeMix actually needs, and
defers the rest.

---

## 1. Why

PracticeMix inlines ~150 KB of hand-written client code (`ui.js.html` 53 KB, `audioEngine.js.html`
39 KB, `styles.css.html` 31 KB, plus WSOLA, the WAV encoder and the ffmpeg exporter) through the
`HtmlService` sandbox on **every load**, with no CDN and no `Cache-Control`, to a mobile audience
that opens it repeatedly. That is the ~100× first-paint cost the pattern exists to remove.

Three things make it an unusually cheap port:

- **The RPC surface is tiny.** 7 `google.script.run` call sites in one file, hitting **3** server
  functions: `listFilesAndFolders` (×5), `getFileAsBase64`, `getOAuthToken`. Everything else is
  already client-side.
- **There is no server-rendered content to lose.** `doGet` builds one template whose only dynamic
  content is `include()` of static assets.
- **Unbound is the easy case.** No bound-container two-project split; the project already deploys
  through `gas-deploy` with `TEST-WEB-APP`/`PROD-WEB-APP` anchors.

**Secondary payoffs, all already tracked as open work:** the Playwright-session transport tax
disappears (`authenticate.js`, `.auth/`, `pnpm run auth`, and `gas-deploy`'s one-consumer `postFn`
override), and the bookmarkable-URL cluster — `atc-z49`, `atc-7k0`, `atc-ex0`, `atc-es8`,
`atc-jd2`, `atc-war` — becomes buildable at all. `history.replaceState` and a query string are not
available inside the `HtmlService` iframe; those six issues are blocked on this migration, not on
themselves.

## 2. What this plan takes, and what it leaves

| Recommendation | Taken? | Where |
|---|---|---|
| R1 extract `packages/gas-static` | **yes**, PracticeMix as first consumer only | G1 |
| R2 `assertPublishedBuild` as a required `postDeploy` step | **yes** | G1 + P4 |
| R3 `webappUrl` from `BUILD_INFO` + env-agreement assertion | **yes** | G1 + P4 |
| R4 `version.json` `{version, env, webappUrl, builtAt}` as the contract | **yes** | G1 + P4 |
| R8 static ⇒ `ANYONE_ANONYMOUS` ⇒ the app ACL **is** the boundary | **yes**, but satisfied by *removing* the raw-token routes rather than gating them — see D3/D5 | P1R, P2 |
| Visitor identity as a launch requirement | **no** — deferred to optional P6 per D5; the app ships open, as it effectively is today | P6 |
| R10 retire the `postFn` override | **yes** | G2 |
| R1 conversion of F3Go30 / RCV / GActionSheet | **no** — deferred; one consumer proves the package | — |
| R5/R6/R7 brokered assertions, `libs/LibIdentity` | **no** — see §3 decision D1 | — |
| R9 `static-urls.js` generalisation | **no** — one project's need so far | — |
| `libs/LibAdmin`, declared-config keys (`GAS-Core-hl5`, `-9iu`, `-8w0`) | **no** — off this critical path; PracticeMix's admin gate already works | — |

## 3. Decisions taken here (so no stage has to stop and ask)

**D1 — Identity model: direct GIS (model A), not the brokered assertion (model B).**
The recommendation prefers B for *multi-app or long-session* front ends. PracticeMix is one app,
and B would put a cross-project, cross-account dependency on NUUC-Dispatch on the critical path of
a performance migration, plus key distribution. A is already implemented end-to-end in this repo —
[`static/index.html`](static/index.html) and
[`best-practices/gas-static-frontend/gas-backend-example.js`](best-practices/gas-static-frontend/gas-backend-example.js)
(`verifyGoogleIdToken_` against `tokeninfo`, `aud`/`iss`/`exp` checks, `isSubAllowlisted_`
fail-closed) — so P1 is a copy-and-adapt, not a design.
*Reversible:* the swap to B later is confined to one verify function. Cost accepted: ~1 h sessions
instead of 45 days, and one `UrlFetchApp` per privileged call — mitigate the latter by caching the
verification result in `CacheService`, keyed by a hash of the token, for the token's remaining life.
`GAS-Core-na8`/`-l81` (model B) are re-prioritised to P3 accordingly.

**D2 — Who is allowlisted: any *verified* Google identity, logged.**
This matches today's effective openness (`access: ANYONE` = any signed-in Google account) so it is
not a behaviour change for choir members, and it restores the user-email audit goal ADR-0002
suspended. Implement the allowlist mechanism anyway, as a Script Property that is **empty by
default**: empty = any verified identity; non-empty = that list only. Tightening then becomes a
config change, not a code change.

**D3 — the owner's OAuth token must never be reachable anonymously.** This is the invariant, and
it is non-negotiable. The reason is specific: `src/Code.js:364` `getOAuthToken()` returns
`ScriptApp.getOAuthToken()`, which under `executeAs: USER_DEPLOYING` is the **owner's** token —
and because `src/GasLogger.js` calls `DriveApp.getRootFolder()`, the script's inferred scope is
the broad `https://www.googleapis.com/auth/drive`, so that token carries **full read/write access
to the owner's entire Drive** for ~1 hour, not access scoped to the choir folder. Today
`access: ANYONE` is the only thing standing between that route and the open internet, and
`ANYONE_ANONYMOUS` removes it.

*Two mechanisms satisfy the invariant.* The plan originally chose **gating** the route behind a
verified identity (stage P1, executed and deployed). D5 replaces that with **removing** the route
from the API surface altogether (stage P1R), which satisfies the same invariant without requiring
anyone to sign in. Either is sufficient; **at least one must be in force before P2 flips the
manifest.** What must never happen is P2 shipping with an ungated, un-removed `getOAuthToken`.

**D5 — identity is deferred to an optional stage after the migration ships (revision, 2026-08-22).**
Superseding the P1-before-P2 ordering, on the user's call. The migration's purpose is first paint,
not access control, and PracticeMix is effectively open today (`access: ANYONE` = any signed-in
Google account, no allowlist, no per-user authorisation). Requiring sign-in was therefore never a
restoration of an existing boundary — it was new friction for choir members, introduced on the
critical path of a performance change. So: **the app ships open and anonymous**, D3's invariant is
satisfied by removal instead of gating (stage P1R), and the identity work becomes **optional stage
P6**, sequenced after the static front end is live.

Nothing built in P1 is discarded. `src/Identity.js` and its 26 unit tests stay in the repo, unwired
and dormant behind a single `IDENTITY_REQUIRED_` switch that P1R sets to `false`; P6 is the stage
that flips it back on. D1 (direct GIS) and D2 (empty allowlist = any verified identity) still stand
as P6's design — they are not revisited.

*Cost accepted, stated plainly:* between P2 and P6 the app is readable by anyone with the URL, and
the per-user email audit trail ADR-0002 suspended stays suspended. Both were already true before
this plan started. What is **not** accepted at any point is D3's invariant lapsing.

**D4 — Publish to `pub/pmix` in the existing `Static` repo** (`/home/stuar/proj/Static`,
alongside `pub/AS` and `pub/ballot`), not a new hosting repo. RCV's precedent.

## 4. Stage sequence

Two repos. `G*` stages execute in **GAS-Core** (`/mnt/c/dev/GAS-Core`), `P*` stages in
**PracticeMix** (`/home/stuar/proj/PracticeMix`). Each repo has its own beads DB; a stage claims
the bead in the repo it runs in.

```
  GAS-Core   G1 ─────────────────────────────────┐                    G2
                                                 │                     ▲
  PracticeMix   P0 ──► P1R ──► P2 ──► P3 ──► P4 ─┘──► P5 ┄┄► P6       │
                       (P1 ✗)         └─────────────────────────────────┘
```

G1 is **not** a prerequisite for P0–P3; only P4 needs it. Run G1 whenever convenient before P4.
G2 requires P2 to have shipped. **P6 is optional and dashed**: the migration is complete and
shippable at P5 without it.

**P1 is struck through, not deleted.** It was executed, deployed and closed before D5 revised the
strategy; its handoff notes (§7) stay as the record of what was built and are P6's starting point.

| Stage | Repo | Bead | Depends on |
|---|---|---|---|
| G1 | GAS-Core | `GAS-Core-32e` (P1) | — |
| P0 | PracticeMix | `atc-h8j` (P1) | — |
| ~~P1~~ | PracticeMix | ~~`atc-7o9`, `GAS-Core-4aa`~~ | *superseded by D5 — see P6* |
| P1R | PracticeMix | `atc-b0o` (P1) | P0 |
| P2 | PracticeMix | `atc-4vr` (P1) | **P1R** |
| P3 | PracticeMix | `atc-hv0` (P1) | P2 |
| P4 | PracticeMix | `atc-pjs` (P2) | P3, G1 |
| P5 | PracticeMix | `atc-mta` (P2) | P4 |
| P6 *(optional)* | PracticeMix | `atc-t6w` (P3), `atc-flg` (P1) | P5 |
| G2 | GAS-Core | `GAS-Core-e5z` (P2) | P2 |

`GAS-Core-vo3` (P1) is the cross-repo tracking record for P0/P2–P5; close it when P5 closes — P6
does not hold it open.

---

## 5. Stages

Every stage below follows the same contract. Read §6 before starting any of them.

### G1 — extract `packages/gas-static`  *(GAS-Core, bead `GAS-Core-32e`)*

Extract one package from the three existing copies — F3Go30's `tools/build-static-pages.js` (202
lines) + `publish-static-pages.js` (123) + `wait-for-static-deploy.js` (140), RCV's pair (161+136),
GActionSheet's `scripts/build-static-portal.js` (179) + `publish-static-portal.js` (133). Mirror
`packages/gas-deploy`'s shape exactly: `index.js`, `lib/`, `bin/`, `test/` with `node --test`.

Take the best answer from each copy, per RECOMMENDATION §3.1:
- placeholder stamping, **missing placeholder = hard failure** (all three already do this);
- per-env `dist/`, asset tree copy, `version.json` companion;
- the `deployTarget ↔ static env` mapping as **declared config**, not a per-project constant;
- `webappUrl: { from: 'buildInfo', … }` with GActionSheet's **env-agreement assertion** — the guard
  that only one copy has, and the one that prevents publishing a page pointed at last deploy's URL;
- publish: refuse a non-git path, `git add` **scoped to `dest`** (an unscoped add publishes another
  app's half-finished work out of a shared host repo), version-stamped commit message;
- one policy for the two divergences: **missing repo path ⇒ warn and skip** (GActionSheet's
  posture), **prompt before a cross-repo push unless chained or `--yes`**;
- `assertPublishedBuild(env, version)` polling `version.json`, with the same interval/timeout config
  shape as `gas-deploy`'s `verifyOptions`.

Do **not** convert F3Go30, RCV or GActionSheet in this stage. One consumer (P4) proves the package;
converting three at once repeats the mistake of designing an interface with no user.

**AC**
- [x] `packages/gas-static/` exists with `runStatic()` matching the config shape in RECOMMENDATION §3.1.
- [x] `node --test packages/gas-static/test/*.test.js` passes; coverage includes: missing placeholder throws; env-agreement mismatch throws and writes nothing; missing repo path warns and exits 0; `git add` argument is scoped to `dest`; `assertPublishedBuild` succeeds on a matching `version.json`, times out on a stale one.
- [x] `version.json` is written as `{version, env, webappUrl, builtAt}` and is the only thing `assertPublishedBuild` reads.
- [x] `packages/gas-static/README.md` documents the config surface and the invariants, in the style of `packages/gas-deploy/README.md`.
- [x] No behaviour is added that no surveyed copy had (no bundler, no framework, no page templating — the package owns the pipeline, never the page).

**Handoff notes must record:** the exact `runStatic()` config keys and their defaults, so P4 writes
its config without re-reading the package source; which of the three copies each behaviour came
from; anything deliberately dropped.

---

### P0 — cross-origin `cmd=api` spike  *(PracticeMix, bead `atc-h8j`)*

Before porting anything, prove the transport. Add a `cmd=api` branch to `doPost` in `src/Code.js`,
ahead of the admin gate and beside the existing `cmd=version` route, dispatching a small action map
— start with `listFilesAndFolders` only. Respond with `ContentService` JSON. Serve
`tests/fixtures/spike.html` from `127.0.0.1` via the existing Playwright harness and POST to the
live TEST deployment with `Content-Type: text/plain` (this keeps the request CORS-simple; Apps
Script has no useful `OPTIONS` handler).

Expect this to return a Google sign-in page while the manifest is still `access: ANYONE` — that is
the *expected* result at this stage and the spec must say so by name. The spike's job is to
establish the route, the payload shape and the named diagnostic; P2 is what makes it return JSON.

**AC**
- [x] `doPost` routes `cmd=api` to an action dispatcher; unknown actions return `{ok:false,error:'unknown_action'}`; the route is reachable without `adminSecret`.
- [x] A Playwright spec serves a page from `127.0.0.1`, POSTs `text/plain` JSON to live TEST, and asserts on the response.
- [x] The non-JSON path produces a *named* diagnostic distinguishing "deployment mid-propagation" from "you got a Google sign-in page" — both are real, frequent, and otherwise unreadable.
- [x] `pnpm run test:unit` covers the dispatcher's routing and unknown-action branches with no network.
- [x] Nothing in `src/` outside `doPost` and the new dispatcher changes.

**Handoff notes must record:** the request/response envelope actually used (field names, error
shape), the live TEST behaviour observed, and the exact spec path so P1 can extend it.

---

### ~~P1 — identity gate on the Drive routes~~  *(SUPERSEDED by D5 — executed, then deferred to P6)*

> **Do not execute this stage.** It was built, deployed to TEST and closed on 2026-08-22; D5 then
> deferred visitor identity to optional stage **P6**, which inherits this spec and these AC
> verbatim. The text below is kept unchanged as P6's specification and as the record of what
> `src/Identity.js` already does. The current step is **P1R**, immediately after it.

**This is the security stage. It concentrates all the risk of the migration.** Read D3 above before
starting.

Copy `verifyGoogleIdToken_` / `isSubAllowlisted_` from
`GAS-Core/best-practices/gas-static-frontend/gas-backend-example.js` into a new
`src/Identity.js`; adapt, do not redesign. Verify against Google's `tokeninfo`, checking `aud`
against this project's own OAuth client ID, `iss`, and `exp`. Cache a successful verification in
`CacheService` keyed by a hash of the token for the token's remaining life.

Gate, default-deny: `getOAuthToken`, `getFileAsBase64`, `getFileDownloadInfo`, and
`listFilesAndFolders`. Per D2, the allowlist Script Property is empty by default (= any verified
identity) and non-empty means that list only. Log the verified email on every privileged call —
that is ADR-0002's suspended audit goal, restored.

`cmd=version` stays ahead of every gate and stays secret-free. `cmd=admin` keeps its existing
`ADMIN_SHARED_SECRET` gate untouched: the operator secret and visitor identity are two orthogonal
axes (`gas-deployment/RECOMMENDATION-declared-config.md` §2) and this stage touches only the second.

Deploy to TEST at the end of this stage. P2 must not begin against an undeployed gate.

**AC**
- [ ] Unauthenticated `cmd=api getOAuthToken` returns denied; likewise `getFileAsBase64`, `getFileDownloadInfo`, `listFilesAndFolders`.
- [ ] A token failing `aud`, failing `iss`, or expired returns denied — one test each, all fail-closed.
- [ ] With a non-empty allowlist, a verified but unlisted `sub` returns denied; a listed one succeeds.
- [ ] With an empty allowlist, any verified identity succeeds and its email appears in the log.
- [ ] A `tokeninfo` outage returns denied, never allowed — assert this explicitly.
- [ ] `cmd=version` still answers with no token and no secret; `cmd=admin` still answers only with the correct `adminSecret`.
- [ ] Unit tests cover every branch above with the network stubbed; the gate is deployed to TEST and one denial is confirmed against the live deployment.

**Handoff notes must record:** the OAuth client ID used and where it is configured, the allowlist
property name and its current value, the exact denial response shape, and confirmation that the
gate is live on TEST — P2 depends on all four.

---

### P1R — open the API, retire the raw-token routes  *(PracticeMix, bead `atc-b0o`)*

The stage D5 substitutes for P1. Its job is to satisfy D3's invariant **without** requiring anyone
to sign in, so P2 can flip the manifest against an app that is deliberately open.

Two changes, and nothing else:

1. **Delete `getOAuthToken` and `getFileDownloadInfo` outright — the server functions, not just
   the `cmd=api` actions.** Removing them from the action map alone is *not enough*: they are also
   reachable via `google.script.run` from the `HtmlService` page, which stays live through the P2–P5
   dual-run. Once P2 sets `ANYONE_ANONYMOUS`, an anonymous visitor loading that page could invoke
   them directly and D3's invariant would lapse through a second door. So the functions go from
   `src/Code.js`, their `cmd=api` entries go from `src/Api.js`, and the `getDriveToken()` client
   call goes from `src/ui.js.html`, which falls back to the base64 path it already has. These
   are the only two routes that hand `ScriptApp.getOAuthToken()` to the caller, and per D3 that
   token is full-Drive on the owner's account. They are a **performance optimisation only**:
   `src/ui.js.html:604` `loadTrackFile()` already falls back to `getFileAsBase64` on any failure,
   and that fallback path is complete and in daily use. Removing them costs load time — the
   base64 round-trip through the server instead of a direct browser fetch — and breaks nothing.
   All Drive access continues to happen **server-side, running as the deployer**, which is the
   execution model the app already uses and which D5 keeps unchanged.
2. **Make the identity gate dormant, not deleted.** Introduce a single `IDENTITY_REQUIRED_` switch
   in `src/Api.js`, set to `false`. When `false`, `apiDispatch_` dispatches without consulting
   `ctx.requireIdentity`; when `true`, P1's behaviour returns exactly as specified above.
   `src/Identity.js` and `tests/unit/identity.test.js` stay in the tree untouched. P6 is one line.

`executeAs: USER_DEPLOYING` does not change. `cmd=version` and `cmd=admin` do not change.

**AC**
- [x] `getOAuthToken` and `getFileDownloadInfo` are absent from `PRIVILEGED_ACTIONS_` and from the dispatcher; calling either over `cmd=api` returns `unknown_action`.
- [x] Both server functions are **gone from `src/Code.js`**, and `grep -rn 'getOAuthToken\|getFileDownloadInfo' src/` returns nothing outside comments — closing the `google.script.run` door before P2 opens the app.
- [x] No response from any `cmd=api` action contains an OAuth token — assert on the live TEST responses, not only in unit tests.
- [x] With `IDENTITY_REQUIRED_ = false`, `listFilesAndFolders` and `getFileAsBase64` succeed over `cmd=api` with **no** `idToken` in the request.
- [x] With `IDENTITY_REQUIRED_ = true`, every P1 denial test still passes unchanged — the dormant gate is provably still wired, not rotted.
- [x] `tests/unit/identity.test.js` is untouched and still green.
- [x] The `HtmlService` front end still loads and plays a track through the base64 path (the `getOAuthToken` client call in `src/ui.js.html` must stop being issued, or its failure must remain non-fatal).
- [x] `cmd=version` still answers with no token and no secret; `cmd=admin` still answers only with the correct `adminSecret`.
- [x] Deployed to TEST, with the open (no-`idToken`) call confirmed working against the live deployment.

**Handoff notes must record:** the observed load-time difference on the base64 path versus the
direct-fetch path it replaces (P5's first-paint comparison needs it, and it is the number that
tells us whether P6 should restore a *gated* direct fetch), confirmation that no live response
carries a token, and the exact state `IDENTITY_REQUIRED_` was left in.

---

### P2 — flip the manifest, retire the Playwright transport  *(PracticeMix, bead `atc-4vr`)*

Only after **P1R** is deployed and verified (D5 replaced P1 with P1R here). Set
`src/appsscript.json` `webapp.access` to `ANYONE_ANONYMOUS`, deploy, and confirm from a genuinely
anonymous caller that the app works **and** that D3's invariant holds — no route returns an OAuth
token.

Then collapse the tooling: `tools/call-webapp.js` (215 lines, carrying a Playwright
`sessionContext_`/`postSession`/`versionPostFn` transport) becomes a ~20-line wrapper over
`gas-deploy`'s `bin/call-webapp.js`, configured with this project's `envMap`, `authField`,
`securedCmds` — cf. NUUC-Dispatch's. Delete `authenticate.js`, `test-auth.js`, the `auth` and
`auth:clear` scripts, and the `.auth/` dependency **of the admin path**. The UI test suite's own
session fixtures are a separate question; leave them alone in this stage.

**AC**
- [x] `src/appsscript.json` is `"access": "ANYONE_ANONYMOUS"`, `"executeAs": "USER_DEPLOYING"` unchanged, and the deployment is live on TEST.
- [x] `node tools/call-webapp.js version --env test` returns JSON with no browser and no captured session.
- [x] `pnpm run deploy:test` completes including `assertDeployedVersion`, with no session present.
- [x] No `postFn` is passed to `gas-deploy` from this project.
- [x] `authenticate.js`, `test-auth.js` and the `auth`/`auth:clear` package scripts are gone; nothing in the repo still references them.
- [x] From a genuinely anonymous caller against live TEST: `listFilesAndFolders` and `getFileAsBase64` succeed, and **no response from any route contains an OAuth token** — **this is the AC that matters most in the whole plan.** Quote the responses.
- [x] `getOAuthToken` and `getFileDownloadInfo` return `unknown_action` anonymously, confirming P1R's removal survived the flip.

**Handoff notes must record:** confirmation of the anonymous denial re-run (quote the responses),
the final wrapper's line count and config, and anything `.auth/` is still needed for.

---

### P3 — port the page  *(PracticeMix, bead `atc-hv0`)*

Hand-port `src/index.html` and the seven includes into `static-pages/src/index.html` — one
self-contained hand-written file, no framework, no bundler. **DOM ids and classes verbatim**, so the
existing Playwright locators in `tests/1-…` through `tests/9-…` carry over unchanged; that
constraint is what makes this stage verifiable at all.

Replace the remaining `google.script.run` call sites with a single `callApi()` helper POSTing
`text/plain` to `cmd=api`. **Per D5 there is no sign-in flow and no ID token** — `callApi()` posts
`{action, ...args}` and nothing else. Leave a single obvious seam where P6 can add the token, and
build the four visitor states (signed-out, in-flight, signed-in, denied) *only* if it costs
nothing to stub them; P6 owns them otherwise.
Use build-time placeholders (`var STATIC_BUILD_VERSION_ = null;`,
`var STATIC_WEBAPP_URL_ = null;`, `var STATIC_ENV_LABEL_ = null;`) rather than a config file, so the
unbuilt source still runs directly from a local server.

Now claim what the sandbox never allowed: set `document.title` and a favicon client-side, and use
`history.replaceState` for folder deep links. Do **not** implement the full URL-state contract here
— `atc-es8`/`atc-z49`/`atc-7k0`/`atc-ex0` own that and are now unblocked; this stage only proves the
capability exists.

**AC**
- [x] `static-pages/src/index.html` runs from a local server against live TEST, unbuilt.
- [x] The existing UI specs pass against the static page (record which specs, and any that needed a locator change — each such change is a defect in the port unless justified).
- [x] Every remaining RPC call site goes through one `callApi()`; no `google.script.run` remains in the static source.
- [x] `callApi()` sends no `idToken` and the page has no sign-in UI — D5's deferral is visible in the code, not just the plan.
- [x] `document.title` and the favicon are set client-side; a folder navigation is visible in the address bar.
- [x] A failed or denied `callApi()` response renders an explicit error state — never a blank page.
- [x] The `HtmlService` page still works, untouched — P5 retires it, not this stage.

**Handoff notes must record:** the placeholder names stamped, any locator changes and why, which
specs were run and their result, and the local-server command used.

---

### P4 — adopt `gas-static`  *(PracticeMix, bead `atc-pjs`; needs G1)*

Add `gas-static` as a git-subdirectory dependency in the same form as `gas-deploy`
(`github:stuartdonaldson/GAS-Core#gas-static-v1.0.0&path:/packages/gas-static`). Write
`tools/static-pages.js` from G1's handoff notes. Publish into `pub/pmix` on the existing
`Static` repo (D4), reached through a new `staticRepoPath` key in `local.settings.json` — the
canonical name from `gas-deployment/RECOMMENDATION-declared-config.md` §5, not a project-specific
spelling. Chain build → publish → `assertPublishedBuild` as **required** `postDeploy` steps of the
existing `manage-deployments.js` pipeline.

**AC**
- [x] `pnpm run deploy:test` runs build → publish → `assertPublishedBuild` and **fails** if the CDN is not yet serving the new build.
- [x] The live `version.json` carries `{version, env, webappUrl, builtAt}` with `webappUrl` equal to the deployment just deployed, and `env` matching the target.
- [x] Deliberately publishing a stale build makes the deploy fail — demonstrate it once.
- [x] `local.settings.json` gains `staticRepoPath` and no other new key; `local.settings.example.json` is updated to match.
- [x] The publish `git add` is scoped to `pub/pmix` — verify nothing else in `Static` is ever staged.

**Handoff notes must record:** the live URLs for both envs, the `staticRepoPath` value expected, and
the observed propagation delay (it sets a realistic `assertPublishedBuild` timeout).

---

### P5 — dual-run, then retire the `HtmlService` page  *(PracticeMix, bead `atc-mta`)*  ← **current step — dual-run half done, retirement pending the criterion in §7**

Keep `doGet`'s page live and regression-tested beside the static page for one release cycle, then
remove it and its includes. Retiring turns `doGet` into `cmd=version` plus a redirect to the static
URL.

**AC**
- [x] One suite runs the shared specs against both front ends — `pnpm run test:dual`. *Not green:
      `R1` (`atc-6bw`) and `A1` (`atc-fvv`) fail, **identically on both**, and are pre-existing bugs
      with their own beads. Parity, not a green bar, is the evidence — the user's call, §6.4.*
- [x] A retirement criterion (date or usage signal) is recorded in `docs/` and in the bead.
- [ ] After retirement: `doGet` serves only `cmd=version` and the redirect; the seven `.js.html`
      includes and `include()` are deleted; `pnpm run deploy:test` still passes. *Deferred — the
      release cycle has not run; PROD has never been deployed.*
- [ ] `GAS-Core-vo3` is closed with a pointer to this plan. *Deferred with the above.*

**Handoff notes must record:** what was retired, what was kept and why, and the measured first-paint
before/after — the number that justified the whole plan.

---

### P6 *(optional)* — re-activate the identity gate  *(PracticeMix, beads `atc-t6w` + `atc-flg`)*

Optional, and explicitly **not** required for the migration to be complete: P5 closes the plan.
Run this when there is a reason to — a request to restrict access to the choir, or a wish to
restore ADR-0002's per-user audit trail.

Nearly all of this stage is already built and tested (see P1's spec above and its §7 handoff
notes). What remains:

- Register a Web OAuth client in this script's GCP project and set the `GIS_CLIENT_ID` script
  property on TEST and PROD — bead `atc-flg`. Until this exists the gate denies everyone, by
  design, so it must precede the flip.
- Add the GIS sign-in flow to the static page (P3 deliberately did not; the states it needs —
  signed-out, in-flight, signed-in, denied — are specified in P3's AC).
- Have `callApi()` carry the ID token.
- Flip `IDENTITY_REQUIRED_` to `true`.
- Decide whether to restore a *gated* `getFileDownloadInfo` for the direct-fetch speed path P1R
  removed. P1R's measured load-time delta is the input to that call; if base64 is fast enough,
  leave it removed and keep D3 satisfied by removal as well as by gating — belt and braces.

**AC** — P1's AC above, unchanged, plus:
- [ ] `GIS_CLIENT_ID` is set on both envs and a real sign-in succeeds end to end from the static page.
- [ ] The allowlist property is empty (D2), and a verified visitor's email appears in the log.
- [ ] A signed-out visitor sees the sign-in state, never a blank page or a raw denial.
- [ ] If the direct-fetch route is restored, an unauthenticated call to it returns denied against live TEST.

**Handoff notes must record:** the client ID and where it is registered, whether the direct-fetch
route was restored, and the sign-in success rate observed with real choir members.

---

### G2 — retire the `postFn` override  *(GAS-Core, bead `GAS-Core-e5z`; needs P2)*

`postFn` exists in `lib/webapp.js` `call()` and `bin/call-webapp.js`'s config surface for exactly
one consumer, and its own comment says so. Once P2 has shipped, remove it, and update
`best-practices/gas-static-frontend/RECOMMENDATION.md` (R10 → done) and
`best-practices/gas-static-frontend/README.md` to record PracticeMix as an adopter and D1 as the
worked single-app identity case.

**AC**
- [ ] `postFn` is gone from `lib/webapp.js`, `bin/call-webapp.js` and `packages/gas-deploy/README.md`.
- [ ] `grep -r postFn ~/proj` finds no consumer.
- [ ] `node --test packages/gas-deploy/test/*.test.js` passes.
- [ ] R10 marked done in the recommendation; the static-frontend README lists PracticeMix.

**Handoff notes must record:** the gas-deploy version bump, and whether any consumer needs re-pinning.

---

## 6. Stage contract — applies to every stage above

1. **Claim the bead first**, in the repo the stage runs in (`bd update <id> --claim`). Both repos
   use beads; do not use TodoWrite or markdown checklists for task tracking.
2. **Invoke the `implementation-gate` skill** before writing implementation code. AC are already
   frozen above — read them, state "done" in one sentence, and declare the ATDD phase.
3. **Tests before the change.** In red phase, do not read implementation files.
4. **Do not widen the stage.** Each stage's AC is its whole deliverable. If you find adjacent work,
   file a bead; do not fold it in. The one thing that must never be reordered is D3: P1 deployed
   before P2.
5. **Run the quality gates named in the AC** and paste the real output. A stage is done when its AC
   pass, not when the code looks right.
6. **Write handoff notes** into the bead (`bd update <id> --notes=…`) *and* as a short section
   appended to this file under §7, before closing. The next stage starts by reading them; a stage
   that closes without them has not finished. Each stage above names what its notes must contain.
7. **Do not commit or push without explicit authority** from the user (conservative profile).
   Report what changed and what the commit would be.
8. **If a stage is blocked**, record the blocker in the bead, finish everything in the stage that is
   not blocked, and say plainly what was left out.

## 7. Handoff notes

*(appended by each stage as it closes — newest last)*

### G1 — extract `packages/gas-static` (closed 2026-08-22)

`packages/gas-static/` created: `index.js`, `lib/{stamp,buildInfo,build,publish,assert}.js`,
`test/{build,publish,assert}.test.js` (14 tests, `node --test packages/gas-static/test/*.test.js`
green), `package.json`, `README.md`. No CLI/`bin/` — the AC didn't require one and P4 drives it
directly via `runStatic()`'s returned object, mirroring the `pipeline.build/publish/
assertPublishedBuild` shape shown in the README.

**`runStatic()` config keys and defaults** (full detail in `packages/gas-static/README.md` —
this is the condensed version so P4 doesn't have to re-read the package source):

| key | required | default |
|---|---|---|
| `root` | yes | — |
| `srcDir` / `distDir` | yes | — |
| `stampedPages` | no | every `.html` at `srcDir`'s own root |
| `copyAssets` | no | `true` |
| `webappUrl` | yes | `{ from: 'buildInfo', file, envField }` — `envField` defaults to `'env'`; `from` must be `'buildInfo'`, nothing else is implemented |
| `placeholders` | no | `{}` — `{ TOKEN: (ctx) => value }`, raw-token substitution (NOT wrapped in a `var … = null;` declaration — that wrapping is reserved for the two standard placeholders below) |
| `envs` | yes | `{ envKey: { deployTarget, repoKey, dest, label } }` |
| `liveUrl` | yes (for `assertPublishedBuild`) | `(env) => string`, trailing slash optional |
| `settingsPath` | no | `<root>/local.settings.json` |
| `commitMessage` | no | `` `Publish static <env> (<label>)` `` |

Standard placeholders (always stamped, present in all three surveyed copies):
`var STATIC_BUILD_VERSION_ = null;` and `var STATIC_WEBAPP_URL_ = null;`.

Returned object: `{ config, build(envKey), publish(envKey, options), assertPublishedBuild(envKey, expectedVersion, options) }`.
`publish` options: `{ yes, chained, confirmFn, log, warn, exec }`. `assertPublishedBuild` options:
`{ intervalSec: 5, timeoutSec: 60, fetchJson, sleep, log }` — same shape as `gas-deploy`'s
`verifyOptions`.

**Provenance — which copy each behaviour came from:**
- Standard placeholder stamping + missing-placeholder-throws: all three (F3Go30, RCV,
  GActionSheet) — kept, but changed to stamp all pages into memory first and write only after
  every page succeeds (none of the three did this; a two-page project would previously leave
  page 1 written on page 2's failure — not itself an AC item, but the "writes nothing" AC for
  env-agreement forced the same discipline for placeholders too, so it was applied uniformly).
- `deployTarget ↔ static env` mapping as declared config (`envs`): generalized from RCV's
  `DEPLOYMENT_ID_KEY`/`THEME` per-env object pattern and GActionSheet's `ENV_MAP`.
- `webappUrl: { from: 'buildInfo' }` + env-agreement assertion: GActionSheet's
  `readBuildInfo_`/`ENV_MAP.buildInfoEnv` check — the only copy that had it. F3Go30/RCV's
  deployment-ID-lookup `from` mode (resolving `/exec` from a `local.settings.json` deployment ID
  directly, no BUILD_INFO round trip) was **not** ported — `webappUrl.from` only supports
  `'buildInfo'` today; RECOMMENDATION §3.1's example only shows `'buildInfo'` too, and PracticeMix
  (the one consumer, P4) uses BUILD_INFO. Extending `from` to a second mode is future work if a
  second consumer needs it — do not add speculatively.
- Publish: scoped `git add`/`git status` — RCV's and GActionSheet's comment (both explain the
  same "unscoped add publishes another app's half-finished work" reasoning). Missing-repo-path =
  warn-and-skip — GActionSheet's posture (`publish-static-portal.js`), not F3Go30/RCV's
  hard-`process.exit(1)`. Confirm-before-cross-repo-push — GActionSheet's `confirm()`/`--yes`
  pattern, generalized to an injected `confirmFn` (the package has no UI dependency; the consumer
  wires `@inquirer/prompts` or similar) plus a `chained` flag for pipeline invocation.
- `assertPublishedBuild`: new — none of the three copies read `version.json` back
  (RCV's own comment: "not currently read back"). Modeled directly on `gas-deploy`'s
  `assertDeployedVersion` (same poll/timeout/inject shape) but polls the static CDN's
  `version.json` instead of a `cmd=version` webapp route.

**Deliberately dropped / not ported:**
- F3Go30's CSP meta-tag generation (`buildCspMeta_`/`collectScriptHashes_`/`insertCsp_`) — page-
  content concern specific to F3Go30's `docs/pwa-design.md`, not a pipeline concern; "the package
  owns the pipeline, never the page" (RECOMMENDATION §4). Stays in F3Go30 if/when it converts.
- RCV's `devContactFromVersionJs_`/theme-fonts stamping and GActionSheet's `doc.html`
  multi-page-per-env specifics — both are expressible today through the generic `placeholders`
  config and `stampedPages` list without any package change; not hardcoded into the package.
- `static-urls.js` generalisation (R9) — explicitly out of scope per PMIX-PLAN §2.
- F3Go30's `wait-for-static-deploy.js` STATIC_BUILD_VERSION_-regex polling and RCV's
  `smokeTestStaticApi.js` step 11 — both are superseded by `assertPublishedBuild` reading
  `version.json`, not ported as separate mechanisms.
- No `bin/` CLI wrapper (unlike `gas-deploy`'s `bin/call-webapp.js`) — no AC required one, and
  P4's `tools/static-pages.js` calls `runStatic()`'s returned object directly (see README usage
  example) the same way `gas-deploy` consumers write `tools/manage-deployments.js`.

F3Go30, RCV and GActionSheet themselves were **not** converted (out of scope for this stage —
P4 is the one consumer that proves the package; converting three at once was the mistake this
stage explicitly avoids repeating, per PMIX-PLAN §5 G1).

Not committed/pushed yet — stage contract §6.7 requires explicit authority first.

---

### P0 — cross-origin `cmd=api` spike (closed 2026-08-22)

**Request/response envelope used:** POST body is `text/plain` (CORS-simple, avoids a preflight
Apps Script cannot answer), containing JSON `{ action, ...args }` — e.g.
`{ action: 'listFilesAndFolders', folderId, folderPath }`. Route is `?cmd=api` on the existing
`/exec` URL, dispatched in `src/Code.js` `doPost` ahead of `cmd=admin`, beside `cmd=version`.
Response body is always JSON: `{ ok: true, result: <listFilesAndFolders's return> }` on success,
`{ ok: false, error: 'unknown_action' }` for an unrecognized `action`, `{ ok: false, error:
'invalid_json' }` for an unparseable body. Shape matches `src/Admin.js`'s existing `{ok, error}`
convention exactly — same pure-dispatcher-plus-injected-`ctx` design (`apiDispatch_` in the new
`src/Api.js`, `makeApiContext_`, `handleApiPost_`), same node-export-under-`typeof module` guard
for off-platform unit testing.

**Live TEST behaviour observed — this is the finding that matters most from this stage:** the
plan's own text ("Expect this to return a Google sign-in page") described the *cause* correctly
but not the *symptom* a browser actually produces. A cross-origin `fetch()` from `127.0.0.1` to the
live `/exec` URL does not resolve with a readable sign-in HTML body — it **rejects outright**
(`TypeError: Failed to fetch`) because Google's access-denied response for this route carries no
`Access-Control-Allow-Origin` header, so the browser's own CORS check blocks it before any body is
readable. Fetching the identical URL from Node (no CORS enforcement there) shows the real content:
**HTTP 401**, body `<title>Page Not Found</title>` — a generic Google error wrapper, not literal
sign-in markup. Consequently the spec's diagnostic (`classifyApiResponse` in
`tests/0-api-spike.spec.js`) classifies by **HTTP status** (401/403 ⇒ `google_signin`; anything
else non-JSON ⇒ `deployment_propagating`), not by body-text matching — text matching on
"accounts.google.com" or "sign in" would never fire against this actual body. When the in-browser
fetch itself throws (the expected case today), the spec falls back to the same Node-side raw POST
purely to produce a readable diagnostic message; this is why `0-api-spike.spec.js` makes *two*
requests per run, not one.

Ran against live TEST (`AKfycbx6AZF5KKUi9HXM9oS2mMD0jtV25k5Fs21JqSSBM_v4U9Z8caHmMazdwhXyMD-4Agak`):
**PASS** — browser fetch CORS-blocked as expected, Node-side raw POST confirmed HTTP 401, spec
asserts `kind === 'google_signin'` and is green. `pnpm run test:unit`: 79/79 pass, including the 6
new `tests/unit/api.test.js` cases covering `apiDispatch_`'s routing (`listFilesAndFolders` →
`ctx.listFilesAndFolders`) and its `unknown_action` fallback (missing action, unrecognized action,
`undefined` payload), no network involved.

**Exact spec path:** `tests/0-api-spike.spec.js`, fixture at `tests/fixtures/spike.html` (served
from a random `127.0.0.1` port via a plain `node:http` server started/stopped inside the test —
no prior fixture-serving pattern existed in this repo to reuse).

**Files touched:** `src/Api.js` (new — `apiDispatch_`, `makeApiContext_`, `handleApiPost_`),
`src/Code.js` (`doPost` gains one `cmd === 'api'` branch ahead of `cmd === 'admin'`, plus a
docstring update — nothing else in `src/` changed), `tests/unit/api.test.js` (new),
`tests/0-api-spike.spec.js` (new), `tests/fixtures/spike.html` (new).

**P1 should know:** the identity gate (P1) sits *inside* `apiDispatch_`'s action handlers (or as a
check `apiDispatch_` runs before dispatching to a privileged action) — P0 deliberately left every
action ungated per its own scope. The `{ok, error}` response shape and the `text/plain`-carrying-JSON
transport are both already proven live; P1 does not need to re-decide either.

---

### P1 — identity gate on the Drive routes (closed 2026-08-22; **superseded by D5 the same day**)

> Kept verbatim as the record of what was built and as P6's starting point. Everything below
> is still accurate about `src/Identity.js`; what changed is only *when* it is switched on.
> Stage **P1R** made the gate dormant (`IDENTITY_REQUIRED_ = false`) and removed the two
> raw-token routes, satisfying D3's invariant without sign-in.

**Deployed and verified on live TEST — P2 is unblocked.** TEST v1.6.7.5, revision @197,
deployment `AKfycbx6AZF5KKUi9HXM9oS2mMD0jtV25k5Fs21JqSSBM_v4U9Z8caHmMazdwhXyMD-4Agak`.

**OAuth client ID — where it is configured, and its current value:** Script Property
**`GIS_CLIENT_ID`** (name kept identical to `gas-backend-example.js`'s
`GIS_CLIENT_ID_PROPERTY_`). It is **currently unset**, and P1 deliberately did not set it: no
client signs in until P3 adds the GIS flow, and an unset client ID **fails closed** —
`verifyGoogleIdToken_` returns `no_client_id` before any network call, so every identity is
denied. That is the correct posture for the window between P1 and P3, but it means
**P3 cannot sign anyone in until a real Web OAuth client is registered in this script's GCP
project and stored on both TEST and PROD.** Filed as bead **`atc-flg` (P1)**, and `atc-hv0` (P3)
now depends on it.

**Allowlist property and its current value:** Script Property **`GIS_ALLOWLIST_SUBS`**,
**unset/empty** — which per D2 means *any verified Google identity*, matching today's effective
`access: ANYONE` openness. Non-empty means that list only; the value is split on commas and
whitespace. Tightening is a property edit, not a code change. Note this **inverts** the
`gas-backend-example.js` semantics (empty = nobody there); the divergence is D2 and is documented
in `src/Identity.js`'s module comment so a future reader does not "fix" it back.

**Exact denial response shape:** `{"ok":false,"error":"denied"}` — one opaque envelope for every
denial reason, with **no** `reason` field on the wire. The reason (`no_token`, `no_client_id`,
`tokeninfo_unavailable`, `tokeninfo_error`, `bad_aud`, `bad_iss`, `expired`, `no_sub`,
`not_allowlisted`) is logged server-side via GasLogger under `identity.denied` for the operator.
A unit test asserts the denial object's key set is exactly `{ok, error}`, so a future change
cannot leak a reason back to the caller by accident. Unknown actions keep P0's
`{"ok":false,"error":"unknown_action"}` and are rejected **before** the gate is consulted — there
is no point verifying a token for an action that does not exist, and it keeps P0's AC intact.

**Files:** `src/Identity.js` (new — `verifyGoogleIdToken_`, `isSubAllowlisted_`,
`requireIdentity_`, `makeIdentityContext_`, plus `readVerifiedFromCache_`/`writeVerifiedToCache_`),
`src/Api.js` (gate + the three actions P0 had not yet added), `tests/unit/identity.test.js` (new,
26 tests), `tests/unit/api.test.js` (extended to 18). `src/Code.js` unchanged — `doPost`'s
`cmd=version` → `cmd=api` → `cmd=admin` ordering from P0 already satisfies P1.

**Gated actions:** all four, declared in `PRIVILEGED_ACTIONS_` and asserted by a test, so adding a
fifth action without deciding its privilege is a test failure rather than a silent hole. P0 shipped
only `listFilesAndFolders`; `getFileAsBase64(fileId)`, `getFileDownloadInfo(fileId)` and
`getOAuthToken()` were added here **already gated** — they were never reachable ungated.
`apiDispatch_` also denies when `ctx.requireIdentity` is absent, so a misconfigured context cannot
dispatch.

**Caching (D1's mitigation):** a *successful* verification only, in `CacheService` under
`idtok:<SHA-256(token)>`, TTL = the token's remaining life (capped at CacheService's 6 h; a Google
ID token lives ~1 h anyway). Denials are never cached. The expiry is re-checked on read, so a
best-effort TTL cannot keep a dead token alive. The raw token is never cached, keyed on, or logged
— all three asserted.

**Test evidence:** `pnpm run test:unit` **117/117 pass** (79 before this stage). Red was observed
first: 8/18 api gate tests failing and `identity.test.js` failing to load for want of
`src/Identity.js`.

**Live TEST confirmation (proven-transport probe, authenticated session, quoted verbatim):**

```
api getOAuthToken (no idToken)     -> 200 {"ok":false,"error":"denied"}
api getFileAsBase64 (no idToken)   -> 200 {"ok":false,"error":"denied"}
api getFileDownloadInfo (no idToken)-> 200 {"ok":false,"error":"denied"}
api listFilesAndFolders (no idToken)-> 200 {"ok":false,"error":"denied"}
api getOAuthToken (bad idToken)    -> 200 {"ok":false,"error":"denied"}
api dropEverything                 -> 200 {"ok":false,"error":"unknown_action"}
version (no token, no secret)      -> 200 {"ok":true,"version":"1.6.7.5",...,"target":"TEST",...}
admin status (no secret)           -> 200 {"ok":false,"error":"forbidden"}
admin status (wrong secret)        -> 200 {"ok":false,"error":"forbidden"}
```

**P2 must know this — it cost the whole diagnostic budget of this stage.** The environment sets
**`PLAYWRIGHT_AUTH_STATE=/home/stuar/.playwright/sdonaldson.json`**, and
`tools/call-webapp.js:authStatePath()` honours it. The in-repo `.auth/user.json` is *stale*
(dated 2026-07-27). A probe written against `.auth/user.json` returns **HTTP 401 with a Google
HTML body on every route, `cmd=version` included** — indistinguishable at a glance from "the gate
denied me", and it is what made the first two live runs above look like a total failure. If P2
sees a blanket 401, check the session file before suspecting the code. P2's inventory of "what
`.auth/` is still needed for" should record that the live session is **not** in `.auth/` at all;
the five files there are test-suite fixtures, and the admin/deploy path reads the env var.

**Not committed/pushed** — stage contract §6.7 requires explicit authority first. `src/` was
pushed to the TEST Apps Script project by `pnpm run deploy:test`, as the stage requires.

### P1R — open the API, retire the raw-token routes (closed 2026-08-22)

**Deployed and verified on live TEST — P2 is unblocked.** TEST v1.6.7.6, revision @198, same
deployment ID as P1. The app is now open: `cmd=api` answers with **no `idToken` at all**, and the
two routes that handed out the owner's Drive token no longer exist anywhere.

**`IDENTITY_REQUIRED_` was left `false`** — the shipped, open state, in `src/Api.js`. P6 flips it to
`true` and nothing else. `src/Identity.js` and `tests/unit/identity.test.js` are **byte-for-byte
untouched** by this stage and still green (26 tests), and `tests/unit/api.test.js` exercises *both*
modes, so the dormant path cannot rot unnoticed between now and P6.

**What was removed, and from where** — the `google.script.run` door mattered as much as the
`cmd=api` one, and the stage spec originally under-specified this:
- `src/Code.js` — `getOAuthToken()` and `getFileDownloadInfo()` **deleted**, replaced by a comment
  block explaining why they must not come back. This is the load-bearing removal: both were
  reachable via `google.script.run` from the `HtmlService` page, which stays live through the
  P2–P5 dual-run, so removing them from the action map alone would have left D3's invariant
  lapsing through a second door the moment P2 set `ANYONE_ANONYMOUS`.
- `src/Api.js` — `PRIVILEGED_ACTIONS_` is now exactly `['listFilesAndFolders', 'getFileAsBase64']`.
- `src/ui.js.html` — `getDriveToken()` deleted; `loadTrackFile()` now delegates straight to
  `loadTrackFileViaBase64()` (renamed from `loadTrackFileBase64Fallback` — it is no longer a
  fallback, it is the path). The stale-folder guard semantics are preserved: `state.folderToken` is
  still read synchronously at call time, before any `await`.

**Live TEST confirmation (quoted verbatim, after propagation settled):**

```
api listFilesAndFolders (NO idToken)   200 {"ok":true,"result":{"audio":[{"id":"1FvG3mr-...","name":"Love Knocks And Waits For Us to Hear - Piano Bass.mp3",...
api getOAuthToken (retired)            200 {"ok":false,"error":"unknown_action"}
api getFileDownloadInfo (retired)      200 {"ok":false,"error":"unknown_action"}
api getFileAsBase64 (NO idToken)       200 {"ok":true,"result":{...}}
version (no token, no secret)          200 {"ok":true,"version":"1.6.7.6",...,"target":"TEST",...}
admin status (no secret)               200 {"ok":false,"error":"forbidden"}
```

No response from any route carried an OAuth token; the probe greps every body for `ya29` and
`"token"` and reports a leak loudly.

**Propagation lag is real and will bite P4 — take this as the measured input to
`assertPublishedBuild`'s timeout.** The deploy's own `assertDeployedVersion` reported v1.6.7.6
verified, and the *very next* probe got `cmd=version` = **v1.6.7.5** while simultaneously answering
`unknown_action` (new code) for one action and `denied` (old code) for another — old and new
instances served concurrently, mid-request-set. It converged within roughly a minute and three
retries. P0's named diagnostic ("deployment mid-propagation") exists for exactly this; it is not
theoretical, and a single post-deploy assertion is not proof the whole fleet has turned over.

**Measured load cost of the base64 path** (live TEST, cold browser context, tracks in
`available` state before each click):

| file size | `getFileAsBase64` | decode | total | click→`loaded` |
|---|---|---|---|---|
| 0.24 MB | 2015 ms | 118 ms | 2133 ms | 3047 ms |
| 0.12 MB | 1613 ms | 149 ms | 1762 ms | 1977 ms |
| 0.09 MB | 1386 ms | 125 ms | 1511 ms | 2008 ms |

The server round-trip dominates completely; decode is ~120–150 ms throughout. Page + folder listing
ready was 6451 ms on a cold load.

**A gap this stage did not close, stated plainly:** the handoff was supposed to record the
*difference* between this path and the direct fetch it replaced. It records only this side. The
direct-fetch code was deleted before anyone measured it, and recovering the baseline now would mean
redeploying the previous revision. **P5 must capture the before/after first-paint number anyway, and
P6's "restore a gated direct fetch?" decision needs this delta** — so P5 should measure both paths
if it can, or the question stays open on judgement rather than data. Note also that these were
*small* files (≤0.24 MB); base64 inflates payloads ~33%, and `getFileAsBase64` hard-fails above
50 MB, so multi-megabyte choir tracks will be disproportionately worse than the table suggests.

**Test evidence:** `pnpm run test:unit` **121/121 pass** (117 before). Red observed first: 8/21
`api.test.js` tests failing. Playwright, run live against TEST:
`tests/4-playback-view.spec.js` **11 passed, 1 failed**; `tests/5-transport-state.spec.js` +
`tests/8-regression-cache-playback.spec.js` **11 passed, 1 failed**. The passing 22 include full
page load, track load through the base64 path, and playback — P1R's AC that the `HtmlService`
front end still works.

**Both failures were investigated to root cause and are NOT this stage's** — filed, not folded in:
- `atc-6bw` — R1 in `8-regression-cache-playback` is a **test defect**. It captures `trackBName`
  from the button's `textContent` *before* clicking, so the expected string carries the status
  badge (`"v1,3,4,ooo\n        ○ Available"`) while the playback view correctly shows
  `"v1,3,4,ooo"`. `.trim()` cannot strip an embedded newline, so the assertion can never pass.
  `toHaveCount(1)` passed and the right track is displayed — the behaviour under regression test
  is working.
- `atc-c1m` — P12 desktop layout: `meterGap` 429 against an expected < 120, identical across
  retries (so not timing). The meter renders hard right (x=1124) instead of beside the controls
  (which end at x=695). Mobile P11 and mid-width P17 pass. P1R changed only how audio bytes are
  fetched and touched no layout code.

**Test-infrastructure fix made along the way, because the AC could not be verified without it:**
`tests/4-playback-view.spec.js`, `5-transport-state.spec.js`, `6-speed-processing.spec.js` and
`screenshots.spec.js` hardcoded `../.auth/user.json`, while `playwright.config.js:10` and
`auth.setup.js:55` honour `PLAYWRIGHT_AUTH_STATE` — which **is set in this environment** and points
to `/home/stuar/.playwright/sdonaldson.json`. The in-repo file is stale (2026-07-27), so those four
specs silently authenticated as nobody and died in `getUserFrame()` with a 30 s
`"beforeAll" hook timeout` waiting for a `#userHtmlFrame` body that Apps Script was never going to
serve — a failure that looks nothing like an auth problem. All four now call a new
`authStatePath()` in `tests/test-utils.js`, resolving it exactly as the config does. **This is the
same trap that consumed most of P1's diagnostic budget**; it has now cost two stages, which is why
it was fixed rather than documented a third time.

**Not committed/pushed** — stage contract §6.7. `src/` was pushed to the TEST Apps Script project
by `pnpm run deploy:test`, as the stage requires.

---

### P2 — flip the manifest, retire the Playwright transport (closed 2026-08-23)

**Deployed and verified on live TEST — P3 and G2 are unblocked.** TEST v1.6.7.7, revision @199,
same deployment ID. `src/appsscript.json` is `"access": "ANYONE_ANONYMOUS"` with
`"executeAs": "USER_DEPLOYING"` unchanged, and the whole Playwright transport is gone from the
deploy/admin path.

**The AC that matters most, from a genuinely anonymous caller** — bare `https` POST via
gas-deploy's `lib/webapp.js`, no browser, no cookies, no session — quoted verbatim after
propagation settled:

```
api listFilesAndFolders (anonymous)     {"ok":true,"result":{"audio":[{"id":"1FvG3mr-Ew0iSMhaw-D1N4ZrIP0oVnTSn","name":"Love Knocks And Waits For Us to Hear - Piano Bass.mp3","mimeType":"audio/mpeg","size":248304,…
api getFileAsBase64 (anonymous)         {"ok":true,"result":{"error":"Error reading file: Invalid file or folder ID: nope"}}
api getOAuthToken (retired in P1R)      {"ok":false,"error":"unknown_action"}
api getFileDownloadInfo (retired)       {"ok":false,"error":"unknown_action"}
version (no secret)                     {"ok":true,"version":"1.6.7.7","versionDate":"2026-08-23T05:45:31.632Z","target":"TEST","deploymentId":"AKfycbx6AZF5KKUi9HXM9oS2mMD0jtV25k5Fs21JqSSBM_v4U9Z8caHmMazdwhXyMD-4Agak"}
admin status (no secret)                {"ok":false,"error":"forbidden"}
```

**No response from any route carried an OAuth token** — the probe greps every body for `ya29` and
`"token"` and reports a leak loudly; it reported none on every run. P1R's removal survived the
flip: both retired routes answer `unknown_action` *anonymously*, which is the specific thing D3
required before this stage could ship. `cmd=admin` still refuses without the secret even though
anyone can now reach it, so `ANYONE_ANONYMOUS` did not widen the admin surface.

A second anonymous probe ran the real end-to-end path, since a bad-file-id error proves only that
the route dispatches:

```
listFilesAndFolders → ok=true, 3 audio file(s)
getFileAsBase64 "Love Knocks And Waits For Us to Hear - Piano Bass.mp3" (242.48 KB)
  → ok=true, dataUri 331095 chars, 0.24 MB, audio/mpeg, 4013 ms
no OAuth token in the response
```

So an anonymous caller can list the choir folder and pull real audio bytes. That is the intended
posture per D5, not a defect.

**Red was observed live, not only in unit tests.** Before the flip the same probe got a Google
sign-in page (`<!DOCTYPE html>… ppConfig …`) on *every* route including `cmd=version` — which is
precisely the fact that forced the 215-line browser transport to exist. That is the before/after
worth keeping: the transport was never a preference, it was the only thing that reached `doPost`.

**Propagation race, again, and worse than P1R's.** The deploy's own `assertDeployedVersion`
reported v1.6.7.7 verified, and the very next anonymous probe got the *old* manifest
(sign-in page) on `listFilesAndFolders`, `version` and `admin` while simultaneously answering
`unknown_action` (new code, new manifest) on the two retired routes — old and new instances
serving concurrently, mid-request-set. It took roughly 90 s and three probe rounds to converge.
**Note that a manifest change propagates on the same lag as a code change**, and that
`assertDeployedVersion` passing is not evidence the ACL flip has landed fleet-wide. P4's
`assertPublishedBuild` timeout should assume ≥ 2 min, not P1R's ~1 min.

**The tooling collapse, concretely:**
- `tools/call-webapp.js` — **215 lines → 111** (61 non-comment). It is now config over
  `gas-deploy/bin/call-webapp.js` in NUUC-Dispatch's shape: `envMap` (both anchors, `adminSecret`
  as `secretKey`), `authField: 'adminSecret'`, `ungatedActions: ['bootstrapSecret']`,
  `securedCmds: ['admin']`. Gone: `sessionContext_`, `postSession`, `versionPostFn`,
  `closeVersionSession`, the Cookie-stripping error handler (the package's raw POST cannot leak a
  session header, so the bug that handler existed for is now structurally impossible), and every
  reference to `@playwright/test` — pinned by a unit test.
- Two project-local argv conventions survive as a 6-line `normalizeArgv`, so no caller or doc had
  to change: bare `version` routes itself to `--cmd version`, and `--data` is accepted as the
  alias for the package's `--body` (this project's docs and `local.settings.example.json` have
  always said `--data`).
- `callAdmin(action, body, env)` is kept — `manage-deployments.js`'s `--verify-test`/`--verify-prod`
  needs the result as a value, not as stdout — but it is now ~15 lines over the package's
  `webapp.call` + `resolveDeploymentId`, not its own transport.
- `manage-deployments.js` — `verifyOptions` is `{ timeoutSec: 90 }`; **no `postFn` is passed to
  gas-deploy from this project any more**, which is G2's precondition. The `.finally(closeVersionSession)`
  teardown is gone with it.
- Deleted: `authenticate.js`, `test-auth.js`, and the `auth` / `auth:clear` / `test:auth` package
  scripts.

**`pnpm run deploy:test` completed with no session present**, including `assertDeployedVersion`
("✅ TEST verified — serving v1.6.7.7 (target TEST)"), and `node tools/call-webapp.js version --env test`
returns JSON with no browser launched.

**What `.auth/` is still needed for, stated plainly:** only the UI test suite. The
`HtmlService` page stays live through the P2–P5 dual-run and the Playwright specs drive it in a
real browser, so `PLAYWRIGHT_AUTH_STATE` (→ `~/.playwright/sdonaldson.json`) is still read by
`playwright.config.js` and `tests/auth.setup.js`. Per the stage spec those fixtures were left
alone. But deleting `authenticate.js` removed the *capture* tool they depended on, so the
capture instructions in `tests/auth.setup.js`, `.auth/README.md` and `docs/playwright-testing.md`
now point at the standard equivalent:
`npx playwright open --save-storage="$PLAYWRIGHT_AUTH_STATE" https://accounts.google.com`.
**P5 should retire this entirely** — once the `HtmlService` page is gone the static page is
anonymous and the suite needs no session at all. Historical mentions in `CHANGELOG.md` and
`work-log.md` were deliberately left as-is; they are records of what happened, not instructions.

**Test evidence:** `pnpm run test:unit` **133/133 pass** (121 before). Red observed first: 12
failing across a new `tests/unit/call-webapp.test.js` (wrapper config, `normalizeArgv`, and
structural assertions that the manifest is `ANYONE_ANONYMOUS`, the two scripts are deleted, no
package script references them, and the caller contains no browser code) plus one added case in
`tests/unit/manage-deployments.test.js` asserting no `postFn`. Playwright `4-playback-view.spec.js`
against live TEST: **10 passed, 1 flaky (passed on retry), 1 failed** — the failure is `P12`,
the pre-existing desktop meter-layout bug already filed as `atc-c1m` in P1R, unchanged by this
stage. Page load, track load through the base64 path, and playback all pass, so the `HtmlService`
front end still works under `ANYONE_ANONYMOUS`.

**Filed, not folded in** (stage contract §6.4): `atc-0hh` — `pnpm run verify:test` reports
`AXIOM_DATASET` drift on TEST (server `(unset)` vs local `nuuts-mix`). Surfaced while exercising
the new `callAdmin` path; the tooling worked correctly, the drift is real, pre-existing and
unrelated to P2.

**Not committed/pushed** — stage contract §6.7. `src/` was pushed to the TEST Apps Script project
by `pnpm run deploy:test`, as the stage requires.

### P3 — port the page (closed 2026-08-23)

**The static page runs from a local server against live TEST, and the existing UI suite fails in
exactly the same places on both front ends.** That like-for-like comparison — not a green suite —
is the evidence for the AC, because three of the failures are pre-existing bugs that fail
identically on the `HtmlService` page.

**Placeholders stamped — there are four, not the three this stage's spec named:**

```js
var STATIC_BUILD_VERSION_ = null;
var STATIC_ENV_LABEL_     = null;
var STATIC_WEBAPP_URL_    = null;
var STATIC_BUILD_DATE_    = null;   // added during P3 — see below
```

`STATIC_BUILD_DATE_` was not in the spec and is not decoration. The sessionStorage folder cache
(`atc-79j`) keys every entry by `BUILD_INFO.buildDate` so a listing cannot outlive the build it
came from; the first port hardcoded `buildDate: null`, which silently collapses every build onto
one shared `nostamp` prefix — precisely the cross-build reuse the scoping exists to prevent. It
was caught by `N7`, the one spec that diverged between the two front ends. Unbuilt, the stamp
falls back to the page load (`'local-' + Date.now().toString(36)`), so a local reload starts a
fresh cache. **P4 must stamp all four literals**; `STATIC_BUILD_DATE_` is P4's `builtAt`.

**Locator changes — one, and it is a defect in the spec, not in the port.** `F2`
(`1-foundation.spec.js`) hardcoded the descent through Google's nested iframes instead of calling
`getUserFrame()`; it now calls `getUserFrame()`. Nothing else moved. `getUserFrame()` itself now
*detects* the absence of `#sandboxFrame` and returns the `Page` — a `Page` and a `FrameLocator`
both answer `.locator()`, which is why 57 specs run unchanged against both front ends. Detected,
not configured: a spec should not have to know which front end it is pointed at.

Two assertion changes, both consequences of an unbuilt page rather than locator drift:
`F5` accepts the honest `"unbuilt (local)"` footer and re-applies the version assertion the moment
a build is stamped; `N7` needed the `buildDate` fix above, not a test change.

**Local-server command:** `node tools/serve-static.js --port 4173`, or `startStaticServer()` from
`tests/test-utils.js` (ephemeral port). `playwright.config.js` starts it as a top-level `webServer`
with `reuseExistingServer`.

**Specs run and results** — all with `--retries=0 --max-failures=99`, because retries re-run whole
`describe.serial` blocks and distort both the failure list and the `A1` doGet count:

| Suite | static | chromium (`HtmlService`) |
|---|---|---|
| full run | 44 passed, 3 failed, 1 skipped, 9 did not run (5.5 min) | 49 passed, 4 failed, 1 skipped, 9 did not run (6.1 min) |
| failures | `N5`, `P12`, `R1` | `N5`, `P12`, `R1`, `A1` |
| `node --test` unit suite | **146/146** | — |

The 9 "did not run" are the tails of the three aborted `describe.serial` blocks — `N6`, `N7`,
`P13`–`P17`, `R2`, `R3` — and are identical on both fronts. They were re-run directly by name on
**both** projects rather than left unexecuted: `N6`, `P17`, `R2` fail on both with byte-identical
symptoms (hidden `.subfolder-btn`; `meterGap` 257 against `< 80`; back-button click timeout);
`P13`–`P16` pass on both; `R3` times out on both; `N7` passed on chromium and failed on static,
which is how the `buildDate` defect surfaced, and is green on both after the fix.

So **every failure fails identically on the `HtmlService` page**, and the only divergence the port
introduced was found and fixed. Standing failures, none folded in (stage contract §6.4):

| Bead | Spec | Note |
|---|---|---|
| `atc-1zs` | `N5`, `N6` | `.collapsed` hides subfolder buttons when the folder holds tracks *and* subfolders. Filed in P3. |
| `atc-c1m` | `P12`, `P17` | Desktop/mid-width meter layout. Pre-existing, filed in P1R. |
| `atc-6bw` | `R1` | Regression spec defect. Pre-existing, filed in P1R. |
| `atc-zo8` | `R3` | **Filed in P3.** Opportunistic spec walks 5 tracks at 60 s each inside a 60 s test budget; times out whenever nothing fails. Masked in full runs because `R1` aborts the block first. |
| `atc-fvv` | `A1` | **Filed in P3.** `DOGET_THRESHOLD = 15` was baselined against a ~30-spec suite; the suite is now 63 and a clean run reports 23. The `beforeAll` optimisation it guards is intact — specs 4, 5 and 6 still make zero direct `page.goto('')` calls. `chromium` only; the static front end issues no `doGet` at all (`A1` reports 4 there). |

**New in the repo:** `static-pages/src/index.html` (the ported page, ~4.9k lines, hand-maintained —
the assembler that inlined the seven includes was a throwaway and is not a build step; P4 owns real
build tooling), `tools/serve-static.js`, `tests/unit/static-page.test.js` (13 tests, including DOM
parity: every `data-testid` and every element `id` on `src/index.html` is present on the static
page), `tests/10-static-page.spec.js` (`S1`–`S5`: cross-origin load, title + favicon, address-bar
state, explicit error state, and D5 asserted by inspecting live request bodies for a token).

**D5 is visible in the code.** `callApi()` posts `{action, ...args}` and nothing else — no
`idToken`, no sign-in UI anywhere in the file. **P6's seam is the payload literal inside
`callApi()`**, commented as such. The `text/plain` POST is deliberate: it is a CORS *simple*
request, and Apps Script cannot answer `OPTIONS` at all.

**Carried into P5:** `src/ui.js.html` and `static-pages/src/index.html` are now two copies of ~4.9k
lines and will drift during the dual-run. The DOM-parity unit test catches structural drift only —
it says nothing about behavioural drift in the JS. Any UI fix before P5 must be applied to both.
`syncAddressBar()` is called from `renderSubFolders()`, which is the honest join point today but
couples URL state to a rendering function; `atc-es8` et al. should move it when they build the real
URL-state contract.

**Not committed** — stage contract §6.7. Nothing in P3 has been committed.

---

### P4 — adopt `gas-static` (closed 2026-08-23)

**One `pnpm run deploy:test` now ships both halves.** The Apps Script deploy and the static page
are published by the same command, and the run fails if they disagree.

**Live URLs — both envs:**

| Env | `dest` in `Static` | Live |
|---|---|---|
| `test` | `pub/pmix-sit` | https://nuuc-it.github.io/Static/pub/pmix-sit/ |
| `prod` | `pub/pmix` | https://nuuc-it.github.io/Static/pub/pmix/ *(not yet published — first PROD deploy creates it)* |

`pub/pmix-sit` + `pub/pmix` follows the repo's own `pub/AS-sit` + `pub/AS`
precedent, including its `-sit` suffix for the test env, and keeps the PROD bookmark URL short.
This is the one thing P4 changed in the frozen plan text above: D4 and P4's spec/AC originally
said `pub/practicemix`, and were amended to `pub/pmix` on the user's instruction — not a silent
drift, and the only edit this stage made outside §7. The first TEST publish went to
`pub/practicemix-test` and was retired in `Static` commits `daf27d1` (republish) + `723262a`
(removal); that URL now 404s. The invariant the AC was protecting — a `git add` can never stage
another app's work — holds per env, and is asserted in `tests/unit/static-pages.test.js` against a
`^pub/pmix(-[a-z]+)?$` shape.

**`staticRepoPath` — the only new `local.settings.json` key**, value `"../Static"`
(`/home/stuar/proj/Static`; relative paths resolve against the project root inside `gas-static`).
`local.settings.example.json` updated with the key and an instructions paragraph.

**Observed propagation delay: ~35 s** for the first publish into a brand-new directory (7 poll
attempts at 5 s). GitHub Pages rebuilds the whole site on push, so this is a site-wide rebuild,
not a per-file CDN edge delay — a `dest` that already exists should be no slower. `timeoutSec` is
set to **300** in the verify hook; that is deliberately generous, because the failure it guards is
"CDN still serving the old page" and a false timeout costs a re-run while a false pass ships a
mismatched pair.

**How `webappUrl` reaches the page — the one non-obvious wiring:**
`config.resolveBeforeStamp = true` in `manage-deployments.js`, so gas-deploy resolves the named
deployment *before* the stamp and hands `webAppUrl` to `stampAll_`. `stampAll_` now writes a
**`BUILD_INFO` literal into `src/BuildInfo.js`** — `{version (bare semver), buildDate, env,
webappUrl}` — which is the only thing `gas-static` reads. Note this is a *server-side* `BUILD_INFO`
and is distinct from `src/version.html`'s client-side one (whose `version` is the display string
`v1.6.7.8 (Rev. …)`, not a semver, and which the GAS runtime cannot read at all). Pointing
`webappUrl.file` at `version.html` would have made `assertPublishedBuild` compare a display string
against a semver — it must stay `src/BuildInfo.js`.

`stampAll_` also now takes its paths from `ctx.root` rather than the module's `__dirname`, purely
so it is testable against a temp tree without writing into the repo.

**`STATIC_BUILD_DATE_` is stamped from `BUILD_INFO.buildDate`**, not from `version.json`'s
`builtAt`. Same deploy, seconds apart, but the page's sessionStorage cache generation (`atc-79j`)
and the build identity must be the same string, and `builtAt` is the package's own field.
`tools/static-pages.js` reads it with a three-line field regex — deliberate near-duplication of
`gas-static/lib/buildInfo.js`'s reader, which returns only `{version, webappUrl, env}`; extending
the package for one consumer's fourth field was not worth a version bump.

**Evidence.**

- `pnpm run deploy:test` → v1.6.7.8, exit 0. Chain ran in order: `static build` →
  `static-pages/dist/test`; `static publish` → `[main faddf81] Publish PracticeMix TEST v1.6.7.8`,
  `2 files changed`, pushed to `nuuc-it/Static`; `static verify` → green after 7 attempts.
- Live `version.json`:
  `{"version":"1.6.7.8","env":"test","webappUrl":"https://script.google.com/macros/s/AKfycbx6…/exec","builtAt":"2026-08-23T21:30:37.159Z"}`
  — `webappUrl` is the deployment that same run deployed, `env` matches the target.
- Live page carries all four stamps, none left `null`:
  `STATIC_BUILD_VERSION_ = "1.6.7.8"`, `STATIC_ENV_LABEL_ = "TEST"`,
  `STATIC_WEBAPP_URL_ = "https://script.google.com/macros/s/AKfycbx6…/exec"`,
  `STATIC_BUILD_DATE_ = "2026-08-23T21:30:28.458Z"`.
- **Stale-build failure demonstrated once** against the live TEST URL: the `static verify` hook,
  asked for `1.6.7.9` while the CDN served `1.6.7.8`, threw
  `assertPublishedBuild timed out after 60 attempts (300s) waiting for test to serve v1.6.7.9 —
  last seen: 1.6.7.8`. `required: true` makes `gas-deploy`'s `runPostDeploy_` rethrow it as
  `Required post-deploy hook "static verify (assertPublishedBuild)" failed: …`, failing the deploy.
- Scoped publish: `git log -1 --stat` in `Static` shows only that env's own two files; the rest of the repo was untouched and its tree was clean afterwards.
- `pnpm run test:unit` → **167/167 pass** (146 at P3 close, +21 new). New/extended:
  `tests/unit/static-pages.test.js` (17) and `tests/unit/manage-deployments.test.js`
  (+5: `resolveBeforeStamp`, hook order, all-hooks-required, `stampAll_` round-tripped through
  `gas-static`'s own `readBuildInfo_`, and `stampAll_` honouring `ctx.root`).

**G1's package was committed and tagged as part of this stage**, with the user's explicit
authority: GAS-Core `4656590` on `gas-deploy-recommendation-stage1a`, tag `gas-static-v1.0.0`,
both pushed. G1's own handoff note said "not committed" — that is now stale. PracticeMix pins
`gas-static@github:stuartdonaldson/GAS-Core#gas-static-v1.0.0&path:/packages/gas-static`.
Nothing else in GAS-Core's dirty tree (including this plan file) was committed.

**Not committed in PracticeMix** — stage contract §6.7.

**Carried into P5:** the `HtmlService` page is untouched and still deploys, so the dual-run P5
needs is already in place — TEST now serves both front ends from one deploy. P5's first-paint
before/after measurement can be taken directly against the two live TEST URLs. The `deploy:prod`
path is wired identically but has **never been run**: the first PROD deploy creates
`pub/pmix` from nothing, which is the slow propagation case measured above.

### P5 — dual-run (first half; closed 2026-08-23). Retirement deferred.

**The retirement was not executed, on the user's call.** P5's spec says "keep `doGet`'s page live
and regression-tested beside the static page **for one release cycle**, then remove it" — and the
release cycle has not run: PROD has never been deployed, so the static page choir members would be
redirected *to* does not exist yet. This session therefore delivered the dual-run half — the suite,
the measurement, the criterion — and left AC3 (strip `doGet`) and AC4 (close `GAS-Core-vo3`) open.
**`atc-mta` stays open**, and so does `GAS-Core-vo3`. What remains of P5 is one session's work once
the criterion fires, and nothing in it depends on this one being re-derived.

**AC1 — one suite, both front ends: `pnpm run test:dual`**
(`--project=chromium --project=static --retries=0 --max-failures=99`; the retry flags are load-
bearing, see P3). 122 specs, 13.7 min:

| | passed | failed | skipped | did not run |
|---|---|---|---|---|
| `chromium` (`HtmlService`) | 59 | 2 | 1 | 2 |
| `static` | 53 | 2 | 1 | 2 |
| **total** | **112** | **4** | **2** | **4** |

`static` runs 6 fewer specs by design (`0-api-spike`, `10-static-page` — both take `baseURL` to be
the deployment). **The failure list is identical on both: `R1` and `A1`, and nothing else.** `N3`
skipped and `R2`/`R3` not-run on both, being the tail of the block `R1` aborts.

**Read against P3's baseline, the parity got strictly better.** P3 recorded `N5`, `N6`, `P12`,
`P17` failing on both; all four now pass on both. They were fixed in the working tree since —
`expandSubfolders()` in `tests/test-utils.js` (`atc-1zs`) and the `hw0-waveform-graph` work — not
by this stage. Standing failures, neither folded in (§6.4):

| Bead | Spec | Note |
|---|---|---|
| `atc-6bw` | `R1` | Regression spec defect. Pre-existing. |
| `atc-fvv` | `A1` | Stale threshold — **and the dual run exposes a second defect in it**, recorded on the bead: `A1` reads a *server-side* `doGet` counter, so it counts both projects' loads rather than its own. Observed `chromium` 25, `static` 30, threshold 15 — and the static page issues no `doGet` at all, so all 30 are chromium's. `A1` is only meaningful in a single-project run until it scopes its count. |

`pnpm run test:unit` → **167/167**.

**The number the whole plan was for** — `pnpm run measure:first-paint` (new;
`tools/measure-first-paint.js`), 5 cold contexts per front end against live TEST:

| Front end | App visible | FCP | Transferred |
|---|---|---|---|
| `HtmlService` | **4213 ms** | n/a | 282 KB |
| static | **116 ms** | 160 ms | 43 KB |

**≈36× faster to first app paint, on ≈6.6× fewer bytes.** *App visible* is navigationStart until
`#selection-page` is visible — markup, not Drive data. It is the only metric comparable across the
two, because the `HtmlService` top document reports **no paint entry at all**: the visible pixels
are composited by a cross-origin iframe whose timeline the top frame cannot read. Bytes are counted
over CDP `Network.loadingFinished`, not `content-length`, for the same reason. And the gap widens on
a revisit that the measurement does not show: static is served `cache-control: max-age=600` + ETag,
`HtmlService` re-ships its ~150 KB inline on every load, uncached.

**AC2 — the retirement criterion**, recorded in `docs/architecture.md` §10.2 and on `atc-mta`. Let
**D** be the first PROD deploy that publishes `pub/pmix`. Retire on whichever fires first:

1. **Usage signal (preferred).** 7 consecutive days with no `doGet.start` from a non-test client.
   That event is logged *only* for page loads — `cmd=version` returns ahead of it and `cmd=api`
   never reaches `doGet` — so its count is exactly the count of visitors still landing on the old
   page.
2. **Backstop.** D + 30 days. Bookmarks do not expire; the redirect that replaces the page is what
   serves the people holding them.

Retirement is **blocked**, and the 7-day count resets, while any defect reproduces on the static
page but not on the `HtmlService` one. Neither clause can fire before PROD ships: D does not exist
yet, and retiring on TEST-only evidence would remove the fallback the criterion protects.

**New in the repo:** `tools/measure-first-paint.js`; `package.json` gains `test:dual` and
`measure:first-paint`; `docs/architecture.md` §10 (both front ends, the dual-run, the numbers, the
criterion); README §Deployment Model and §Testing point at it. **No `src/` change** — P5's first
half is measurement and documentation.

**Carried into P5's second half:** P3's warning still stands and now has a release cycle to survive
— `src/ui.js.html` and `static-pages/src/index.html` are two copies of ~4.9k lines, and the
DOM-parity unit test catches structural drift only. The `hw0-waveform-graph` work in the tree is the
first live test of that: P13–P17 pass on both today. Every UI change until retirement must land in
both files.

**Not committed** — stage contract §6.7. The working tree also carries unrelated in-progress work
(`hw0-waveform-graph`, `P3stat.md`, `tests/zz-scratch-layout.spec.js`); P5 touched none of it.

---

## 8. Known housekeeping, not part of this plan

- PracticeMix's beads export is stuck: `.beads/issues.jsonl` holds 2 JSONL-only records (`atc-4fk`,
  `atc-ohj`) absent from the Dolt store, so `bd` refuses to overwrite the export. Repair is
  `bd init --from-jsonl` — needs a human decision, do not run it as part of a stage.
- GAS-Core's beads have no Dolt remote configured (`bd dolt remote add origin …`). Same: not a stage.
