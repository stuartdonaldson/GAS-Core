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

*(Forward-looking architecture — feasible on any real first-party page, validated but not yet built
in the source project. Included because it's the single biggest capability the migration makes
available, and it's impossible from inside the `HtmlService` anonymous sandbox.)*

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

**The security boundary this creates — concentrate testing here.** Because the backend runs with
the owner's *full* authority for every anonymous request, the app-level ACL is the entire security
boundary. Design it default-deny: a request with no valid, allowlisted, verified token gets only
public actions; every privileged action requires a verified, allowlisted `sub`. Verify the JWT
(signature + `aud` + `iss` + `exp`) on every privileged call, or verify once and bind the identity
into an existing server session, and fail closed. Gate on `sub`, not `email` (email can be
reassigned, especially in Workspace). A bug here exposes the owner's content — this is where test
coverage belongs.

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

---

## What you get (F3Go30 numbers)

- **~100x faster first paint**: ~18ms shell commit / ~30ms `domcontentloaded` vs. ~3.3s first byte
  / ~4.5s `networkidle` for the equivalent GAS page, same network, same machine.
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
