# Best Practice: GAS Web App Deployment Management

## Overview

> **See also:** [`gas-cm-and-deployment/`](../gas-cm-and-deployment/README.md) for the
> release-workflow layer that builds on this one — `npm`/`pnpm version` governance, git tags, a
> post-release bump convention, and single-command release scripts. That doc assumes everything
> here is already working.
>
> **See also:** [`gas-webapp-admin/`](../gas-webapp-admin/README.md) for the `cmd=admin`
> operator-route pattern (Script Properties over the wire, set-once secret bootstrap) that pairs
> with this one's `cmd=version` route and shares its CLI caller.

Google Apps Script web apps are published at stable URLs. Each `clasp deploy` creates a new
immutable numbered version of the code without changing the URL. This pattern maintains one or
more stable named deployments (typically SIT/TEST and PROD) that get redeployed in place, stamps
build metadata into the app at deploy time, and — the part that used to not exist anywhere —
**asserts over the wire that the URL is actually serving what was just deployed**, rather than
trusting `clasp deploy`'s exit code.

**Use when:** You have a GAS web app that needs one or more stable, named-URL environments with
repeatable, auditable, *verified* deployments.

**Provenance:** This is the extracted, hardened form of a pattern that was copy-pasted into seven
GAS projects and diverged in fourteen distinct ways — silently wrong `clasp` credentials, three
incompatible version-file shapes, no deploy ever actually verified, five hand-rolled webapp
callers. The full drift analysis and the six-stage extraction that fixed it live in
[`RECOMMENDATION.md`](RECOMMENDATION.md) — read it if you want the "why", not just the "how".

**The mechanics below are a real, installable Node package, not a template to copy.**
[`packages/gas-deploy/`](../../packages/gas-deploy/) in this repo is `git dependency` –
installable and is what every current consumer (F3Go30, RankChoiceVoting, GActionSheet,
PracticeMix, NUUC-Dispatch) actually runs. This README tells you how to adopt it in a **new**
project: which of the package's building blocks to pick, and two complete, working configs to
start from.

---

## Deployment Models: One Script Project vs Two

*(Fresh capture 2026-07-22 from NUUC-Dispatch/F3Go30/GActionSheet experience — refine as
more projects exercise it.)*

Two distinct models for separating TEST/SIT from PROD exist across active projects. **Decide the
model before provisioning** — it drives which resolver and which target shape you pick below, and
migrating a project between models is out of scope for the tooling (RECOMMENDATION.md §5).

### Model A — single script project, named deployments

One script project; `TEST-WEB-APP` and `PROD-WEB-APP` deployments created **once** in the editor
with an anchor string in their descriptions, then forever **redeployed in place**
(`clasp deploy --deploymentId <id>`) so both `/exec` URLs stay stable. The description anchor is
the discovery key — no config file of deployment ids required, though the package also records
one as a non-stale fallback (see `deploymentIdKey` below).

- **Used by:** GActionSheet, NUUC-Dispatch.
- **Everything is shared between envs:** one Script Properties store, one GCP project binding, one
  OAuth consent screen, one quota pool. TEST and PROD differ only in which immutable code
  *version* their deployment pins.
- **Consequences:** env-specific config must be modeled inside the shared properties store (or
  avoided); a runaway TEST can consume PROD's quota; but provisioning happens once, and code
  cannot drift between envs — they are versions of the same project.
- **Resolver:** `anchorMatch(anchor)`, or the package default `standardChain(anchor)`.

### Model B — two script projects (prod + sit/test)

Fully separate script projects per environment: separate script ids, deployments, Script
Properties, triggers, and (the usual driver) separate **bound containers**. `.clasp.json` is
regenerated from `local.settings.json` on every run, per target.

- **Used by:** F3Go30, RankChoiceVoting.
- **Why a project ends up here:** the production script is bound to a production
  spreadsheet/doc/form; SIT needs its own container, and a container-bound script belongs to
  exactly one container → separate project per env.
- **Consequences:** true isolation (data, properties, quotas, blast radius), at the cost of
  provisioning everything twice (GCP binding, consent screen, scopes, deployments) and a standing
  config-drift risk between the two projects.
- **Resolver:** `soleActiveDeployment()` (each project has exactly one active deployment), or
  `standardChain()` with no anchor.

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

`clasp deploy` without arguments creates a new deployment with a new URL each time. Sharing a
stable URL (e.g. with testers or embedded in other systems) requires keeping a specific deployment
ID and redeploying to it in place. Doing this manually in the Apps Script editor is error-prone and
leaves no audit trail. Without a version stamp, it is impossible to tell from the running app which
code version is deployed. And without deploy verification (below), it is impossible to tell
whether the URL is actually serving that version at all — `clasp deploy` exiting `0` proves a
version was *created*, not that anyone is being served it.

---

## Adopting the package in a new project

### 1. Prerequisites

| Requirement | Notes |
|---|---|
| **pnpm** | Required. npm has never supported subdirectory git dependencies; pnpm's `path:` selector is what makes `packages/gas-deploy/` installable without a registry. Add `"packageManager"` and `only-allow pnpm` per [`gas-cm-and-deployment/`](../gas-cm-and-deployment/README.md). |
| **clasp**, authenticated | `npm install -g @google/clasp && clasp login` |
| **A GAS project with a `webapp` section in `appsscript.json`** | See §3 below — without it, `clasp deploy` silently converts the deployment to a library and `/exec` 404s. |
| **One named deployment per target, created once in the editor** | The package **never creates a deployment** — a new stable URL is always a deliberate human decision. See §4. |

### 2. Install the package

```jsonc
// package.json
"dependencies": {
  "gas-deploy": "github:stuartdonaldson/GAS-Core#gas-deploy-v1.2.0&path:/packages/gas-deploy"
}
```

```bash
pnpm install
```

Always pin a tag (`gas-deploy-vX.Y.Z`) — never floating. One package bug on a floating dependency
breaks every consumer's deploy at once. See [`packages/gas-deploy/README.md`](../../packages/gas-deploy/README.md#cutting-a-release)
for the release/re-pin flow.

### 3. `appsscript.json` — must include a `webapp` section

```json
{
  "webapp": {
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING"
  },
  "runtimeVersion": "V8"
}
```

`access: ANYONE_ANONYMOUS` is what lets `cmd=version` (§6 below) answer with no signed-in session —
required for the verification contract to work out of the box. If your project must be
`access: ANYONE` (requires a signed-in Google account — PracticeMix's reason: it's bound to a
container that needs the caller's identity), the package still works, but the local CLI needs an
injected `postFn` that carries a browser session — see [`packages/gas-deploy/README.md`
config reference](../../packages/gas-deploy/README.md#config-reference) (`postFn`) and Stage 5a's
notes in `RECOMMENDATION.md` for the Playwright-session shape that solves it.

### 4. Create the named deployment(s) once, in the editor

For Model A: create two Web App deployments with descriptions `TEST-WEB-APP` and `PROD-WEB-APP`
(exact anchor strings — matched as a substring, so `TEST-WEB-APP v2.5.0` still matches). For Model
B: one deployment per script project, any description.

### 5. Pick a resolver — which deployment does a deploy update?

| Resolver | Model | Basis | Pick this when |
|---|---|---|---|
| `settingsId()` | either | the ID recorded in `local.settings.json` | You want the fastest resolve and are fine relying on the package's own bookkeeping (it's always validated against the live list, so a deleted/recreated deployment is refused, not silently deployed into). Rarely chosen alone — it's `standardChain`'s first attempt. |
| `anchorMatch(anchor)` | **A** | description contains e.g. `TEST-WEB-APP` | One script project holds more than one named deployment. This is the only strategy that tells them apart. |
| `soleActiveDeployment()` | **B** | the one non-`@HEAD` deployment | One script project per environment. Zero configuration; refuses loudly the day a second deployment appears. |

Don't hand-pick usually — `standardChain(anchor)` (Model A) or `standardChain()` (Model B) composes
settings → anchor/sole in the recommended order and is what every current consumer uses. Only
reach for `chain(...)` yourself for something unusual.

### 6. Pick a stamper — where does the build identity get written?

| Stamper | Shape | Pick this when |
|---|---|---|
| `constStamper({ file })` | `const APP_VERSION = '…';` flat consts in a `.js` file | Your GAS runtime already reads flat version constants (F3Go30, RankChoiceVoting's `script/version.js`). |
| `buildInfoStamper({ file, fields, extraFields })` | `const BUILD_INFO = { version, date, target, … };` object literal, `.js` **or** `.html` | Your runtime reads a `BUILD_INFO`-shaped object (GActionSheet, NUUC-Dispatch's `Version.js`; PracticeMix's client-side `version.html` include, stamped alongside a server-side `BuildInfo.js` — see RECOMMENDATION.md Stage 5a's notes if your version file is a client-side HtmlService include the server can't read directly). |

Both stampers **write only** — nothing in the package ever reads a version back out of the file it
just stamped. `package.json`'s `version` (+ an optional integer `build` counter) is the sole source
of truth; the stamped file is generated output. If your project's existing tooling reads the
version back out of the stamped file to feed something else, that inversion is exactly finding #5
in `RECOMMENDATION.md` — fix it as part of adopting the package, don't carry it forward.

### 7. Declare targets, then post-deploy hooks

Each target needs `scriptIdKey` (the `local.settings.json` key holding its scriptId), `label`,
`emoji`, `counter` (`'build'` bumps an integer build number and stamps `${version}.${build}`;
`'version'` bumps the semver patch and resets `build` to 0 — PROD almost always uses `'version'`,
SIT/TEST almost always uses `'build'`), and `deploymentIdKey` (where the resolved ID gets recorded
after every deploy, as the non-stale fallback for the CLI caller). Add `sheetIdKey`/`authKey` only
if they apply.

`postDeploy` hooks run in declared order after the named deployment is updated but **before**
verification. `required: false` (default) means a hook throwing is a warning with a printed retry
command — the deploy still succeeds, because the code is already live and a hook failure doesn't
mean the deploy should look like it failed. `required: true` means the deploy is not usable
without it. `prePush` hooks (rarer) run before `clasp push`, for generated source that must be
*in* the push; they default to `required: true` because nothing is live yet, so stopping there is
free.

### 8. Two complete, worked configs

**Model A** (single script project, anchor-discovered deployments) — this is
NUUC-Dispatch's actual `tools/manage-deployments.js`, trimmed to the parts every new Model-A
project needs:

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { runCli, buildInfoStamper, anchorMatch } = require('gas-deploy');

const ROOT = path.join(__dirname, '..');
const VERSION_PATH = path.join(ROOT, 'src', 'Version.js');

const config = {
  root: ROOT,
  rootDir: 'src',

  targets: {
    test: {
      scriptIdKey: 'scriptId', label: 'TEST', emoji: '🧪', counter: 'build',
      anchor: 'TEST-WEB-APP', resolveDeployment: anchorMatch('TEST-WEB-APP'),
      deploymentIdKey: 'testDeploymentId',
    },
    production: {
      scriptIdKey: 'scriptId', label: 'PRODUCTION', emoji: '🚀', counter: 'version',
      anchor: 'PROD-WEB-APP', resolveDeployment: anchorMatch('PROD-WEB-APP'),
      deploymentIdKey: 'prodDeploymentId',
    },
  },
  envAliases: { prod: 'production', sit: 'test' },     // public env names -> internal target keys

  // The anchor MUST stay in the description — it's what anchorMatch resolves on the next deploy.
  describeDeployment: (version, label, target) => `${target.anchor} v${version}`,

  stamper: buildInfoStamper({
    file: 'src/Version.js',
    fields: { date: 'buildDate' },   // rename to match whatever your runtime actually reads
  }),

  // Display-only, for `--summary` to flag a live-vs-local divergence. Never read on deploy (#5).
  readLocalVersion: () => {
    const src = fs.readFileSync(VERSION_PATH, 'utf8');
    const field = (name) => (src.match(new RegExp('"?' + name + '"?\\s*:\\s*"([^"]*)"')) || [])[1] || '';
    return { version: field('version'), now: field('buildDate') };
  },
};

if (require.main === module) {
  runCli(config).catch(err => { console.error('❌', err.message); process.exit(1); });
}
module.exports = { config };
```

```bash
node tools/manage-deployments.js --deploy-test
node tools/manage-deployments.js --deploy-production
node tools/manage-deployments.js --summary --env sit     # read-only: no push, no deploy, no hooks
```

**Model B** (two script projects, `.clasp.json` regenerated per target) — F3Go30's actual config,
trimmed the same way:

```js
#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const { runCli, constStamper } = require('gas-deploy');
const ROOT = path.join(__dirname, '..');
const VERSION_PATH = path.join(ROOT, 'script', 'version.js');

const config = {
  root: ROOT,
  stamper: constStamper({ file: 'script/version.js' }),
  describeDeployment: (version) => `v${version}`,
  envAliases: { sit: 'test', prod: 'prod' },
  targets: {
    prod: { scriptIdKey: 'prodScriptId', label: 'PROD', emoji: '🚀', counter: 'version',
            deploymentIdKey: 'prodDeploymentId', sheetIdKey: 'prodSheetId' },
    test: { scriptIdKey: 'testScriptId', label: 'TEST', emoji: '🧪', counter: 'build',
            deploymentIdKey: 'testDeploymentId', sheetIdKey: 'testSheetId' },
  },
  readLocalVersion: () => {
    const src = fs.readFileSync(VERSION_PATH, 'utf8');
    const g = (n) => (src.match(new RegExp(`const ${n}\\s*=\\s*'([^']+)'`)) || [])[1];
    return { version: g('APP_VERSION'), now: g('APP_VERSION_DATE') };
  },
};

if (require.main === module) {
  runCli(config).catch(err => { console.error('❌', err.message); process.exit(1); });
}
module.exports = { config };
```

```bash
node tools/manage-deployments.js --deploy-sit
node tools/manage-deployments.js --deploy-prod --skip-bump
node tools/manage-deployments.js --summary --env sit
```

Both use `standardChain()` implicitly (no `resolveDeployment` override in the Model-B config, and
Model A's per-target `anchorMatch` above **is** its `resolveDeployment`). For the full config
surface — `prePush`, `extraRows`, `claspFields`, `ledgerEntry`/`deployMetadata` overrides,
`verifyOptions`, `resolveBeforeStamp` — see [`packages/gas-deploy/README.md`
§Config reference](../../packages/gas-deploy/README.md#config-reference).

### 9. Add npm/pnpm scripts

```jsonc
"scripts": {
  "deploy:test":  "node tools/manage-deployments.js --deploy-test",
  "deploy:prod":  "node tools/manage-deployments.js --deploy-prod",
  "manage-deployments": "node tools/manage-deployments.js"
}
```

No `update-revision` step to chain in front of these — stamping happens *inside* `deploy()`, as
step 3 of the pipeline (see §10), so there is no way to deploy without it running. This is a
structural improvement over the old template, which required every deploy script to remember to
call `update-revision.js` first and only caught the mistake with a runtime warning.

---

## Deploy verification — the single most valuable thing this pattern adds

**`clasp deploy` exiting `0` proves a version was created. It does not prove the `/exec` URL is
serving it.** Every pre-package copy of this pattern reported deploy success on the strength of
that exit code alone — and real failures hid behind it: `appsscript.json` losing its `webapp`
section (silently converts the deployment to a library — `/exec` then 404s), a push landing in the
wrong script project because `clasp` fell back to the wrong credentials, the ~5-second edge
propagation delay racing the very next request, and a named deployment left pointing at an older
version after a partial failure. No amount of "the deploy script exited 0" catches any of these.

**The fix: every consumer's webapp exposes one uniform, unauthenticated route.**

```jsonc
// GET/POST ?cmd=version →
{ "ok": true, "version": "2.5.0.9", "versionDate": "2026-08-21T19:08:10.331Z",
  "target": "TEST", "deploymentId": "AKfycbx…" }
```

No secret required — it must answer on an `ANYONE_ANONYMOUS` deployment and before any secret is
bootstrapped, so it can be the very first thing a fresh deploy proves. The values come from
whatever your stamper wrote, so adopting this is *adding a route*, not changing your version model.
A minimal handler, wired ahead of every other `cmd` branch (including any admin/secret-gated one):

```js
function handleVersionRequest_() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true, version: APP_VERSION, versionDate: APP_VERSION_DATE, target: APP_DEPLOY_TARGET,
    deploymentId: extractDeploymentIdFromUrl_(ScriptApp.getService().getUrl()),
  })).setMimeType(ContentService.MimeType.JSON);
}
// wire into BOTH doGet and doPost, ahead of any cmd=admin-style branch:
//   if (e.parameter.cmd === 'version') return handleVersionRequest_();
```

`gas-deploy`'s `assertDeployedVersion()` then polls that route — after the push, after the named
deployment is updated, before the summary — until the reported **version and target both** match
what was just stamped, or a timeout expires. It is the mandatory, non-skippable last step of every
deploy; there is no flag to turn it off. On a mismatch the deploy fails loudly with
expected-vs-actual and still prints the summary, so the operator can see what *is* live.

**Why the target check matters as much as the version check:** it's what catches a deploy landing
in the wrong environment — nothing before this pattern could detect that at all, and it matters
most where several targets share one version counter (a correct version, wrong target, is
otherwise invisible).

**This replaces flaky end-to-end suites as the deploy gate.** A Playwright or pytest journey suite
against live GAS is slow and flaky for reasons that have nothing to do with whether the deploy
landed; `assertDeployedVersion` is deterministic, fast, and tests the one thing a deploy actually
needs to prove. Keep your end-to-end suite for behavioural regressions — just stop using it to
answer "did the deploy work."

`--summary --env <env>` (read-only, no push/deploy/hooks) uses the same route non-polling
(`queryLiveVersion`, which never throws — safe to call before the route even exists yet) to answer
"what is deployed right now?" without deploying, and flags a live-vs-local divergence if your
project supplies `readLocalVersion`.

---

## Generated `.clasp.json` from `local.settings.json`

`.clasp.json` is **gitignored** and regenerated by the package on every `deploy()`/`summary()`
call, pointed at whichever target's `scriptId` is being acted on. The real `scriptId` is therefore
never committed, and retargeting the whole repo at a different Apps Script/GCP project — a fresh
clone against a personal sandbox, a fork — is a one-file edit to `local.settings.json`, not a
`.clasp.json` hunt. This is now baked into the package (`writeClasp_` in `lib/cli.js`) and applies
to every consumer, Model A and Model B alike; it originated as a NUUC-Dispatch-specific
`ensureClaspJson()` helper before extraction.

The rest of `.clasp.json` beyond `scriptId`/`rootDir` — `projectId`, extension lists,
`filePushOrder` — is supplied via `claspFields` in config (a plain object or a function of the
deploy context), and `scriptId`/`rootDir` are always written last so nothing in `claspFields` can
accidentally override the target actually being deployed to.

---

## The webapp caller

Deploy verification, and any operator/admin action, needs an HTTP client that resolves the
deployment URL, injects a secret without leaking it, and follows GAS's POST→GET redirect. Five
projects each built one from scratch before extraction; the package owns **one**
(`packages/gas-deploy/lib/webapp.js`) plus a CLI (`bin/call-webapp.js`), and a consumer's own
`tools/call-webapp.js` becomes a thin wrapper supplying its action list, auth field names, and
env→URL map:

```js
#!/usr/bin/env node
const path = require('path');
const { run } = require('gas-deploy/bin/call-webapp.js');

const config = {
  root: path.join(__dirname, '..'),
  envMap: {
    test: { scriptIdKey: 'scriptId', anchor: 'TEST-WEB-APP', deploymentIdKey: 'testDeploymentId', secretKey: 'adminSecret' },
    production: { scriptIdKey: 'scriptId', anchor: 'PROD-WEB-APP', deploymentIdKey: 'prodDeploymentId', secretKey: 'adminSecret' },
  },
  authField: 'adminSecret',
  ungatedActions: ['bootstrapSecret', 'version'],
  securedCmds: ['admin'],       // cmd=version is never sent a secret
};

if (require.main === module) run(config).catch(err => { console.error('❌', err.message); process.exit(1); });
```

```bash
node tools/call-webapp.js version --cmd version --env test      # no secret sent
node tools/call-webapp.js getAuthInfo --env prod                # secret injected automatically
```

The deployment URL is resolved from the **live** deployment list by default (never a stored value
that can go stale), `sit`/`test` and `prod`/`production` are accepted as synonyms, and a secret is
never printed, placed in argv, or placed in a query string — including on failure. Full config
surface (`resolveFromLiveList`, `postFn` for a session-gated webapp, `--ns` namespace shorthand):
[`packages/gas-deploy/README.md` §CLI config](../../packages/gas-deploy/README.md#cli-config).

This is the same client `assertDeployedVersion` uses internally — your project does not need a
second one for admin actions. If your project also needs a `cmd=admin` operator-route pattern
(Script Properties set over the wire, gated by a set-once secret), see
[`gas-webapp-admin/`](../gas-webapp-admin/README.md), which documents the GAS-side route and
shares this same CLI.

---

## Reference: how deployment discovery works

```
$ clasp deployments
- AKfycby6Lh... @4 - TEST-WEB-APP v2.5.0.9
- AKfycbz7Mn... @3 - PROD-WEB-APP v2.5.0
- AKfycbx5Kj... @HEAD
```

`anchorMatch('TEST-WEB-APP')` finds the first row, `soleActiveDeployment()` would refuse on this
list (two non-`@HEAD` deployments) — a Model-A signal, correctly rejected by a Model-B resolver.
`clasp deploy --deploymentId <id> --description "..."` advances the version number in place and
keeps the URL stable; the package never omits `--deploymentId`, so it never creates a new
deployment.

---

## Deployment Lifecycle

| Version | Deployment | Notes |
|---|---|---|
| `@HEAD` | Auto-created by clasp | Always serves latest push; has no anonymously reachable `/exec` URL — `cmd=version` cannot verify it, so a HEAD push stays outside the package's `deploy()` (see NUUC-Dispatch's project-local `deployDev`, built from the package's `claspEnv`/`execWithRetry` primitives) |
| `@N` (named deployment) | Stable URL | Redeployed in place; the only thing `deploy()` touches |
| Old `@N` | Archivable | List/archive stays project-local for the same reason — see NUUC-Dispatch's `--manage`; `clasp undeploy` to clean up |

---

## Cutting a release, and re-pinning the package

See [`packages/gas-deploy/README.md`](../../packages/gas-deploy/README.md#cutting-a-release) for
tagging the package itself, and [`gas-cm-and-deployment/`](../gas-cm-and-deployment/README.md) for
the `release:patch`/`minor`/`major` workflow that wraps a deploy in version governance and git
tags.

---

## Security Notes

- `executeAs: "USER_DEPLOYING"` means the app runs as the deploying user's identity. For public
  apps, use `executeAs: "USER_ACCESSING"` with appropriate Drive permissions review.
- `access: "ANYONE_ANONYMOUS"` allows unauthenticated access, including to `cmd=version` — by
  design, so verification works before any secret exists. For internal tools, change to
  `"DOMAIN"` or `"ANYONE_WITH_GOOGLE_ACCOUNT"`, but note the caller then needs a signed-in session
  even for `cmd=version` — see the `postFn` note in §3 above.
