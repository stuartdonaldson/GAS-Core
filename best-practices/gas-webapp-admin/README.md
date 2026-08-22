# Best Practice: WebApp Admin Routes with a Set-Once Shared Secret

## Overview

A GAS web app often needs one-off operator actions — setting Script Properties, storing
API tokens, running maintenance functions — that would otherwise be done by hand in the
Apps Script editor UI. This pattern adds a `cmd=admin` route to the web app, gated by a
shared secret that is **bootstrapped exactly once over the wire and never typed into the
editor**, plus a local CLI tool that owns all the call boilerplate (deployment URL,
secret injection, payload shape), so an admin operation is a one-line command.

**Use when:** A GAS web app needs scriptable operator/deployment actions (Script
Properties, config pushes, diagnostics) and you want them repeatable from the shell and
from deploy tooling rather than clicked through the editor UI.

**Provenance:** Originated in [F3Go30](../../../../proj/F3Go30) (`script/WebApp.js`
`handleAdminPost_`, `tools/callWebapp.js`); adopted and refined by
[NUUC-Dispatch](../../../../proj/NUUC-Dispatch) (`src/Admin.js`, `tools/call-webapp.js`)
— second use is what elevated it here. GActionSheet uses a sibling variant
(`WEBAPP_SECRET` payload gate in `src/WebApp.js`). `Admin.js` in this folder is a copy of
NUUC-Dispatch's GAS-side implementation (the most current).

> **The CLI caller shown below is no longer a per-project hand-roll.** The five projects that
> originally each built one from scratch (`tools/callWebapp.js` / `tools/call-webapp.js` /
> `scripts/call_webapp.py`) are now thin wrappers over the shared `gas-deploy` package's
> `bin/call-webapp.js` — see [`gas-deployment/README.md` §The webapp
> caller](../gas-deployment/README.md#the-webapp-caller) for the current, recommended shape and
> a worked config. This folder no longer ships its own copy of the caller; only `Admin.js` (the
> GAS-side route, which stays project-specific) lives here now.

---

## Problem

Script Properties and other operator state can only be set by hand in the Apps Script
editor UI, which:

- is not scriptable — deploy pipelines can't set tokens/config as a step;
- is error-prone — secrets get pasted into the wrong field, or typo'd invisibly;
- leaves no audit trail of what changed when;
- tempts every session to reconstruct ad-hoc `curl` calls against a deployment URL that
  should live in exactly one local place.

---

## Architecture

```
local.settings.json (gitignored)          tools/call-webapp.js (gas-deploy/bin/call-webapp.js)
├─ testDeploymentId ──────────────────────►  resolves the /exec URL from the LIVE deployment
├─ prodDeploymentId                          list by --env test|sit|prod (ID here is a fallback)
└─ adminSecret     ──────┐                  injects adminSecret into payload for cmd=admin only
                         │                  POSTs text/plain JSON, follows GAS 302
                         ▼
    POST {url}?cmd=admin  { action, adminSecret, ...body }
                         │
                         ▼
src/Admin.js  _handleAdminPost(e)          Script Properties
├─ action == bootstrapSecret ────────────►  ADMIN_SHARED_SECRET (set once, refuses re-run)
├─ adminSecret !== stored → forbidden
├─ action == setScriptProperties ────────►  any key/value pairs
└─ action == getAuthInfo ────────────────►  (diagnostic: effective user + real token scopes)
```

**Key principles:**

- **Set-once bootstrap.** `bootstrapSecret` stores `ADMIN_SHARED_SECRET` only if it is
  not already set (`already_bootstrapped` otherwise). The secret is generated locally
  (`crypto.randomBytes`), saved in `local.settings.json`, and sent once over HTTPS — it
  is never typed into the editor UI, never committed, never in a URL.
- **Secret travels in the POST body, never the query string** — keeps it out of access
  logs and shell history.
- **The CLI tool is the only place the deployment URL lives locally.** Never hand-build
  `curl` calls against `/exec` URLs; `call-webapp.js` reads everything from
  `local.settings.json`.
- **`text/plain` body** keeps calls CORS-simple and matches how GAS web apps want to
  receive JSON; the tool also follows GAS's 302-to-GET redirect dance.
- **Shared Script Properties store.** TEST and PROD deployments of the same script
  project share one `PropertiesService` store — `--env` picks which URL receives the
  call, not which properties get set. Bootstrap once, not per environment.
  (F3Go30 differs: its TEST is a separate spreadsheet-bound copy, so it keys separate
  deployment ids *and* separate secrets per env — see `ENV_MAP` in its `callWebapp.js`.)

---

## Files

| File | Role |
|---|---|
| `Admin.js` | GAS-side: `_handleAdminPost(e)` dispatcher + `_bootstrapAdminSecret`. Wire into `doPost`: `if (e.parameter.cmd === 'admin') return _handleAdminPost(e);` |
| `local.settings.example.json` | Template for the gitignored `local.settings.json` — note it stores bare deployment IDs (`testDeploymentId`/`prodDeploymentId`), never full `/exec` URLs; see the note below on why. |

The CLI caller is **not** copied from this folder — see the note above. It is a ~15-line wrapper
over `gas-deploy/bin/call-webapp.js`, configured with this project's `envMap`/`authField`/
`securedCmds`; a complete worked example is in
[`gas-deployment/README.md` §The webapp caller](../gas-deployment/README.md#the-webapp-caller).

---

## Setup

1. Copy `Admin.js` into `src/`, add the `cmd=admin` branch to `doPost`, deploy.
2. Add `tools/call-webapp.js` per the worked example linked above (`envMap` needs
   `scriptIdKey`/`anchor`/`deploymentIdKey`/`secretKey` per target, `authField: 'adminSecret'`,
   `securedCmds: ['admin']` — the last one is what keeps the secret out of any `cmd=version`
   request); add a pnpm script: `"admin": "node tools/call-webapp.js"`.
3. Create `local.settings.json` from `local.settings.example.json`; fill in `scriptId`. The
   deployment IDs are populated automatically by `gas-deploy`'s `deploy()` after your first deploy
   of each target (its `deploymentIdKey` mechanism) — you don't need to hand-copy them from
   `clasp deployments`.
4. Generate and bootstrap the secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   # save output as adminSecret in local.settings.json, then:
   pnpm run admin -- bootstrapSecret --body '{"secret":"<that value>"}'
   ```
5. Use it:
   ```bash
   pnpm run admin -- setScriptProperties --body '{"properties":{"SOME_TOKEN":"..."}}'
   pnpm run admin -- getAuthInfo
   ```

---

## The `getAuthInfo` diagnostic

Returns the effective user the web app runs as and the **actual OAuth scopes of its
runtime token** (looked up live against Google's tokeninfo endpoint server-side; the
raw token is never returned). This exists because a deployment's real granted scopes
can silently differ from the manifest's `oauthScopes` — see the sensitive-scope
authorization gotcha noted in the Best Practices index (NUUC-Dispatch
`docs/OPERATIONS.md` §Initial provisioning / §Failure Modes for the full story). When a
GAS service call fails with "You do not have permission", `getAuthInfo` gives ground
truth in one command.

---

## Trade-offs

- **A bearer secret, not per-user auth.** Anyone holding `local.settings.json` can run
  admin actions. Acceptable for single-operator projects; for team settings, rotate by
  clearing `ADMIN_SHARED_SECRET` in the editor once and re-bootstrapping.
- **`bootstrapSecret` is unauthenticated by design** (first-caller-wins). Deploy and
  bootstrap in the same sitting; the window where an unbootstrapped admin route is
  exposed should be minutes, not days.
- **GActionSheet variant:** if the project already has a `WEBAPP_SECRET`-style payload
  gate, extending that is fine — the distinguishing features worth keeping from this
  pattern are the set-once wire bootstrap and the CLI tool owning the boilerplate.
