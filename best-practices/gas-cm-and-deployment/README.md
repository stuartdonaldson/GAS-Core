# Best Practice: GAS Configuration Management and Deployment

## Overview

This pattern provides a complete configuration management and release workflow for Google Apps Script web apps. It combines three complementary capabilities:

1. **Semantic versioning** via `npm version` — version bumps create git commits and `vX.Y.Z` tags atomically
2. **Deployment stamping** via `update-revision.js` — version and deployment date are stamped into the running app so users can see exactly which build is live
3. **Post-release version bump** — after each production release the version is immediately advanced so test builds always show a version number ahead of the last release, making it unambiguous which environment you are looking at

**Use when:**
- Your app should display its version and deployment date to users or operators
- You want a single command (`npm run release:patch`) to handle the full release cycle
- You want git tags on every production release
- You want test and prod builds to be visually distinguishable without checking git

**Relationship to gas-deployment:** This pattern builds on the stable TEST/PROD deployment architecture described in [`gas-deployment/`](../gas-deployment/). Read that first if the clasp deployment model is new to you. This pattern adds version governance and release scripting on top of it.

**Provenance:** Extracted from [AudioTrackCombiner](../../../../c-dev/AudioTrackCombiner) v1.6+. Reference files: `manage-deployments.js`, `update-revision.js`, `package.json`, `adr/0003-version-management-and-release-workflow.md`.

---

## How It Works

```
npm version patch              →  bumps package.json to 1.6.2
                                   commits "1.6.2"
                                   creates tag v1.6.2

npm run deploy:prod            →  update-revision.js reads "1.6.2" from package.json
                                   stamps "v1.6.2 (Rev. May 6, 2026 14:30)" into src/version.html
                                   clasp push -f  →  sends src/ to Apps Script
                                   clasp deploy -i <PROD_ID> -d "PROD-WEB-APP v1.6.2 (Rev. May 6, 2026 14:30)"
                                     → creates version N, repoints URL
                                   writes .deploy-metadata.json (deployment ID, revision, description)

node commit-deploy-stamp.js    →  reads .deploy-metadata.json
                                   git add src/version.html
                                   git commit -m "chore: deploy stamp
                                     Deployed v1.6.2 to PRODUCTION
                                     Deployment ID: AKfycb...
                                     Deployment revision: @165
                                     Timestamp: May 6, 2026 14:30"
                                   deletes .deploy-metadata.json

git push --follow-tags         →  pushes v1.6.2 commit + tag + deploy stamp commit

npm version patch              →  bumps to 1.6.3 (post-release dev version)
git push                       →  pushes 1.6.3 commit
```

After release: prod shows `v1.6.2`, test shows `v1.6.3` the next time you deploy to test.

The `release:patch` script chains all of the above into a single command.

---

## npm Scripts

Add to `package.json`:

```json
"scripts": {
  "update-revision":   "node update-revision.js",
  "deploy:test":       "npm run update-revision && node manage-deployments.js --deploy-test",
  "deploy:prod":       "npm run update-revision && node manage-deployments.js --deploy-prod",
  "release:patch":     "npm version patch && npm run deploy:prod && node commit-deploy-stamp.js && git push --follow-tags && npm version patch && git push",
  "release:minor":     "npm version minor && npm run deploy:prod && node commit-deploy-stamp.js && git push --follow-tags && npm version patch && git push",
  "release:major":     "npm version major && npm run deploy:prod && node commit-deploy-stamp.js && git push --follow-tags && npm version patch && git push",
  "manage-deployments":"node manage-deployments.js"
}
```

| Script | When to use |
|--------|-------------|
| `npm run deploy:test` | Push a change to the test URL for validation |
| `npm run deploy:prod` | Push to prod without a version bump (config-only changes) |
| `npm run release:patch` | Ship a bug fix — bump patch, deploy, tag, post-release bump |
| `npm run release:minor` | Ship a new feature — bump minor, deploy, tag, post-release bump |
| `npm run manage-deployments` | Interactive: list, archive, or manually deploy |

---

## Deployment Description Format

Each deploy sets the GAS deployment description to:
```
PROD-WEB-APP v1.6.2 (Rev. May 6, 2026 14:30)
```

The anchor (`PROD-WEB-APP` or `TEST-WEB-APP`) is always the **prefix** and is matched as a **substring**, so the deployment is discoverable even as the version and timestamp change. Do not create deployments with descriptions that omit the anchor prefix.

This makes the deployment list self-auditing — you can see at a glance which version is deployed where without consulting git.

---

## Deploy Stamp Commit

`commit-deploy-stamp.js` replaces the old inline `git commit -m 'chore: deploy stamp'`. It reads `.deploy-metadata.json` (written by `manage-deployments.js` after each successful deploy) and produces:

```
chore: deploy stamp

Deployed v1.6.2 to PRODUCTION
Deployment ID: AKfycbwPcnwln3A1KI0V9T9FWLxA-s5FLDQY9xmr9CXc_HPA_8oS9lXvXrhRnEmlCU0PB0QK
Deployment revision: @165
Timestamp: May 6, 2026 14:30
```

**Why include this in the commit?** GAS deployment IDs are immutable and stable. Recording the ID in git means you can map any commit to its live deployment URL without running `clasp deployments`. The revision (`@165`) confirms the GAS version number that served this code. `.deploy-metadata.json` is gitignored and deleted after the commit.

---

## Why `deploy:*` Not Raw `clasp`

`deploy:test` and `deploy:prod` chain `update-revision` before calling `manage-deployments.js`. Calling `manage-deployments.js` directly (or using raw `clasp`) skips `update-revision`, so the running app shows a stale version string. The script emits a warning if called outside npm to catch this mistake.

---

## Version Display in the App

`update-revision.js` reads the version from `package.json` and stamps it plus the current date/time into `src/version.html`:

```html
<script>
  const APP_INFO = {
    version: "v1.6.2 (Rev. May 6, 2026 14:30)",
    buildDate: "2026-05-06T14:30:00.000Z"
  };
</script>
```

Your app can then display `APP_INFO.version` to give users and developers a precise build reference. This is the primary mechanism for distinguishing prod from test and for confirming that a deployment went live.

---

## Test vs Prod Distinction

After each `release:*` command:
- **PROD** deployment: shows `v1.6.2`
- **TEST** deployment (after next `deploy:test`): shows `v1.6.3`

This is the Maven-style post-release bump convention. The alternative (npm convention) is to stay on `v1.6.2` after release and rely on git tags as the boundary. The Maven approach was chosen here because the app displays its version — having test show a higher number than prod makes the distinction immediately visible without consulting git. See [AudioTrackCombiner ADR-0003](../../../../c-dev/AudioTrackCombiner/adr/0003-version-management-and-release-workflow.md) for the full trade-off analysis.

---

## Release Workflow

### Standard release (bug fix)

```bash
# Ensure working tree is clean first
git status

npm run release:patch
```

This runs: `npm version patch` → `deploy:prod` → commit deploy stamp → `git push --follow-tags` → `npm version patch` (post-release bump) → `git push`.

### Standard release (new feature)

```bash
npm run release:minor
```

### Deploy to test only (no release)

```bash
npm run deploy:test
```

### Deploy to prod without version bump (config/content only)

```bash
npm run deploy:prod
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js v18+** | Required by tooling |
| **clasp** | `npm install -g @google/clasp`; must be authenticated (`clasp login`) |
| **@inquirer/prompts** | `npm install @inquirer/prompts` |
| **Clean working tree** | `npm version` fails if there are uncommitted changes |
| **Remote configured** | `git push` in the release scripts requires a configured remote |
| **TEST-WEB-APP / PROD-WEB-APP deployments** | Created once manually in the Apps Script editor (see [gas-deployment/](../gas-deployment/)) |

### `clasp run` requires a linked GCP project

`clasp run <functionName>` (used for scripted PropertiesService setup and test invocation) has additional prerequisites beyond `clasp push` and `clasp deploy`:

1. **Linked GCP project** — the Apps Script project must be explicitly associated with a Google Cloud Platform project. In the Apps Script editor: *Project Settings > Google Cloud Platform (GCP) Project > Change project*. The default internal GCP project created by Apps Script does not expose the Apps Script API.
2. **Apps Script API enabled** — in the linked GCP project, enable the *Apps Script API* at APIs & Services > Enabled APIs.
3. **OAuth consent screen** — the GCP project must have an OAuth consent screen configured. For *External* user type, Google review may be required before the consent screen is usable by non-owner accounts.
4. **API executable deployment** — the script must have at least one deployment of type *API executable* (created in the Apps Script editor: *Deploy > New deployment > API executable*). The `@HEAD` deployment created by `clasp push` is not an API executable and will not satisfy `clasp run`.

**Practical consequence:** `clasp run` is a significant setup investment for projects that do not already have a GCP project. For bound scripts on personal Google accounts, manually running test functions from the Apps Script editor (or via the menu) is often lower friction. Reserve `clasp run` for projects where scripted invocation is worth the one-time GCP setup cost.

---

## Setup

### 1. Copy scripts

Copy `manage-deployments.js` and `update-revision.js` from this folder into your project root.

### 2. Add npm scripts

Copy the scripts block from `package.json.example` into your `package.json`.

### 3. Create version file

Add `src/version.html` with the token format `update-revision.js` expects:

```html
<script>
  const APP_INFO = {
    version: "v0.0.0 (Rev. Jan 1, 2026 00:00)",
    buildDate: "2026-01-01T00:00:00.000Z"
  };
</script>
```

### 4. Initialize version

Set your starting version in `package.json`:

```json
"version": "1.0.0"
```

### 5. Configure `manage-deployments.js`

`SRC_DIR` defaults to `./src`. If your Apps Script source is in a different folder, update the constant at the top of the file.

---

## Adapting Target Names

If you want different deployment anchor names than `TEST-WEB-APP` / `PROD-WEB-APP`, update the `TARGETS` constant:

```js
const TARGETS = {
  test:       { anchor: 'MY-TEST',  label: 'TEST',       emoji: '🧪' },
  production: { anchor: 'MY-PROD',  label: 'PRODUCTION', emoji: '🚀' },
};
```

Then create deployments in the Apps Script editor with descriptions containing those anchor strings as a prefix. The script matches by substring, so deployed descriptions like `MY-PROD v1.2.3 (Rev. ...)` will still be found.

---

## Mid-Release Failure Recovery

If a `release:*` script fails mid-chain (e.g. a clasp error during deploy), the version may already be bumped and tagged. To diagnose:

```bash
git log --oneline -5
git tag -l | tail -5
```

Then either:
- **Complete manually**: finish the remaining steps (deploy, push, post-release bump)
- **Revert the version commit**: `git tag -d vX.Y.Z && git reset --hard HEAD~1`

---

## Reusable Files

| File | Purpose |
|---|---|
| `manage-deployments.js` | Deployment manager — no internal `update-revision` call; warns if called without npm; writes `.deploy-metadata.json` after each deploy |
| `update-revision.js` | Reads version from `package.json` dynamically; stamps version + date into `src/version.html` |
| `commit-deploy-stamp.js` | Reads `.deploy-metadata.json` and commits `src/version.html` with deployment ID, revision, and timestamp in the message |
| `package.json.example` | Example scripts block showing the full deployment and release setup |

Add `.deploy-metadata.json` to your `.gitignore` — it is ephemeral and deleted by `commit-deploy-stamp.js` after each release.
