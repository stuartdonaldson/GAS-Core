# Best Practice: GAS Configuration Management and Release Workflow

## Overview

This pattern is the release-governance layer on top of [`gas-deployment/`](../gas-deployment/README.md)
— **read that first**, install the `gas-deploy` package, and get `pnpm run deploy:test`/`deploy:prod`
working before adopting anything here. This folder does not duplicate deploy mechanics (push,
stamping, redeploy, verification): the `gas-deploy` package's `deploy()` already stamps the build
identity into your app as one of its pipeline steps. What this pattern adds is what happens
*around* a deploy — semantic version governance, a single release command, and git history that
records exactly what shipped.

It combines three complementary capabilities:

1. **Semantic versioning** via `pnpm version` — version bumps create git commits and `vX.Y.Z` tags
   atomically.
2. **A single release command** (`pnpm run release:patch`) that chains version bump → deploy →
   deploy-stamp commit → tag push → post-release version bump.
3. **Post-release version bump** — after each production release the version is immediately
   advanced so test builds always show a version number ahead of the last release, making it
   unambiguous which environment you are looking at.

**Use when:**
- You want a single command to handle the full release cycle: bump, deploy, tag, commit.
- You want git tags on every production release.
- You want test and prod builds to be visually distinguishable without checking git.

**Provenance:** Originated in AudioTrackCombiner v1.6+ as a hand-rolled `npm version` +
`update-revision.js` + `commit-deploy-stamp.js` chain. The stamping half of that chain is now the
`gas-deploy` package's job (RECOMMENDATION.md #4/#5) — this folder keeps only what remains
genuinely project-side: the release script chain and the deploy-stamp commit.

---

## How It Works

```
pnpm version patch             →  bumps package.json to 1.6.2
                                   commits "1.6.2"
                                   creates tag v1.6.2

pnpm run deploy:prod           →  gas-deploy's deploy() stamps "1.6.2" from package.json into
                                   your version file, runs clasp push -f, redeploys PROD-WEB-APP,
                                   verifies the /exec URL is actually serving v1.6.2 (§3.2), prints
                                   the standard summary, and writes .deploy-metadata.json
                                   ({ at, target, version, deploymentId, revision, scriptId })

node commit-deploy-stamp.js    →  reads .deploy-metadata.json
                                   git add <your stamped version file>
                                   git commit -m "chore: deploy stamp
                                     Deployed v1.6.2 to PROD
                                     Deployment ID: AKfycb...
                                     Deployment revision: @165
                                     Timestamp: 2026-05-06T14:30:00.000Z"
                                   deletes .deploy-metadata.json

git push --follow-tags         →  pushes v1.6.2 commit + tag + deploy stamp commit

pnpm version patch             →  bumps to 1.6.3 (post-release dev version)
git push                       →  pushes 1.6.3 commit
```

After release: prod shows `v1.6.2`, test shows `v1.6.3` the next time you deploy to test.

The `release:patch` script chains all of the above into a single command.

---

## pnpm Scripts

Copy the scripts block from [`package.json.example`](package.json.example) into your
`package.json`. It assumes `tools/manage-deployments.js` is already configured per
[`gas-deployment/`](../gas-deployment/README.md#adopting-the-package-in-a-new-project):

```json
"scripts": {
  "deploy:test":        "node tools/manage-deployments.js --deploy-test",
  "deploy:prod":        "node tools/manage-deployments.js --deploy-prod",
  "release:patch":      "pnpm version patch && pnpm run deploy:prod && node commit-deploy-stamp.js && git push --follow-tags && pnpm version patch && git push",
  "release:minor":      "pnpm version minor && pnpm run deploy:prod && node commit-deploy-stamp.js && git push --follow-tags && pnpm version patch && git push",
  "release:major":      "pnpm version major && pnpm run deploy:prod && node commit-deploy-stamp.js && git push --follow-tags && pnpm version patch && git push",
  "manage-deployments": "node tools/manage-deployments.js"
}
```

| Script | When to use |
|--------|-------------|
| `pnpm run deploy:test` | Push a change to the test URL for validation |
| `pnpm run deploy:prod` | Push to prod without a version bump (config-only changes) |
| `pnpm run release:patch` | Ship a bug fix — bump patch, deploy, tag, deploy-stamp commit, post-release bump |
| `pnpm run release:minor` | Ship a new feature — bump minor, deploy, tag, deploy-stamp commit, post-release bump |
| `pnpm run manage-deployments` | Interactive: list, archive, or manually deploy (see `gas-deployment/`) |

No `update-revision` step anywhere in this chain — `gas-deploy`'s `deploy()` stamps the version as
part of its own pipeline, so there is no separate step to remember or to skip by accident.

---

## Deploy Stamp Commit

`commit-deploy-stamp.js` reads `.deploy-metadata.json` — written by `gas-deploy`'s `deploy()`
after every successful deploy, in the package's own shape:

```jsonc
{ "at": "2026-05-06T14:30:00.000Z", "target": "PROD", "version": "1.6.2",
  "deploymentId": "AKfycbwPcnwln3A1KI0V9T9FWLxA-s5FLDQY9xmr9CXc_HPA_8oS9lXvXrhRnEmlCU0PB0QK",
  "revision": "165", "scriptId": "1a2b3c…" }
```

and produces:

```
chore: deploy stamp

Deployed v1.6.2 to PROD
Deployment ID: AKfycbwPcnwln3A1KI0V9T9FWLxA-s5FLDQY9xmr9CXc_HPA_8oS9lXvXrhRnEmlCU0PB0QK
Deployment revision: @165
Timestamp: 2026-05-06T14:30:00.000Z
```

**Why include this in the commit?** GAS deployment IDs are immutable and stable. Recording the ID
in git means you can map any commit to its live deployment URL without running
`clasp deployments`. The revision (`@165`) confirms the GAS version number that served this code.

`commit-deploy-stamp.js` takes your stamped version file's path as an optional argument (default
`src/version.html`) — pass your project's actual path if it's a `.js` const-stamped file instead:

```bash
node commit-deploy-stamp.js script/version.js
```

`.deploy-metadata.json` is gitignored and deleted by `commit-deploy-stamp.js` after the commit. If
your project has more than one reader of this file, `gas-deploy`'s `deployMetadata` config hook
lets you shape the record yourself — see `gas-deployment/`'s config reference cross-link.

---

## Version Display in the App

Your stamper (`constStamper` or `buildInfoStamper`, configured in `tools/manage-deployments.js`
per `gas-deployment/`) already writes the version into your app on every deploy — this pattern
adds nothing new there. `package.json`'s `version` (plus an optional `build` counter) is the sole
source of truth; the stamped file is generated output, never read back.

---

## Test vs Prod Distinction

After each `release:*` command:
- **PROD** deployment shows `v1.6.2`.
- **TEST** deployment (after the next `deploy:test`) shows `v1.6.3`.

This is the Maven-style post-release bump convention. The alternative (npm convention) is to stay
on `v1.6.2` after release and rely on git tags as the boundary. The Maven approach was chosen here
because the app displays its version — having test show a higher number than prod makes the
distinction immediately visible without consulting git.

---

## Release Workflow

### Standard release (bug fix)

```bash
# Ensure working tree is clean first
git status

pnpm run release:patch
```

This runs: `pnpm version patch` → `deploy:prod` → commit deploy stamp → `git push --follow-tags` →
`pnpm version patch` (post-release bump) → `git push`.

### Standard release (new feature)

```bash
pnpm run release:minor
```

### Deploy to test only (no release)

```bash
pnpm run deploy:test
```

### Deploy to prod without a version bump (config/content only)

```bash
pnpm run deploy:prod
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Everything in [`gas-deployment/`](../gas-deployment/README.md#1-prerequisites) | This pattern assumes a working `deploy:test`/`deploy:prod` first. |
| **pnpm** | `pnpm version` replaces `npm version` throughout — see `gas-deployment/`'s pnpm note. Both behave identically for a bare patch/minor/major bump; the difference is npm-lifecycle-script hooks (`pre/postversion`), which this pattern doesn't use. |
| **Clean working tree** | `pnpm version` fails if there are uncommitted changes. |
| **Remote configured** | `git push` in the release scripts requires a configured remote. |

### `clasp run` requires a linked GCP project

`clasp run <functionName>` (used for scripted PropertiesService setup and test invocation) has
additional prerequisites beyond `clasp push` and `clasp deploy`:

1. **Linked GCP project** — the Apps Script project must be explicitly associated with a Google
   Cloud Platform project. In the Apps Script editor: *Project Settings > Google Cloud Platform
   (GCP) Project > Change project*. The default internal GCP project created by Apps Script does
   not expose the Apps Script API.
2. **Apps Script API enabled** — in the linked GCP project, enable the *Apps Script API* at
   APIs & Services > Enabled APIs.
3. **OAuth consent screen** — the GCP project must have an OAuth consent screen configured. For
   *External* user type, Google review may be required before the consent screen is usable by
   non-owner accounts.
4. **API executable deployment** — the script must have at least one deployment of type
   *API executable* (created in the Apps Script editor: *Deploy > New deployment > API
   executable*). The `@HEAD` deployment created by `clasp push` is not an API executable and will
   not satisfy `clasp run`.

**Practical consequence:** `clasp run` is a significant setup investment for projects that do not
already have a GCP project. For bound scripts on personal Google accounts, manually running test
functions from the Apps Script editor (or via the menu) is often lower friction. Reserve
`clasp run` for projects where scripted invocation is worth the one-time GCP setup cost.

---

## Setup

### 1. Get `gas-deployment/` working first

Follow [`gas-deployment/`'s adoption steps](../gas-deployment/README.md#adopting-the-package-in-a-new-project)
end to end: install the `gas-deploy` package, configure `tools/manage-deployments.js`, confirm
`pnpm run deploy:test` succeeds and prints the standard summary with a verified version.

### 2. Copy `commit-deploy-stamp.js`

Copy [`commit-deploy-stamp.js`](commit-deploy-stamp.js) into your project root.

### 3. Add pnpm scripts

Copy the scripts block from [`package.json.example`](package.json.example) into your
`package.json`.

### 4. Initialize version

Set your starting version in `package.json`:

```json
"version": "1.0.0"
```

### 5. Gitignore the ephemeral metadata file

```
.deploy-metadata.json
```

---

## Mid-Release Failure Recovery

If a `release:*` script fails mid-chain (e.g. a clasp error during deploy, or `assertDeployedVersion`
failing verification — see `gas-deployment/`'s §Deploy verification), the version may already be
bumped and tagged. To diagnose:

```bash
git log --oneline -5
git tag -l | tail -5
```

Then either:
- **Complete manually**: finish the remaining steps (deploy, push, post-release bump).
- **Revert the version commit**: `git tag -d vX.Y.Z && git reset --hard HEAD~1`.

---

## Reusable Files

| File | Purpose |
|---|---|
| `commit-deploy-stamp.js` | Reads `.deploy-metadata.json` (the `gas-deploy` package's own shape) and commits the stamped version file with deployment ID, revision, and timestamp in the message |
| `package.json.example` | Example scripts block: pnpm version governance + the `gas-deploy`-backed deploy scripts |

Deploy mechanics — `manage-deployments.js`, the stamper, the resolver, deploy verification — live
in [`gas-deployment/`](../gas-deployment/README.md); nothing in this folder duplicates them.
