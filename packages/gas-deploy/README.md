# gas-deploy

The shared Google Apps Script deployment pipeline. One implementation of the six steps every
GAS project re-implements: **auth, stamp, push, redeploy, post-deploy hooks, report** — plus the
thing none of them had, **over-the-wire deploy verification**.

Background and the drift this replaces: `best-practices/gas-deployment/RECOMMENDATION.md`.

## Install

pnpm only. npm has never supported subdirectory git dependencies; pnpm's `path:` selector is what
makes a monorepo subdirectory installable without publishing to a registry.

```jsonc
"dependencies": {
  "gas-deploy": "github:stuartdonaldson/GAS-Core#gas-deploy-v1.0.0&path:/packages/gas-deploy"
}
```

Always pin a tag. A floating dependency means one package bug breaks every consumer's deploy at
once.

## Usage

A consumer's `tools/manage-deployments.js` becomes pure config:

```js
#!/usr/bin/env node
const path = require('path');
const { runCli, constStamper, standardChain } = require('gas-deploy');

runCli({
  root: path.join(__dirname, '..'),
  rootDir: 'script',
  stamper: constStamper({ file: 'script/version.js' }),
  targets: {
    sit:  { scriptIdKey: 'sitScriptId',  label: 'SIT',  emoji: '🧪', counter: 'build',
            deploymentIdKey: 'sitDeploymentId', sheetIdKey: 'sitSheetId' },
    prod: { scriptIdKey: 'prodScriptId', label: 'PROD', emoji: '🚀', counter: 'version',
            deploymentIdKey: 'prodDeploymentId', sheetIdKey: 'prodSheetId' },
  },
  postDeploy: [
    { name: 'Stamp WEBAPP_URL', run: (ctx) => run('setWebappUrl', ctx) },
    { name: 'Publish static pages', required: true, run: (ctx) => publish(ctx) },
  ],
}).catch(err => { console.error('❌', err.message); process.exit(1); });
```

```
node tools/manage-deployments.js --deploy-sit
node tools/manage-deployments.js --summary --env sit    # read-only: no push, no deploy, no hooks
node tools/manage-deployments.js --deploy-prod --skip-bump
```

## Config reference

| key | meaning |
|---|---|
| `root` | Absolute project root. Everything else is relative to it. |
| `settingsPath` / `pkgPath` / `claspPath` | Defaults: `local.settings.json`, `package.json`, `.clasp.json`. |
| `rootDir` | `rootDir` written into `.clasp.json`. Default `script`. |
| `stamper` | `constStamper({file})` or `buildInfoStamper({file, fields, extraFields})`. `fields` renames the standard keys (a GAS runtime reads them by name); `extraFields` may be a function of the stamp context, for a project field that varies per target. |
| `targets` | Per-env config, see below. |
| `envAliases` | Public env name → internal target key, e.g. `{ sit: 'test', prod: 'template' }`. |
| `resolveDeployment` | Resolver chain. Default `standardChain(target.anchor)`. |
| `prePush` | Ordered hooks that run after the stamp and **before** the push, for source that must be part of it. Default `required: true` — nothing is live yet, so stopping is free. |
| `postDeploy` | Ordered `[{ name, run, required, retryCommand }]`. `required: false` (default) ⇒ a throw warns and prints `retryCommand`; the deploy still succeeds, because the code is already live. |
| `describeDeployment` | `(version, label, target) => string` for the `clasp deploy --description`. |
| `extraRows` | `(ctx) => [{ label, value, missing }]` — project-specific summary rows. |
| `readLocalVersion` | `(ctx) => string \| {version, now}` — lets `--summary` flag live-vs-local divergence and print the stamp time. Reading the stamped file is deliberately the consumer`s job: the package itself never reads back what it stamped. |
| `verifyOptions` | `{ intervalSec, timeoutSec }` for `assertDeployedVersion`. |
| `claspFields` | Object or `(ctx) => object` — the rest of `.clasp.json` (`projectId`, `parentId`, extension lists). `scriptId`/`rootDir` are always written last and cannot be overridden. |
| `resolveBeforeStamp` | Resolve the deployment *before* the stamp, so the stamper receives `deploymentId` and `webAppUrl`. Needed when the version file carries the deployment's own /exec URL (GActionSheet's `BUILD_INFO.webappUrl`). Costs no extra `clasp deployments` call. |
| `ledgerEntry` / `deployMetadata` | `(ctx) => object` — shape the ledger line / `.deploy-metadata.json` yourself when a project's records predate the package and have readers. A shaped record is written verbatim: the package adds no `at`/`user` keys to it. |

Per target: `scriptIdKey`, `label`, `emoji`, `counter` (`build` | `version`), `deploymentIdKey`,
`sheetIdKey`, `authKey`, `anchor`.

`counter: 'build'` bumps package.json's integer `build` and stamps `${version}.${build}`;
`counter: 'version'` bumps the semver patch and resets `build` to 0.

`authKey` is **per target** on purpose (it names a key in `local.settings.json`; it defaults to
`claspAuth`, so a target only sets it when it deviates) — RankChoiceVoting deploys its NUUC environment under
a completely separate Google account.

##  config

| key | meaning |
|---|---|
| `envMap` | env → `{ deploymentIdKey, secretKey, scriptIdKey, authKey, anchor }`. `sit`/`test` and `prod`/`production` are accepted as synonyms. |
| `authField` | Body field the secret goes in: `adminSecret`, `testToken`, `secret`, … |
| `ungatedActions` | Actions the server answers *before* its secret gate — never send one a secret. |
| `securedCmds` | Which `--cmd` endpoints are secret-gated. Omit ⇒ all of them. |
| `resolveFromLiveList` | `false` to use the recorded deploymentId instead of a `clasp deployments` round trip. |
| `postFn` | Opt-in transport override, passed through to `lib/webapp.js`'s `call()`. For a consumer whose webapp cannot answer a bare `lib/webapp.js` POST — PracticeMix is deployed `access:ANYONE` (not `ANYONE_ANONYMOUS`) and only answers a POST carrying a signed-in Google session, so its wrapper supplies a `postFn` that replays a captured Playwright session's cookies. Omit for the common case. |

## Deployment-ID resolution

The seven pre-package copies used three mutually exclusive strategies and none fell back to
another. The package chains them, deterministic first:

| # | resolver | basis | notes |
|---|---|---|---|
| 1 | `settingsId()` | the ID recorded in `local.settings.json` | Most deterministic — no guessing, works with many deployments. **Validated against the live list**, so a deleted/recreated deployment is refused rather than silently deployed into. |
| 2 | `anchorMatch(anchor)` | description contains e.g. `TEST-WEB-APP` | Survives recreation, and is the only strategy that distinguishes TEST from PROD **when one script project holds several deployments**. |
| 3 | `soleActiveDeployment()` | the one non-`@HEAD` deployment | Zero configuration. Refuses loudly once a second deployment appears, naming the two alternatives. |

`standardChain(anchor)` composes 1 → 2 → 3. Compose your own with `chain(...)`. When everything
fails, the error reports **all** the attempts, not just the last.

The package **never creates a deployment**. A new URL is always a deliberate human decision, so
every `clasp deploy` pins `--deploymentId`.

## Deploy verification

Each consumer's webapp exposes one uniform route, no secret required so it answers on an
`ANYONE_ANONYMOUS` deployment and before any secret is bootstrapped:

```jsonc
// GET/POST ?cmd=version →
{ "ok": true, "version": "2.5.0.9", "versionDate": "…", "target": "TEST", "deploymentId": "AKfycbx…" }
```

`assertDeployedVersion` polls it until the reported **version and target** match what was just
stamped. It is the mandatory, non-skippable last step before the summary; there is no flag to
turn it off. The **target** check is what catches a deploy landing in the wrong environment —
nothing before this could detect that, and it matters most where several targets share one
version counter.

The route itself is per-project GAS code (only the project knows where its stamper wrote); the
package owns the Node side.

## Invariants

Enforced structurally, and asserted in `test/invariants.test.js`:

- Every `clasp` call goes through `claspEnv()`, which always sets `clasp_config_auth`. There is no
  code path that runs bare `clasp` and silently falls back to `~/.clasprc.json`.
- `package.json` is the sole source of truth for version and build. The stamped version file is
  **generated, never read back**.
- `printDeploySummary` is the final step of every deploy — on the success path *and* the
  verification-failure path.
- No `clasp deploy` without `--deploymentId`.
- The package never shells out to `npm`/`pnpm`.
- A secret is never printed, never placed in argv, and never placed in a query string — including
  on the failure path.

## Cutting a release

```bash
# from the GAS-Core repo root, on a clean tree
git tag gas-deploy-v1.1.0        # prefixed, matching libsheets-v1.0.0 / libsidebar-v1.0.0
git push origin gas-deploy-v1.1.0
```

Then in each consumer, bump the ref in `package.json` and run `pnpm install` to update
`pnpm-lock.yaml`. Consumers are re-pinned deliberately, one at a time — that is the point of
pinning.

## Tests

```bash
node --test 'test/*.test.js'
```
