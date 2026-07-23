# Best Practice: GAS Web App Deployment Management

## Overview

> **See also:** [`gas-cm-and-deployment/`](../gas-cm-and-deployment/README.md) for the full configuration management pattern that builds on this one — adds `npm version` governance, git tags, a post-release bump convention, and single-command release scripts.

Google Apps Script web apps are published at stable URLs. Each `clasp deploy` creates a new immutable numbered version of the code without changing the URL. This pattern maintains two stable named deployments (TEST and PROD) that can be redeployed in place using an interactive Node.js script, and stamps build metadata into the app at deploy time.

**Use when:** You have a GAS web app that needs separate TEST and PROD environments with repeatable, auditable deployments.

**Provenance:** Extracted from [AudioTrackCombiner](../../../../c-dev/AudioTrackCombiner). Reference files in that project:
- `manage-deployments.js` — the full deployment manager script
- `update-revision.js` — build date/time stamping
- `src/appsscript.json` — example `webapp` section configuration
- `src/version.html` — example version token format
- `src/.deploy-config.json` — fallback deployment ID for auth setup

---

## Deployment Models: One Script Project vs Two

*(Fresh capture 2026-07-22 from NUUC-Dispatch/F3Go30/GActionSheet experience — refine as
more projects exercise it.)*

Two distinct models for separating TEST/SIT from PROD exist across active projects.
The rest of this document describes the mechanics of **Model A**; choose deliberately
before provisioning, because the choice is driven by constraints, not preference.

### Model A — single script project, named deployments

One script project; `TEST-WEB-APP` and `PROD-WEB-APP` deployments created **once** in
the editor with the anchor string in their descriptions, then forever **redeployed in
place** (`clasp deploy -i <id>`) so both `/exec` URLs stay stable. The description
anchor is the discovery key — no config file of deployment ids.

- **Used by:** AudioTrackCombiner, GActionSheet, NUUC-Dispatch.
- **Everything is shared between envs:** one Script Properties store, one GCP project
  binding, one OAuth consent screen, one quota pool. TEST and PROD differ only in which
  immutable code *version* their deployment pins.
- **Consequences:** env-specific config must be modeled inside the shared properties
  store (or avoided); a runaway TEST can consume PROD's quota; but provisioning happens
  once, and code cannot drift between envs — they are versions of the same project.

### Model B — two script projects (prod + sit/test)

Fully separate script projects per environment: separate script ids, deployments,
Script Properties, triggers, and (the usual driver) separate **bound containers**.
Tooling must key everything per env — see F3Go30's `tools/callWebapp.js` `ENV_MAP`
(`testDeploymentId`/`templateDeploymentId` + a **separate admin secret per env**).

- **Used by:** F3Go30.
- **Why F3Go30 had no choice:** the production script is bound to a production
  spreadsheet; SIT needs its own spreadsheet, and a container-bound script belongs to
  exactly one container → separate project per env.
- **Consequences:** true isolation (data, properties, quotas, blast radius), at the
  cost of provisioning everything twice (GCP binding, consent screen, scopes,
  deployments) and a standing config-drift risk between the two projects.

### Decision drivers

| Driver | Pushes toward |
|---|---|
| Script is **container-bound** and envs need different containers (spreadsheet/doc/form) | **Model B** — forced; a bound script has exactly one container |
| Project is a **Workspace add-on / Marketplace app** | **Model A** — the Marketplace SDK is one-per-GCP-project and a second add-on doubles consent-screen/listing overhead; GActionSheet would *ideally* isolate as Model B but went Model A for this reason, accepting the GCP-coordinated test/prod deployment discipline |
| Envs need isolated **Script Properties / triggers / quota** | Model B |
| Minimal provisioning + zero code-drift risk between envs | Model A |
| Standalone web app with no bound container | Model A unless an isolation driver above applies |

---

## Problem

`clasp deploy` without arguments creates a new deployment with a new URL each time. Sharing a stable URL (e.g. with testers or embedded in other systems) requires keeping a specific deployment ID and redeploying to it in place. Doing this manually in the Apps Script editor is error-prone and leaves no audit trail. Additionally, without a version stamp, it is impossible to tell from the running app which code version is deployed.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js** | v16+ |
| **clasp** | `npm install -g @google/clasp`; must be authenticated (`clasp login`) |
| **@inquirer/prompts** | `npm install @inquirer/prompts`; powers the interactive menu |
| **Google Apps Script project** | Must have a `webapp` section in `appsscript.json` (see setup) |
| **Two existing deployments** | `TEST-WEB-APP` and `PROD-WEB-APP` must be created once in the Apps Script editor before the script can manage them |

---

## Architecture

```
src/                         clasp push          Apps Script project
├─ Code.js                ─────────────────────► (latest HEAD)
├─ index.html                                         │
├─ appsscript.json                                    │ clasp deploy -i <ID>
└─ version.html ◄── update-revision.js                │
                    (stamps build date/time)           ▼
                                              Deployment version N
                                              ├─ TEST-WEB-APP  → /exec (stable URL)
                                              └─ PROD-WEB-APP  → /exec (stable URL)
```

**Key principles:**
- Deployment IDs are **stable** — the URL never changes when you redeploy
- `clasp deploy -i <EXISTING_ID>` advances the version number but keeps the same URL
- Each deploy has a **description anchor** (`TEST-WEB-APP` / `PROD-WEB-APP`) used to discover the deployment ID at runtime — no config file of IDs needed
- The script never creates new deployments; new URLs must be deliberate

---

## Deployment Script Usage

```bash
npm run manage-deployments          # interactive menu
npm run manage-deployments -- --deploy-test    # non-interactive TEST deploy
npm run manage-deployments -- --deploy-prod    # non-interactive PROD deploy
npm run manage-deployments -- --manage         # list / archive old deployments
```

Each deploy:
1. Stamps current date/time into `src/version.html` via `update-revision.js`
2. Pushes `src/` to Apps Script via `clasp push -f`
3. Creates a new version and repoints the named deployment via `clasp deploy -i <ID>`

---

## One-Time Setup

### 1. appsscript.json — must include webapp section

```json
{
  "webapp": {
    "access": "ANYONE",
    "executeAs": "USER_DEPLOYING"
  },
  "runtimeVersion": "V8"
}
```

Without `webapp`, `clasp deploy -i` will silently convert the deployment to a library and the `/exec` URL will 404.

### 2. Create named deployments once in the Apps Script editor

In the Apps Script editor, create two Web App deployments manually:
- **Description:** `TEST-WEB-APP` (exact string)
- **Description:** `PROD-WEB-APP` (exact string)

The script discovers them by searching `clasp deployments` output for these strings. Creating named deployments manually is intentional — it forces a deliberate decision when a new stable URL is needed.

### 3. Install dependencies

```bash
npm install @inquirer/prompts
```

### 4. Version file (optional)

Create `src/version.html` with version tokens:

```html
<script>
  const APP_INFO = {
    version: "v1.0 (Rev. Jan 1, 2026 00:00)",
    buildDate: "2026-01-01T00:00:00.000Z"
  };
</script>
```

`update-revision.js` replaces these tokens on each deploy.

---

## How Deployment Discovery Works

```javascript
// No config file — IDs are discovered at runtime
const output = execSync('clasp deployments', { encoding: 'utf8' });
// Output format:
//   - AKfycby6Lh... @4 - TEST-WEB-APP
//   - AKfycbz7Mn... @3 - PROD-WEB-APP
//   - AKfycbx5Kj... @HEAD

const match = deployments.find(d => d.description.includes('TEST-WEB-APP'));
execSync(`clasp deploy -i ${match.deploymentId} -d "TEST-WEB-APP"`);
```

The `-d "TEST-WEB-APP"` flag preserves the description after deploy so the anchor remains discoverable.

---

## Deployment Lifecycle

| Version | Deployment | Notes |
|---|---|---|
| `@HEAD` | Auto-created by clasp | Always serves latest push; used by automated tests via `/dev` URL |
| `@N` (TEST-WEB-APP) | Stable TEST URL | Redeployed in place for integration testing |
| `@N` (PROD-WEB-APP) | Stable PROD URL | Redeployed in place for production |
| Old `@N` | Archivable | Listed in `--manage` mode; use `clasp undeploy` to clean up |

---

## Reusable Files

| File | Purpose |
|---|---|
| `manage-deployments.js` | Interactive deployment manager |
| `update-revision.js` | Stamps build date/time into `version.html` |

---

## Adapting for a New Project

1. Copy both scripts into your project root
2. In `manage-deployments.js`, update `SRC_DIR` and the `TARGETS` anchors if you want different names than `TEST-WEB-APP` / `PROD-WEB-APP`
3. In `update-revision.js`, update `appVersion` and `versionPath` to match your version file location and token format
4. Add `npm run manage-deployments` to your `package.json` scripts
5. Create the two deployments once in the Apps Script editor

---

## Security Notes

- `executeAs: "USER_DEPLOYING"` means the app runs as the deploying user's identity. For public apps, use `executeAs: "USER_ACCESSING"` with appropriate Drive permissions review.
- `access: "ANYONE"` allows unauthenticated access. For internal tools, change to `"DOMAIN"` or `"ANYONE_WITH_GOOGLE_ACCOUNT"`.
