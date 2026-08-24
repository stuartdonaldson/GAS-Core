# Demo Configuration Reference

Factored-out setup steps shared across multiple demos/best-practices. Each surface or feature in
[`demo-surface-matrix.md`](demo-surface-matrix.md) links here for whichever of these it needs,
instead of repeating the steps inline. Update in place; the matrix links by anchor (`#anchor`), so
keep headings stable.

---

## clasp project setup

Needed by: every bound-script or standalone-webapp surface (Sheet menu/sidebar, Doc menu, any
`doGet`/`doPost` webapp). **Not** needed by static-HTML surfaces on their own (only their backend).

```bash
npm install -g @google/clasp
clasp login                      # once per machine, interactive OAuth
clasp create --type webapp --title "<name>" --rootDir .   # or --type sheet / --type docs
```

`clasp create` writes its own `appsscript.json` — for anything meant to be reachable via `doGet`/
`doPost`, merge in (or overwrite with) a `webapp` block:

```json
{
  "webapp": { "access": "ANYONE_ANONYMOUS", "executeAs": "USER_DEPLOYING" }
}
```

`access` controls who may call it without signing in; `executeAs` controls whose Google identity
the code runs with (`USER_DEPLOYING` = the owner's authority for every request — see
[Anonymous webapp identity model](#anonymous-webapp-identity-model) below). Push and deploy:

```bash
clasp push -f      # -f: skip the interactive manifest-overwrite prompt (needed non-interactively)
clasp deploy -d "<description>"
clasp deployments   # lists deployment ids; the one that is NOT "@HEAD" is the live /exec target
```

Web app URL format: `https://script.google.com/macros/s/<deploymentId>/exec`.

---

## Anonymous webapp identity model

Needed by: any `ANYONE_ANONYMOUS` webapp that also needs to know *who* is calling (not just run
anonymously) — currently only `gas-static-frontend`'s `whoami` action.

Two concerns that are easy to conflate:

1. **What the backend is allowed to do** — the app's own credentials. `executeAs: USER_DEPLOYING`
   means every request, including anonymous ones, runs with the *deploying owner's* authority.
   Visitors grant nothing; the owner authorized once, at deploy time.
2. **Who the visitor is** — requires a separate, explicit step (see
   [GIS OAuth client ID](#gis-oauth-client-id-sign-in) below); it does not come from `executeAs` or
   from the webapp manifest at all.

See `best-practices/gas-static-frontend/README.md`'s "identity & access control" section for the
full rationale.

---

## GIS OAuth client ID (sign-in)

Needed by: any surface that authenticates the *visitor* (not the script's own authority) —
currently only `gas-static-frontend`'s sign-in card. Uses only non-sensitive
`openid`/`email`/`profile` scopes, so it needs no Google app review or "unverified app" warning.

1. [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   — select the project `clasp create` used (`clasp open-credentials-setup` opens it directly), or
   any other GCP project.
2. If prompted, configure the OAuth consent screen first: **External**, any app name, default
   scopes (don't add sensitive/restricted scopes here — none are needed).
3. **Create Credentials → OAuth client ID → Application type: Web application.**
4. Under **Authorized JavaScript origins**, add the exact origin serving the client page (e.g.
   `https://stuartdonaldson.github.io`, or `http://localhost:<port>` for local testing).
5. Copy the client ID into the client page's config field / `GOOGLE_CLIENT_ID` constant.
6. Server side, verify the ID token before trusting it (`tokeninfo` endpoint or local JWKS) — see
   `gas-backend-example.js`'s `verifyGoogleIdToken_()`. Never trust a client-side JWT decode for
   anything privileged; it's display-only.

---

## Script Properties

Needed by: any server-side config that must not be hardcoded (secrets, allowlists, feature
toggles) — e.g. `gas-static-frontend`'s `GIS_CLIENT_ID`/`GIS_ALLOWLIST_SUBS`,
`gas-server-logging`'s `AXIOM_TOKEN`/`AXIOM_DATASET`.

```bash
clasp open-script   # opens the Apps Script editor
```
Project Settings (gear icon) → **Script Properties** → add key/value pairs. Read them at runtime
via `PropertiesService.getScriptProperties().getProperty('KEY')`. Never commit real values —
`appsscript.json.example` files and `.example`-suffixed configs in this repo are placeholders by
convention; real Script Properties are set per-deployment, out of git entirely.

---

## OAuth scopes for calling REST APIs

Needed by: any server-side code that calls an external HTTP API via `UrlFetchApp` — whether that
API is a third-party REST service, an unauthenticated public endpoint, or a Google API called
directly over HTTP rather than through a built-in GAS service class.

**No demo in this repo currently exercises the OAuth-bearer-token case below — this is a
documented gap, not just an undocumented existing feature.** The two `UrlFetchApp` calls that do
exist (`AxiomLogger.js`, `gas-backend-example.js`'s `tokeninfo` check) are both the simplest case
(1) and need nothing beyond what's automatic.

### 1. Calling any external URL at all (API key or no auth)

Needs no manual scope configuration. The moment your code calls `UrlFetchApp.fetch()` anywhere,
GAS's automatic scope detection adds `https://www.googleapis.com/auth/script.external_request` to
what it requests at authorization time — this is what lets `AxiomLogger.js` POST to Axiom (API key
in a header) and `gas-backend-example.js` call Google's public `tokeninfo` endpoint (no auth at
all) with zero manifest changes.

### 2. Calling a Google REST API that requires the *script's own* OAuth identity

Use when a Google API has no built-in GAS service class (or you need a REST call the class
doesn't expose) but you want the script's own authority (`executeAs`'s identity), not a
visitor's.

1. Add the specific scope to `appsscript.json`'s `oauthScopes` array, e.g.:
   ```json
   { "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets"] }
   ```
   **Warning:** the moment `oauthScopes` is present at all, GAS's automatic detection is
   *disabled* — only the scopes you list are requested. An incomplete list fails at authorization
   or at call time with a permission error, not a manifest error, so double-check every scope your
   code actually needs is listed (including `script.external_request` itself, if you're mixing
   this with plain `UrlFetchApp` calls per case 1).
2. At runtime, obtain a bearer token for the *script's own* identity:
   ```js
   var token = ScriptApp.getOAuthToken();
   UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
   ```
3. Reauthorize the deployment once after adding scopes (owner must re-consent) — `clasp push`
   alone does not trigger this; opening the script and running any function manually will prompt
   it, or a fresh `clasp deploy` will surface it on first live call.

### 3. Calling a Google REST API via a generated client instead of raw HTTP

Prefer this over case 2 when a first-party "Advanced Service" wrapper exists (Sheets API v4,
Drive API v3, etc.) — it generates typed methods (e.g. `Sheets.Spreadsheets.get(id)`) and manages
the scope for you.

1. `appsscript.json`:
   ```json
   { "dependencies": { "enabledAdvancedServices": [
     { "userSymbol": "Sheets", "serviceId": "sheets", "version": "v4" }
   ] } }
   ```
2. Enable the matching API in the script's linked GCP project (Apps Script editor → Services → **+
   Add a service**, or GCP Console → APIs & Services → Library → enable it there if you manage the
   GCP project directly). Both steps are required — the manifest entry alone doesn't enable the
   API on the project side.
3. No manual `Authorization` header — call the generated client directly; it authenticates with
   the script's identity automatically.

### 4. Calling *your own* backend with a visitor's identity, not the script's

This is not a REST-API-scope question at all — it's the [GIS sign-in](#gis-oauth-client-id-sign-in)
flow. Don't reach for `oauthScopes`/`ScriptApp.getOAuthToken()` here; those authenticate the
*script*, never the visitor.

---

## Static hosting publish (GitHub Pages)

Needed by: `gas-static-frontend`'s live demo only (`static/`).

Already wired for this repo: `.github/workflows/deploy-pages.yml` deploys `static/` to
`https://stuartdonaldson.github.io/GAS-Core/` on every push to `master` that touches that folder.
For a *new* project doing this pattern, see `gas-static-frontend/README.md` Step 5 — prefer
publishing to a dedicated static-only repo, not the main dev repo's own Pages config, so the
static page's release cadence isn't coupled to every unrelated push.

---

## Host provisioning (`push-demo.sh` harness only)

Needed by: any demo pushed via `scripts/push-demo.sh` (currently `libsheets-basic`,
`libsheets-with-notifications`) — **not** relevant to standalone webapps or static-frontend
demos, which manage their own `clasp` project directly.

Container ids + script ids for the harness's reusable hosts live in `libs/harness-hosts.json`,
keyed by kind (`sheet`, `doc`, `standalone`). Currently only `sheetScriptId`/`sheetId` are
populated; `doc`/`standalone` are empty stubs — provision them only when a concrete demo needs
that container kind, not speculatively. See `docs/test-harness-design.md` §4.1.
