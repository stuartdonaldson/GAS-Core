# Best Practice: Porting a GAS HtmlService Page to a Static Front End

> **Consolidation status:** the *pattern* below is settled and in production in three projects, but
> the build/publish/verify pipeline around it is still three hand-copied scripts. See
> [`RECOMMENDATION.md`](RECOMMENDATION.md) for the cross-project survey, the proposed `gas-static`
> package, the brokered-identity model, and the PracticeMix migration plan.

## Overview

This pattern replaces `HtmlService`-served pages with a plain static HTML/CSS/JS file (hosted
anywhere over HTTPS — GitHub Pages, Cloudflare Pages, etc.) that calls the same Apps Script web
app as a JSON API via `fetch()`. Apps Script stays the **backend only**: same business logic, same
Sheet-backed data, same `doPost` dispatcher, just consumed as `application/json`-in/`text/plain`-out
instead of server-side templated HTML. The `HtmlService` page can keep running unmodified
alongside the static one — this is additive, not a cutover.

**Use when:** a public-facing or frequently-revisited GAS web app page suffers from first-paint
latency, Google's sandbox chrome, or address-bar-level limitations (title, favicon, bookmarkable
deep links) that matter to users. **Skip when:** it's an internal tool with a handful of users, or
a sheet-bound sidebar/menu that only ever opens inside the Sheets UI — there's no bookmarkable-URL
story to begin with and the sandbox's quirks genuinely don't matter.

**Provenance:** Extracted from F3Go30's migration of its check-in page (`script/CheckinApp.html`)
to a static page hosted on GitHub Pages, calling the same GAS web app. Source doc:
`~/proj/F3Go30/docs/StaticHTMLonGas.md` (source issues F3Go30-5nfj.1/.2 and same-day follow-ups).
Reference files in that project: `tools/build-static-pages.js`, `tools/publish-static-pages.js`,
`tools/manage-deployments.js`, `script/IdentityCore.html`, `script/CheckinSessions.js`.

**Reference files in this folder** (genericized starting points — copy and adapt, don't import
as-is):
- [`cors-fetch-client.html`](cors-fetch-client.html) — the `callApi()` `text/plain` POST client
  from Step 1 / "Details the first pass missed" #4, extracted from F3Go30's `IdentityCore.html`.
- [`gas-backend-example.js`](gas-backend-example.js) + [`appsscript.json.example`](appsscript.json.example)
  — a minimal GAS `doPost` JSON dispatcher (`ping` action) plus a worked Google Identity Services
  verification example (`whoami` action) implementing the "identity & access control" section
  below: `tokeninfo` verification, `aud`/`iss`/`exp` checks, `sub`-keyed allowlist, fail-closed.
- [`gis-identity-client.html`](gis-identity-client.html) — the matching client-side GIS
  sign-in snippet (renders the Google button, decodes the token for display only, hands it to
  `callApi('whoami', ...)` for server-side verification).
- [`build-static-pages.js`](build-static-pages.js) / [`publish-static-pages.js`](publish-static-pages.js)
  — the Step 5 build/publish pipeline template (version stamping, per-env `dist/`, optional
  publish to a dedicated static-hosting repo), genericized from F3Go30's `tools/`.
- A working end-to-end demo tying all of the above together is published from this repo's own
  [`static/`](../../static/) folder via [`.github/workflows/deploy-pages.yml`](../../.github/workflows/deploy-pages.yml)
  — see [`static/README.md`](../../static/README.md).

---

## Problem

`HtmlService` renders web-app pages inside a **cross-origin sandboxed iframe**
(`script.googleusercontent.com`), wrapped by a top-level document Google controls. That wrapper
costs two orders of magnitude of first-paint latency (F3Go30 measured ~3.3s to first byte / ~4.5s
to `networkidle` vs. ~18ms shell commit / ~30ms `domcontentloaded` for the static equivalent — the
actual data round trip costs the same either way) and blocks ordinary browser mechanics the sandbox
doesn't forward to the top-level document:

- `document.title` set client-side never reaches the bookmarkable tab/window — only
  `HtmlOutput.setTitle()` at render time works, which forces title computation *before* the
  template renders, from whatever identity is available server-side.
- `<link rel="icon">` is ignored; the only supported mechanism is `HtmlOutput.setFaviconUrl()`,
  which requires an **externally hosted** URL (clasp has no static binary-asset hosting).
- A deep-link query string is invisible to client JS — Apps Script injects rendered content into
  the iframe with no query string of its own. Anything the client needs must be read server-side
  and templated in.
- `history.replaceState`-style bookmarkable-URL updates can't reach the address bar — there's no
  top-level URL for it to act on from inside the sandbox.
- No CDN, no HTTP cache-control — every request re-runs through Apps Script's execution quota and
  cold-start path.

None of this is a defect in `HtmlService` — it's doing exactly what it's designed to do (sandbox
third-party script execution inside Google's UI shell). It's the wrong tool once page-shell
performance and address-bar-level control matter.

---

## Feature availability: HtmlService sandbox vs. static first-party page

Both environments run in the same real browser with the same JS engine — the difference isn't API
surface, it's **which document the browser credits as the top-level, first-party one**. The
`HtmlService` page is always a cross-origin document nested inside Google's wrapper; the static page
*is* the top-level document. That single fact is the root cause of every row below.

| Capability | `HtmlService` (nested sandboxed iframe) | Static first-party page |
|---|---|---|
| **Page `<title>`** | Only `HtmlOutput.setTitle()` at render time (server-side, pre-render) — client-side `document.title` never reaches the real tab | Full client-side control any time, e.g. after an async identify call resolves |
| **Favicon** | Only `HtmlOutput.setFaviconUrl()`, and it requires an externally-hosted URL — `<link rel="icon">` is ignored | Normal `<link rel="icon">` works |
| **Address bar / URL** | No access — the top-level URL belongs to Google; `history.replaceState`/`pushState` have no top-level URL to act on | Full control — query string is readable on load, `history.replaceState`/`pushState` work normally |
| **Deep-link query params** | Invisible to client JS; must be read server-side in `doGet` (`e.parameter`) and templated into the page | `URLSearchParams` reads them directly, client-side |
| **First paint / caching** | No CDN, no `Cache-Control` — every load re-runs through Apps Script's execution quota and cold-start path (~3.3s TTFB / ~4.5s `networkidle` measured in F3Go30) | Normal HTTP caching, CDN-fronted (~18ms shell commit / ~30ms `domcontentloaded`) |
| **`localStorage` / `IndexedDB` / client-set `document.cookie` (Safari ITP)** | WebKit's 7-day cap **never resets** — taps happen inside a cross-origin nested iframe, which don't count as first-party interaction, and the top-level Google URL never navigates | Same 7-day cap exists (a Safari policy, not removable client-side) but it **resets on every real visit**, since the page itself is the top-level document |
| **Server-set `HttpOnly` cookie** (the one storage class ITP never caps) | Not applicable — no server-set cookie exists in this model | Still unavailable from *pure* static hosting (no server to set it); needs Cloudflare Workers, Firebase Hosting + a function, or Cloud Run to issue one |
| **Google Identity Services (GIS) sign-in / verifiable visitor identity** | Not workable — anonymous sandbox; `Session.getActiveUser().getEmail()` returns `''` under `ANYONE_ANONYMOUS` | Works fully — GIS ID token flow, verified server-side (`tokeninfo`/JWKS), `sub`-keyed allowlist. See [identity & access control](#what-a-first-party-page-unlocks-next-identity--access-control) below |
| **Sandbox / wrapper chrome** | Google's UI wrapper always present above the page content | None — an ordinary top-level document |
| **CORS request shape** | N/A — same-origin `google.script.run` calls | Must POST `text/plain`, not `application/json`, to avoid a preflight `OPTIONS` Apps Script's web app doesn't handle usefully |
| **Config/data available "for free"** | `<?= ... ?>` server templating and `doGet`'s request access bake config in before the page ever reaches the browser | None — every such value must be re-routed through the static page's own URL query string or an API response payload |
| **Backend business logic / Sheet-backed data / GAS execution authority** | Identical either way — same backend, same `doPost` dispatcher, same manifest (`executeAs`/`access`) | Identical — this is why the migration is additive, not a rewrite |

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **CORS actually works on `/exec`** | Verify *before* porting anything — see Step 1 below. |
| **A JSON-in/JSON-out `doPost` action** | Reuse or add one for whatever the HTML page used to get via server templating or `google.script.run`. |
| **A static host** | Anywhere serving static files over HTTPS. Prefer a dedicated repo/host — see Step 5. |
| **`text/plain` POST bodies** | Avoids a CORS preflight `OPTIONS` request that Apps Script's web app doesn't handle usefully; parse JSON server-side instead. |

---

## Architecture

```
Static host (GitHub Pages, or any static host)
  index.html  --fetch()-->  GAS web app /exec?cmd=<x>  (doPost, JSON in/out)
                                   |
                                   v
                            Same business logic, same Sheet-backed data
                            the HtmlService page already used
```

### Step 1 — Confirm CORS actually works (spike before porting anything)

Apps Script's `/exec` URL responds with a redirect to `script.googleusercontent.com` before
returning content. Confirm **both hops** send `Access-Control-Allow-Origin: *`. Verify with a real
browser from a genuinely different origin — not `file://`, which has its own CORS exemptions that
can hide a real problem. (F3Go30 used Playwright serving the static file from `127.0.0.1` while
calling a live SIT deployment.) Use a `text/plain` POST body, not `application/json` — the latter
triggers a preflight.

**Classify the spike's result by HTTP status, never by body text.** A cross-origin `fetch()` to an
`/exec` that is *not* `ANYONE_ANONYMOUS` does not resolve with a readable sign-in page — it
**rejects outright** with `TypeError: Failed to fetch`, because Google's access-denied response
carries no `Access-Control-Allow-Origin` and the browser blocks it before any body is readable.
Fetching the identical URL from Node (no CORS enforcement there) shows the real content: **HTTP
401**, body `<title>Page Not Found</title>` — a generic Google error wrapper, not sign-in markup.
Measured in PracticeMix P0 against live TEST. Two consequences for the spike spec:

- Classify on **status**: `401`/`403` ⇒ the deployment is not anonymous (sign-in required); any
  other non-JSON response ⇒ deployment mid-propagation. Text-matching on `accounts.google.com` or
  "sign in" is the obvious wrong answer and would never fire against this body.
- Expect the spec to make **two** requests per run: the in-browser `fetch()` that is the actual
  subject of the spike (and which is *expected* to throw before the flip), plus a Node-side raw POST
  purely to turn that throw into a readable diagnostic.

### Step 2 — Give the client everything the server used to bake in

An `HtmlService` page gets configuration "for free" via server-side templating (`<?= ... ?>`) and
via `doGet`'s access to the request. A static page has none of that. Two changes carry the weight:

1. **Route configuration through the existing data-fetching call**, don't invent a new endpoint.
   Add config to a response payload shared by *both* front ends (one server function builds it
   once, called from wherever both the GAS-templated page and the static page's first API call
   already invoke it) — that way the two payloads can never drift out of parity.
2. **Move query-string configuration to the page's own URL.** Whatever `doGet`'s `e.parameter` used
   to carry becomes a query param on the static page's own URL
   (`index.html?webapp=<exec-url>&id=<token>&ns=...`), read with `URLSearchParams` at load and
   forwarded on every API call exactly where the GAS page used to inject them server-side.

### Step 3 — Hand-port the HTML/CSS/JS, don't templated-generate it

Port existing `HtmlService` file(s) to plain HTML **by hand**, keeping the same DOM ids/classes/CSS
and the same client-side logic verbatim wherever it doesn't depend on server templating. This keeps
existing UI-test locators valid for both pages, and sidesteps any design-tool export format that
requires a proprietary runtime (neither front end can deploy that directly — both need the same
manual port regardless, so do it once, shared).

Any GAS `<?!= include('SomeFile') ?>` shared partial gets inlined into the static file's own
`<script>` block, commented as "kept byte-for-byte identical to the GAS include" — a deliberate
manual-sync point, since there's no shared build step between the two files. Grep both periodically
for drift.

### Step 4 — Client-side identity resolution replaces server-side templating

The GAS page resolved "who is this visitor" *before* the page reached the browser (`doGet` decodes
a saved-session token server-side, bakes identity into the template). A static page has no
per-request server hook, so identity resolution becomes the **first thing the client does after
load**: an async `identify` API call using the token/query params read from its own URL. Render a
lightweight "identifying…" state for that gap — typically much shorter than the sandbox-boot
latency it replaces.

### Step 5 — Build and publish as their own pipeline stage

- A small build step stamps build-time values (e.g. a version string) into a placeholder in the
  source and writes one copy per environment (SIT/PROD) into `dist/<env>/`. Keep the *source* file
  free of environment-specific values.
- **Publish to a dedicated static-only repo, not the main dev repo.** Coupling the static page's
  release cadence to every push-to-main on the dev repo, and putting a public Pages site on a repo
  that also holds unrelated source, is a mistake worth avoiding from the start — use a separate
  repo that GitHub Pages serves directly from `main`/root, with a publish step that builds, copies
  the target env's `dist/` folder in, commits, and pushes. That repo should hold **only** generated
  output.
- **Chain the publish into the existing deploy, don't make it a separate manual step.** If the GAS
  web app and the static page share one version/build counter, a static-only publish that bypasses
  the real deploy would either reuse a stale build stamp or double-bump the counter. Call the
  static-publish script automatically as the last step of `deploy()`, publishing only the env that
  was actually just deployed.

### Step 6 — Regression-test both front ends against the same live backend

Add a Playwright spec (or equivalent) that serves the static file from a **genuinely different
origin** than the GAS deployment (this is what actually exercises CORS, not a same-origin dev
server) and drives it against a real SIT deployment: identify, a data-mutating action, and a
read-back that proves the write landed. Keep one regression test for the *original* GAS page in the
same suite ("still works unchanged") — this migration is additive, and a regression there is
exactly as costly as one in the new page. See
[`../gas-playwright-testing/README.md`](../gas-playwright-testing/README.md) for the nested-iframe
Playwright pattern this complements (the static page's own test has no iframe to navigate, unlike
the GAS page it sits beside).

**Run one suite against both front ends — detect the front end, don't configure it.** PracticeMix
ran **57 specs unmodified** against both by changing one helper:

- Make the frame accessor *detect* the sandbox. `getUserFrame()` looks for the `HtmlService`
  sandbox frame (`#sandboxFrame`) and, when it is absent, returns the `Page` itself — a `Page` and a
  `FrameLocator` both answer `.locator()`, so every spec below that line runs unchanged. A spec
  should not have to know which front end it is pointed at.
- Express the two front ends as **two Playwright projects over one suite**
  (`--project=chromium --project=static`), the static project served from `127.0.0.1` by a
  `webServer` entry so the run is genuinely cross-origin.
- Run the dual pass with **`--retries=0 --max-failures=99`**. These flags are load-bearing, not
  taste: a retry re-runs a whole `describe.serial` block, which distorts the failure list and
  double-counts any server-side counter a spec asserts on.
- **The acceptance signal is parity, not green.** The port is validated when every failure fails
  *identically* on both front ends. A green-suite bar blocks the port on unrelated pre-existing
  defects; the one *diverging* failure is what surfaces a real regression — in PracticeMix's dual
  run that divergence (`N7`) caught a genuine build-stamp defect that a green bar would have lost in
  the noise.
- An assertion that reads a **server-side** counter (a `doGet` invocation count, say) sums *both*
  projects during a dual run and is meaningless until it scopes its count. See
  [`../gas-playwright-testing/README.md`](../gas-playwright-testing/README.md).

**Then retire the old page against a stated criterion, not a feeling.** Write the criterion down
before the dual run starts, so "is it safe yet" is a lookup rather than an argument. The recipe,
from PracticeMix:

Let **D** be the first PROD deploy that publishes the static page. Retire on whichever fires first:

1. **Usage signal (preferred).** 7 consecutive days with **no page-load event from a non-test
   client**. Log that event at the top of `doGet` and count *that* one specifically — it fires only
   for page loads (an API `cmd=` route returns ahead of it, and a static-page `fetch()` never
   reaches `doGet` at all), so its count *is* the count of visitors still landing on the old page.
2. **Backstop.** D + 30 days. Bookmarks do not expire; the redirect that replaces the page is what
   serves the people still holding them.

Retirement is **blocked**, and the 7-day count resets, while any defect reproduces on the static
page but not on the `HtmlService` one. Neither clause can start counting before the static page
exists in PROD — retiring on TEST-only evidence removes the fallback the criterion exists to
protect.

---

## The static page interface contract

A static front end and the GAS backend it talks to are two independently deployed halves, and
**asserting they agree at deploy time is necessary but not sufficient**. They can diverge after a
green deploy: a CDN edge still serving the previous page, a visitor holding a cached document, a
publish that succeeded while the backend was later rolled back. The deploy-time guard
(`gas-static`'s `assertPublishedBuild`, which asserts the published `version`, `env` *and*
`webappUrl`) closes the publish window. These six requirements close the runtime one — they make
the page itself tell the truth about which halves are running.

Every static front end in the estate must satisfy all six. **F3Go30 is the reference
implementation** (`static-pages/src/index.html`, pinned by
`test/test_static_page_client_invariants.js`).

1. **The page displays its own build version persistently** — a footer, populated *before any
   network call*. F3Go30 calls `applyVersionState_(STATIC_BUILD_VERSION_, null)` at load and
   repaints later; a page that cannot reach its backend still shows what it is.
2. **Every API response carries the server's version**, on a response the page already makes
   (F3Go30 puts it on `cfg.appVersion` in every identify), never a dedicated call. The page
   compares it against its own build.
3. **On mismatch the page shows *both* versions and offers a reload.** The version shown first is
   always the **client** build — `v2.4.5 (build) · server v2.4.7` — because, in the reference
   implementation's own words, "the version a PAX reads back off the footer during support must be
   the one their document is actually running". Never silently show the client version alone on a
   mismatch, and never replace it with the server's.
4. **Dismissal of the update prompt is keyed to the version dismissed**, not a boolean
   (`localStorage['go30UpdateDismissed'] = '2.4.7'`). A boolean silences every future mismatch;
   a version key means the next one prompts again.
5. **An unbuilt or local document is labelled as such and never reported as stale.** Unbuilt `src/`
   served directly (local dev, Playwright) has no build to be behind, so a null client build is not
   staleness: `isUpdateAvailable_` returns false and the footer reads `v… (server)` or
   `unbuilt (local)`.
6. **Every request carries the client build version** (`clientVersion: STATIC_BUILD_VERSION_` on
   every POST), so the *backend* can see which build is calling it. This is the half nobody asks
   for: without it, stale clients surface in support calls instead of in logs.

Requirements 1 and 5 are the page's own honesty; 2, 3 and 4 are the user-visible backstop for the
propagation window (see [`../gas-deployment/README.md`](../gas-deployment/README.md) §Propagation
is not atomic); 6 is the observability half.

---

## Details the first pass missed (fix up front, not as follow-ups)

None of these show up in a functional smoke test — the page works, it just doesn't behave like a
real page yet:

1. **Page `<title>`.** Unlike the GAS sandbox, `document.title` *can* be set client-side once
   identity resolves on a static page — but it's easy to forget, since the GAS version got it "for
   free" via `HtmlOutput.setTitle()` and the static source starts from a generic placeholder title.
2. **Favicon.** Browsers request a favicon independent of anything in the page's own `<head>`, so a
   missing one is easy to miss in casual testing. Static hosts don't synthesize a default the way a
   real domain with `favicon.ico` at its root would. Decide once where the canonical image lives
   and point every consumer at that single copy (see item 5).
3. **Bookmarkable URL after client-side identify.** The GAS page's real `<form>` POST navigation
   landed the address bar on a token'd `?id=` URL for free. A static page's identify call is always
   an async `fetch()` — nothing navigates, so nothing updates the address bar unless the client does
   it explicitly. Fix: once a typed-identify response resolves with a token,
   `history.replaceState(null, '', bookmarkUrl)` — not `pushState`, so it doesn't add a spurious
   back-button stop.
4. **CORS request shape.** `Content-Type: application/json` triggers a preflight `OPTIONS` that
   Apps Script's web app doesn't handle usefully; use `text/plain` and parse JSON server-side.
5. **Consolidate hosted assets to one canonical copy.** If the favicon needs external hosting for
   both `HtmlOutput.setFaviconUrl()` and the static page's own `<link rel="icon">`, don't point one
   at a raw file path in the main dev repo and the other at a local copy — that's two
   hand-maintained copies that can silently diverge. If the static-pages repo is generated-only and
   already published on every deploy, make the logo one of its generated assets (source under
   `static-pages/src/assets/`, copied into `dist/<env>/assets/` by the build step) and repoint both
   consumers at that one hosted copy.

---

## Storage persistence on iOS/Safari — a first-party-only benefit

Invisible to desktop-Chromium testing; it only manifests on iOS/Safari, and only after a week.

WebKit's Intelligent Tracking Prevention (ITP) puts a **7-day cap on all script-writable storage**
(`localStorage`, `IndexedDB`, client-set `document.cookie`) unless the user interacts with the site
as a first-party, top-level document — a tap or keystroke on the real page resets the clock.

- **In the `HtmlService` sandbox this cap was effectively unavoidable.** The served page lived in a
  nested cross-origin iframe; taps inside that frame don't count as first-party interaction with the
  app's origin, and since the top-level (Google-controlled) URL never changes, no top-level
  navigation ever "blessed" the storage either. The clock never resets no matter how often the app
  is actually used.
- **A static first-party page fixes the common case for free.** It *is* the top-level document, on
  a stable origin. Ordinary taps count as first-party interaction and reset the 7-day clock. Active
  users on a weekly-or-tighter cadence persist local storage indefinitely in practice; only
  genuinely lapsed users (no visit for >7 days) lose it, at the cost of one re-identify.
- **What the static move does *not* fix.** The 7-day cap on pure JS storage is a Safari policy that
  can't be removed client-side. The one storage class exempt from it is a server-set `HttpOnly`
  cookie — a purely static host has no server to issue one, and a cookie set by a cross-origin GAS
  backend is third-party from the page's perspective and gets blocked anyway. If surviving >7-day
  idle gaps is a hard requirement: accept the re-identify for lapsed users; front the static file
  with a host that can set a first-party cookie (Cloudflare Workers, Firebase Hosting + a function,
  Cloud Run), which means leaving pure static hosting; or lean on silent re-auth (Google One Tap
  auto-select re-establishes identity with no friction, which also resets the clock).

Match the expectation to the app's usage cadence; reach for a server-set cookie or silent re-auth
only if lapsed-user re-identify is genuinely unacceptable.

---

## What a first-party page unlocks next: identity & access control

*(The single biggest capability the migration makes available, and one that is impossible from
inside the `HtmlService` anonymous sandbox. Both models below are running in this estate; this
repo's own [`static/`](../../static/) demo implements model A end to end.)*

Under `ANYONE_ANONYMOUS`, an `HtmlService` web app knows nothing about who is visiting —
`Session.getActiveUser().getEmail()` returns `''`. A real first-party static page can run **Google
Identity Services (GIS)** and obtain a *verifiable* identity for the visitor, without asking the
visitor to grant the app any access to their data. Two concerns that are easy to conflate:

1. **What the backend is allowed to do = the app's *own* credentials — the visitor authorizes
   nothing.** A manifest of `executeAs: USER_DEPLOYING` + `access: ANYONE_ANONYMOUS` means every
   anonymous request already runs with the deploying owner's authority. Adding Drive/Calendar/Gmail
   scopes to the script lets the backend do anything the owner can, against the owner's own content
   — the owner authorized once, at deploy time; visitors grant nothing.
2. **Who the visitor is = a Google ID token (authentication only, no data access).** The static page
   runs GIS "Sign in with Google" / One Tap and receives a signed ID token (JWT) carrying `sub`
   (immutable per-account id), `email`, `email_verified`, `aud`, `iss`, `exp` — using only the
   non-sensitive `openid`/`email`/`profile` scopes. POST it to the GAS backend as a `text/plain`
   simple request (same CORS shape as every other call). The backend **verifies** it — at low volume
   the simplest route is `https://oauth2.googleapis.com/tokeninfo?id_token=…` via `UrlFetchApp`;
   higher volume warrants local JWKS/RS256 verification — checking `aud`/`iss`/`exp`, then keys on
   `sub` and applies your own allowlist (a Script Property or Config sheet).

**Why this avoids the "scary" Google friction entirely.** The consent screen, app verification, and
"Google hasn't verified this app" wall are triggered by an app *requesting access to the user's
data* (sensitive/restricted scopes). This model requests none of the visitor's data — it uses the
owner's own authority for the Google side and asks the visitor only to prove identity. Sign-in with
only `openid`/`email`/`profile` publishes to production self-serve, no review, no cap, no
unverified-app warning.

**Why not a service account.** A service account has its own Drive/Calendar and no Gmail at all; it
can only act as you via Workspace domain-wide delegation, which doesn't exist for a personal
`@gmail.com`. The `executeAs: USER_DEPLOYING` web app already gives the backend full
Gmail/Drive/Calendar as the owner with zero extra infrastructure.

### Two identity models — pick deliberately

The estate runs both. They differ in where verification happens and what the page holds between
visits, and that difference decides the per-request cost, the session length, and what "add a
second app" costs.

| | **A — direct GIS** | **B — brokered assertion** |
|---|---|---|
| Where | this repo's own [`static/`](../../static/) demo + [`gas-backend-example.js`](gas-backend-example.js) | `Static/pub/AS/index.html` → NUUC-Dispatch → GActionSheet |
| Flow | page gets a Google ID token → POSTs it to the app → app calls `tokeninfo` → checks `aud`/`iss`/`exp` → allowlist on `sub` | page gets an ID token → POSTs it to the **dispatcher** with a target `aud` → dispatcher verifies, returns an HS256 assertion (`iss`/`sub`/`email`/`aud`/`exp`, 45-day TTL) → page caches it → sends it to the target app, which verifies locally with a shared per-target secret |
| Per-request cost | one `UrlFetchApp` round trip to Google on every privileged call | HMAC only — no network call |
| Session length | Google ID token lifetime (~1 h) → re-prompt | 45 days, cached in `localStorage`, renewed by a normal sign-in near `exp` |
| Estate cost | one OAuth client ID + consent screen **per app** | one, shared; adding an app is a row in `ASSERTION_TARGETS` + a minted key |
| Failure posture | fail-closed on the `sub` allowlist | fail-closed (`tier: 'NONE'`), keyed on `sub`, `aud`-scoped so an assertion for one app is useless at another |
| Contract | this README | `NUUC-Dispatch/docs/interfaces/signed-identity-assertion.md`, its ADR-0002/0003 |

**B is the better architecture once there is more than one app:** it removes a Google round trip
from every privileged call, gives the iOS/Safari story a 45-day artifact instead of a 1-hour one
(see §"Storage persistence" above), and makes adding an app cheap. **A remains the right answer for
a single anonymous app with a small allowlist** — no dispatcher, no key distribution, no second
deployment.

Three weaknesses of B to fix before it spreads further — none is a reason not to use it, and all
three are cheaper to state now than to discover later:

1. **The verifier is copy-paste.** The reference implementation says so in its own comment: target
   apps copy it. That is duplication on the side that matters most — a verifier is security code,
   and a fail-open divergence in one copy is silent. It belongs in a shared GAS library
   (`libs/`), not in each app.
2. **HMAC is symmetric.** Every target app holds a key that can *mint* assertions for itself.
   Acceptable inside one owner's estate; state it as a limitation in the contract, and name the
   upgrade path (RS256 + a dispatcher-published JWKS route) rather than discovering it later.
3. **No revocation inside the 45-day window.** The only lever is rotating `kid`, which invalidates
   every session for that app at once. Fine for low-privilege tiers; pair a shorter TTL with any
   future tier that can destroy data.

### Consent-screen posture across the estate — three tiers, not two

"Does this app need a Google consent screen?" gets answered wrongly because two different things
both surface to a visitor as "Google sign-in". The distinction is **whose data the app asks for**,
and it decides whether Google review is involved at all:

| Tier | What the page holds | Consent screen | Google verification |
|---|---|---|---|
| **0 — anonymous** | nothing | none | none |
| **1 — authentication** — a GIS **ID token** over `openid`/`email`/`profile` | a signed assertion of *who* the visitor is; no access to their data | minimal, self-serve | **none** — these are non-sensitive scopes, publish to production with no review, no user cap, no unverified-app warning |
| **2 — authorization** — an OAuth **access token** for the visitor's own data (e.g. `drive.readonly`) | a credential that reads the visitor's Drive | required | **required** for sensitive/restricted scopes beyond a single Workspace domain — a review process measured in weeks. `drive.readonly` is *restricted*. An Internal consent screen avoids it but locks out everyone outside the org, personal `@gmail.com` accounts included |

Tier 2 is the only one with a real cost, and it is the only one that can answer "does **this
visitor** have access to **this file**". Tiers 0 and 1 cannot: under
`executeAs: USER_DEPLOYING`, every request reads Drive as the *owner*, so the app has no view of
the visitor's own permissions. A "you do not have access to this" message is a tier-2 feature.

**Posture is a per-project call, and worth stating per project so nobody infers a default:**

| Project | Tier | Note |
|---|---|---|
| **PracticeMix** | 0 | Deliberate — that repo's `adr/0008-no-oauth-consent-screen-for-practicemix.md`: it requests no visitor data, so it ships with no consent screen. Consequence accepted: audio for non-link-shared files stays on the server-side base64 path |
| **NUUC-Dispatch** | 1 | The dispatcher of model B above; a consent screen is acceptable here, and tier 1 needs no verification |
| **GActionSheet** | 1 (via B) | Consumes NUUC-Dispatch's assertion; holds no Google credential of its own |
| **GAS-Core `static/` demo** | 1 | Model A end to end, `openid`/`email`/`profile` only |
| **F3Go30, RankChoiceVoting** | 0 | Anonymous static pages today |

**The API-key question, because it is the one people reach for at tier 0.** A browser API key
(`…/drive/v3/files/<id>?alt=media&key=…`) is *not* a credential — it identifies a project for quota
and billing, is meant to be public, and should be restricted by HTTP referrer. It grants nothing:
it can read only a file that is **already readable by anyone with the link**. So it never widens
access, and it is never a way to reach a restricted file. Note also that the obvious download hosts
are not usable from a page: `drive.usercontent.google.com` answers `403` to any request carrying
`Sec-Fetch-Site: cross-site`, which every cross-origin browser fetch sends — `curl` sees `200` with
`Access-Control-Allow-Origin: *` and is a false positive. Only `www.googleapis.com/drive/v3` is
CORS-open. If you adopt the direct read, remember the consequence: **the file IDs then *are* the
access boundary**, so a later identity gate on the app is cosmetic for anyone who already has a
listing, unless the Drive sharing is tightened at the same time.

---

## The security boundary this creates — run this pre-flight before flipping the manifest

Because the backend runs with the owner's *full* authority for every anonymous request, the
app-level ACL is the entire security boundary. Design it default-deny: a request with no valid,
allowlisted, verified token gets only public actions; every privileged action requires a verified,
allowlisted `sub`. Verify the JWT (signature + `aud` + `iss` + `exp`) on every privileged call, or
verify once and bind the identity into an existing server session, and fail closed. Gate on `sub`,
not `email` (email can be reassigned, especially in Workspace). A bug here exposes the owner's
content — this is where test coverage belongs.

**`access: ANYONE` is doing more work than it looks like.** It is a weak gate ("must be *some*
signed-in Google account") outsourced to Google, and the whole static pattern requires removing it:
a cross-origin `fetch()` to an `ANYONE` deployment gets HTTP 401 and a sign-in page (Step 1). So
flipping the manifest to `ANYONE_ANONYMOUS` deletes the only gate some routes ever had — before
their own ACL exists.

**The named pre-flight check — do this before the flip, not after:**

1. **Enumerate every route that returns a token or a credential.** Not every route that *looks*
   privileged: every route whose response body could carry one.
2. **Prefer removal to gating.** A gate is code that must stay correct forever; a deleted route
   cannot lapse. PracticeMix built the identity gate, deployed it, and then *removed* the two routes
   instead — cheaper, needed no sign-in, and put no new friction in front of its users.
3. **Close the `google.script.run` door too.** Removing a route from the API action map is *not*
   enough while the `HtmlService` page is still deployed. Every server function that page can call
   is reachable through `google.script.run`, which does not go through the API dispatcher at all.
   Delete the function itself, and leave a comment where it was saying why it must not come back.
4. **Re-verify anonymously, from outside.** After the flip, call every route with no session, no
   cookies and no browser, and grep every response body for token shapes (`ya29`, `"token"`).
   A route that answers `unknown_action` to an anonymous caller is the evidence; a route that
   answers correctly *for you* proves nothing, because you are signed in.

**The worked example, because it generalises.** PracticeMix exposed a `getOAuthToken()` route
returning `ScriptApp.getOAuthToken()`. Under `executeAs: USER_DEPLOYING` that is the **owner's**
token — and because one unrelated logging module called `DriveApp.getRootFolder()`, the script's
inferred scope was the broad `…/auth/drive`, so the token carried full read/write access to the
owner's *entire* Drive for ~1 hour. `access: ANYONE` was the only thing between that and the open
internet. **A route's danger is set by the script's inferred OAuth scope, not by what the route
appears to do** — one call in a file nobody was looking at widened "a token" into "the owner's whole
Drive".

---

## Constraints and Trade-offs

| Concern | Detail |
|---|---|
| **Manual sync points** | No shared build step between the GAS include and the static page's inlined copy of it — grep both periodically for drift. |
| **CORS preflight** | Must use `text/plain` POST bodies; `application/json` triggers an `OPTIONS` preflight Apps Script doesn't handle usefully. |
| **No server-side templating** | Every value the old page got "for free" via `<?= ... ?>` or `doGet`'s request access must be re-routed through the static page's own URL query string or an API response payload. |
| **Favicon hosting** | `HtmlOutput.setFaviconUrl()` and the static page's own `<link rel="icon">` need one canonical externally-hosted image — clasp has no static binary-asset hosting. |
| **iOS/Safari 7-day storage cap** | First-party hosting resets the clock on every visit but does not remove the cap; lapsed users (>7 days idle) still lose client-side storage. |
| **Full backend authority per anonymous request** | Under `executeAs: USER_DEPLOYING` + `ANYONE_ANONYMOUS`, the app-level ACL is the *entire* security boundary if any privileged (Drive/Calendar/Gmail) action is added — default-deny and fail closed. |
| **Two front ends to keep in parity** | Route new config through existing shared endpoints, not new ones, so payloads can't drift by hand-maintenance error. |
| **Binary payloads round-trip through the server** | Once the raw-token routes are gone (see the pre-flight check above), file bytes come back through the backend as base64. Measured in PracticeMix on live TEST, cold context: 0.09 MB → 1386 ms, 0.12 MB → 1613 ms, 0.24 MB → 2015 ms, with decode flat at ~120–150 ms throughout — the *server round trip* dominates completely. Base64 also inflates the payload ~33 %, and `getFileAsBase64` hard-fails above 50 MB. This is the honest price of "no raw token on the wire"; if the content is link-shared, a client-side read by file ID is the cheaper path, and the file IDs then *are* the access boundary. |

---

## What you get

**Measured, twice, on two independent migrations.** PracticeMix's is the more rigorous of the two —
5 cold browser contexts per front end against one live TEST deployment, both front ends served by
the same backend at the same moment:

| Front end | App visible | FCP | Transferred |
|---|---|---|---|
| `HtmlService` | **4213 ms** | n/a | 282 KB |
| static | **116 ms** | 160 ms | 43 KB |

**≈36× faster to first app paint, on ≈6.6× fewer bytes** — and the gap widens on a revisit the
measurement does not show, because the static page is served `cache-control: max-age=600` + an ETag
while `HtmlService` re-ships its ~150 KB inline on every load, uncached.

**The method matters as much as the number, because the obvious metrics are unavailable:**

- **"App visible" (navigationStart → the first real app element being visible) is the only metric
  comparable across the two front ends.** The `HtmlService` top document reports **no paint entry at
  all** — its visible pixels are composited by a cross-origin iframe whose timeline the top frame
  cannot read. FCP therefore exists for the static page and does not exist for the GAS one; quoting
  FCP alone would be comparing a number against a blank.
- **Count bytes over CDP `Network.loadingFinished`, not `content-length`**, for the same reason:
  the sandboxed iframe's own subresources never appear in the top document's resource timing.
- Take **several cold contexts per front end**, not one — the GAS side includes a cold-start path
  whose variance is the whole point of averaging.

F3Go30's earlier, independent measurement of the same pattern: **~100× faster first paint** —
~18 ms shell commit / ~30 ms `domcontentloaded` vs. ~3.3 s first byte / ~4.5 s `networkidle` for the
equivalent GAS page, same network, same machine.

Beyond the numbers:

- **No Google chrome above the page** — the static page is a normal top-level document.
- **Zero server-side risk to the existing page** — the `HtmlService` page needs no modification
  beyond one additive shared config helper; the two front ends can run side by side indefinitely, or
  the old one can be retired later on its own schedule.
- **A CDN-hosted static file** in front of Apps Script's execution quota/cold-start path for
  everything that doesn't need live data — only actual identify/data calls still pay a server round
  trip.

---

## Checklist for the next project

- [ ] Spike CORS live, from a real cross-origin static serve, against the actual web app — before
      porting anything. Use `text/plain` POST bodies.
- [ ] Identify every value the old page got via server-side templating or `doGet`'s request access;
      route each one through either the static page's own URL query string or an existing API
      response's payload (extend, don't fork, an existing endpoint's response shape).
- [ ] Hand-port HTML/CSS/JS keeping DOM ids/classes identical, so existing tests carry over.
- [ ] Move identity/data resolution to a client-side call fired immediately on load; render a brief
      loading state for the gap.
- [ ] Set `<title>` client-side once identity resolves.
- [ ] Add a `<link rel="icon">`, pointed at one canonical hosted image location.
- [ ] If identify can happen via a client-side form (not just a pre-existing token in the URL),
      `history.replaceState` a bookmarkable URL once it resolves.
- [ ] Build to per-environment output with a stamped version; keep the source file
      environment-agnostic.
- [ ] Publish to a dedicated static-only repo/host, not the main dev repo's own Pages config.
- [ ] Chain the publish step into the existing deploy automation, sharing one version/build counter
      — don't make it a separately-run, separately-versioned step.
- [ ] Add a regression test that exercises the static page from a genuinely different origin against
      a live deployment, plus a "the original GAS page still works" guard in the same suite.
- [ ] **iOS/Safari storage:** confirm any saved-identity token / bookmark in `localStorage` survives
      on a real iOS device across the app's usage cadence; validate the lapsed-user (>7-day idle)
      path re-identifies cleanly rather than erroring.
- [ ] **If gating operations by identity:** obtain a Google ID token client-side via GIS (only
      `openid`/`email`/`profile`), POST it `text/plain`, verify it server-side (`aud`/`iss`/`exp`,
      key on `sub`) before applying an allowlist. Keep the backend's Google authority as the app's
      own credentials — never request the visitor's data scopes. Treat the app-level ACL as the
      whole security boundary: default-deny, fail closed, concentrate tests there.
