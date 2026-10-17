# Best Practice: WebApp Admin Routes with a Set-Once Shared Secret

> **Proposed change:** this folder's `Admin.js` is currently a *copy-me* file, which is a drift
> source — five projects now run five variants of this gate. See
> [`../gas-deployment/RECOMMENDATION-declared-config.md`](../gas-deployment/RECOMMENDATION-declared-config.md)
> for the proposed `libs/LibAdmin` with a declared `ungatedActions` list (which is what keeps
> RankChoiceVoting's `setWebappUrl` first-deploy exemption expressible without a fork).

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
(`WEBAPP_SECRET` payload gate in `src/WebApp.js`). `Admin.js` in this folder is the merged
best version across all three: NUUC-Dispatch's shape plus GActionSheet's route-table
`'adminSecret'` gate-class convention and its `getScriptProperties` diagnostic, ported
into [NUUTS-Shell](../../../../proj/NUUTS-Shell) (`src/Admin.js`) — the current worked
example of standing this pattern up on a brand-new script project from zero, including the
deploy-time self-bootstrap hook (§Deploy-time self-bootstrap below).

## Minimum core admin/diagnostic surface

Every GAS web app in this pattern starts with these five routes — this is the deliberately
small "day one" surface a new script project should ship with, not an exhaustive admin API:

| Route | Gate | Why it earns a place here |
|---|---|---|
| `version` (`cmd=version`, not `cmd=admin`) | open | Ahead of every gate, including `adminSecret` — the deploy pipeline polls it before any secret exists to prove the /exec URL is serving the build just pushed. See `gas-deployment/README.md` §Deploy verification. |
| `bootstrapSecret` | **open, set-once** | The one ungated door — see below. Without it, a fresh script project has no scriptable way to ever gate anything. |
| `setScriptProperties` | `adminSecret` | The only way any OTHER Script Property (starting with the production `WEBAPP_SECRET`-style gate) gets set. Logs key names only, never values. |
| `getScriptProperties` | `adminSecret` | Returns key NAMES only, never values. This is what makes config drift diagnosable ("is `WEBAPP_SECRET` actually set on this deployment?") without a second unauthenticated read surface. |
| `getAuthInfo` | `adminSecret` | Runtime diagnostic: effective user + the real granted OAuth scopes (`ScriptApp.getOAuthToken()` → tokeninfo), not the manifest's declared `oauthScopes`. The function that tells you a scope was silently dropped from the consent grant. |

## The one-ungated-door rule

`bootstrapSecret` is the **only** route reachable with no credential, and it sets
`ADMIN_SHARED_SECRET` **only** — never `WEBAPP_SECRET` or any other property. A
per-property bootstrap (e.g. a second ungated route to set `WEBAPP_SECRET` directly) was
considered and rejected: it widens the anonymous attack surface for every property added,
where one door does not. Once `ADMIN_SHARED_SECRET` exists, every other Script Property —
`WEBAPP_SECRET` included — is set through the admin-gated `setScriptProperties`. Do not
"improve" this back to per-property bootstrap routes; if a new project's first instinct is
to add one, that instinct is what this rule exists to stop.

## Deploy-time self-bootstrap

A brand-new script project has neither secret set, so every deploy hook that needs
`WEBAPP_SECRET` (registering the webapp URL, a test token, Axiom config, config
verification, …) returns `{"ok":false,"error":"unauthorized"}` and is stuck — there is no
human step that unblocks it except hand-editing Script Properties in the editor, which is
exactly what this pattern exists to avoid.

**The non-obvious part is hook ordering.** Add one `postDeploy` hook that (1) calls
`bootstrapSecret` with the locally-held `adminSecret` (treating `already_bootstrapped` as
success — every deploy after the first hits this), then (2) calls `setScriptProperties` to
set `WEBAPP_SECRET` from the locally-held `webappSecret` — and wire it **first**, before
any other hook that needs `WEBAPP_SECRET`. NUUTS-Shell's worked example:
`scripts/deploy-hooks.js`'s `registerAdminBootstrap`, wired in `manage-deployments.js`'s
`postDeploy` list ahead of `Register WEBAPP_URL` (the first hook that needs the secret).
Never print a secret VALUE to stdout from this hook — only `ok`/`error` and, at most, which
key names were set.

## Never log or return secret values

No route in `Admin.js`, and no deploy hook that calls it, ever logs or returns a Script
Property *value* — only key names (`setScriptProperties`/`getScriptProperties`) or OAuth
scope strings (`getAuthInfo`, never the raw token). This is enforced by convention, not by
a framework guarantee — keep new admin routes to that same shape.

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
├─ action == getScriptProperties ────────►  (diagnostic: key NAMES only, never values)
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
   pnpm run admin -- getScriptProperties
   pnpm run admin -- getAuthInfo
   ```
6. Wire the deploy-time self-bootstrap hook (§Deploy-time self-bootstrap above) so step 4
   never has to be a manual one-off again after a fresh script project stand-up.

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
