# gas-static

The shared static-front-end build/publish/verify pipeline for Google Apps Script projects that
escape `HtmlService`'s sandboxed iframe. One implementation of the three steps F3Go30, RCV and
GActionSheet each hand-copied: **stamp, publish, verify** — mirroring `gas-deploy`'s shape.

Why the pattern, how to port a page, and the traps:
[`best-practices/gas-static-frontend/README.md`](../../best-practices/gas-static-frontend/README.md).
That document owns the **page**; this package owns the **pipeline**. The drift it replaces is
recorded in §Provenance below.

The package owns the *pipeline*, never the page: no bundler, no framework, no page templating.
Every surveyed project hand-wrote one self-contained HTML file and every one of them says that
was the right call.

## Install

pnpm only, same reason as `gas-deploy` (npm has never supported subdirectory git dependencies):

```jsonc
"dependencies": {
  "gas-static": "github:stuartdonaldson/GAS-Core#gas-static-v1.3.1&path:/packages/gas-static"
}
```

Always pin a tag.

## Usage

A consumer's `tools/static-pages.js` becomes pure config:

```js
#!/usr/bin/env node
const { runStatic } = require('gas-static');

module.exports = runStatic({
  root: __dirname + '/..',
  projectName: 'DemoApp',                  // must match this project's entry in the host repo's PUBLISHERS.md
  srcDir: 'static-pages/src',
  distDir: 'static-pages/dist',
  stampedPages: ['index.html'],            // default: every .html at srcDir's root
  copyAssets: true,                        // default true: everything else under srcDir, verbatim
  // Where the backend URL comes from. Only 'buildInfo' is supported — it cannot name a
  // deployment this deploy did not land in, and asserts env agreement before writing anything.
  webappUrl: { from: 'buildInfo', file: 'src/Version.js', envField: 'env' },
  placeholders: {                          // extra project-specific stamps, raw-token substitution
    STATIC_THEME_: (ctx) => THEME[ctx.env],
  },
  envs: {
    sit:  { deployTarget: 'test',       repoKey: 'staticRepoPath', dest: 'pub/app-sit', label: 'SIT' },
    prod: { deployTarget: 'production', repoKey: 'staticRepoPath', dest: 'pub/app',     label: 'PROD' },
  },
  liveUrl: (env) => `https://example.github.io/Static/pub/app${env === 'sit' ? '-sit' : ''}/`,
});
```

```js
const pipeline = require('./tools/static-pages.js');
await pipeline.build('sit');                                   // writes dist/sit/
await pipeline.publish('sit', { yes: true });                  // copies + commits + pushes
await pipeline.assertPublishedBuild('sit', '2.5.0.9');          // polls the live version.json
```

## Chaining off a deploy (the `gas-deploy` integration)

The page and the backend it talks to are one release, so publishing belongs *inside* the deploy,
not beside it. Two lines in the consumer's `manage-deployments.js` are the whole of it:

```js
const staticPipeline = require('./tools/static-pages.js');

runCli({
  // …
  postDeploy: staticPipeline.deployHooks(),   // build -> publish -> assertPublishedBuild
  extraRows:  staticPipeline.summaryRows(),   // the "Static page" row in the deploy summary
});
```

`deployHooks()` returns the three hooks in the only order that is safe, each `required: true` —
overriding `gas-deploy`'s warn-and-continue default, which is right for a hook whose failure
leaves working code live and wrong here: a new backend beside the previous page has shipped two
halves that disagree. `publish` is `chained`, so it does not re-prompt for the cross-repo push;
running the deploy was the confirmation.

`summaryRows()` is what puts `liveUrl(env)` in the end-of-deploy summary block — including on the
verification-failure path, which is when knowing which page is live matters most. It shares state
with `deployHooks()`, so a publish skipped for an unset `repoKey` says so instead of printing a
URL nobody just republished.

| option (both take the same) | meaning |
|---|---|
| `envFor` | `(ctx) => envKey` — deploy `targetKey` → static env. Default: the `targetKey` verbatim, so keying `envs` by target key needs no mapping table that can drift. Pass the same `envFor` to both calls. |
| `timeoutSec` / `intervalSec` | `deployHooks` only; passed to `assertPublishedBuild`. Default `timeoutSec: 300` — a CDN rebuild after push is slow, and a first publish into a new directory is slower. |
| `label` | `summaryRows` only. Default `'Static page'`. |

Hand-rolling these hooks is what `gas-static` exists to stop: the one project that did lost the
summary row, so its static URL scrolled past mid-deploy and was missing from the block a reader
keeps.

## Config reference

| key | meaning |
|---|---|
| `root` | Absolute project root. Everything else is relative to it. |
| `projectName` | This project's name as registered in the static-host repo's `PUBLISHERS.md` ownership map. Required once that host repo has a manifest — a publish whose `dest` is registered to a different project is refused. |
| `srcDir` / `distDir` | Source and per-env output directories, relative to `root`. |
| `stampedPages` | HTML files to stamp. Default: every `.html` file at `srcDir`'s own root (not recursive). |
| `copyAssets` | Copy everything else under `srcDir` (subdirectories included) into each env's `dist/<env>/` verbatim. Default `true`. |
| `webappUrl` | `{ from: 'buildInfo', file, envField }`. `file` is a **server-side** GAS version file (e.g. `src/BuildInfo.js`) carrying a `BUILD_INFO`-shaped literal whose `version` is a **bare semver**; `envField` (default `'env'`) is the BUILD_INFO key checked against each env's `deployTarget`. `from` accepts `'buildInfo'` only — [ADR-0001](../../adr/0001-webapp-url-from-build-info-only.md). **Footgun:** a project may also have a *client-side* version file (PracticeMix's `src/version.html`) carrying a `BUILD_INFO`-shaped literal whose `version` is a **display string** (`v1.6.7.8 (Rev. …)`). Point `file` at that one and `assertPublishedBuild` compares a display string against a semver and can never pass — and the GAS runtime cannot read an `.html` file at all, so the backend is not using it either. The file this key names must be the one the deploy stamps and the server executes. |
| `placeholders` | `{ TOKEN: (ctx) => value }` — extra project-specific tokens, substituted as raw text wherever `TOKEN` appears (not wrapped in a `var … = …;` declaration, unlike the two standard placeholders below). `ctx` is `{ env, envDef, version, webappUrl }`. |
| `envs` | Per-env config, see below. |
| `liveUrl` | `(env) => string` — the live base URL serving that env's `dist/` output (trailing slash optional). `assertPublishedBuild` appends `version.json`. |
| `settingsPath` | Default `<root>/local.settings.json`. |
| `commitMessage` | `({ env, envDef }) => string`, for the publish commit. Default `Publish static <env> (<label>)`. |

Per env: `deployTarget` (the `webappUrl.envField` value this env expects), `repoKey` (the
`local.settings.json` key holding the sibling static-host repo's path), `dest` (path within that
repo this env publishes to), `label`.

Standard placeholders, always stamped, present in all three pre-package copies:

```
var STATIC_BUILD_VERSION_ = null;   ->  var STATIC_BUILD_VERSION_ = "2.5.0.9";
var STATIC_WEBAPP_URL_ = null;      ->  var STATIC_WEBAPP_URL_ = "https://script.google.com/macros/s/.../exec";
```

Missing any stamped page's placeholder — standard or extra — is a hard failure and writes
nothing (all three pre-package copies already worked this way; kept, and made a single
in-memory-then-write pass so a mismatch found stamping page 2 of 2 does not leave page 1 written).

## What `runStatic()` returns

```js
{
  config,                                                  // the config as supplied, unmodified
  build(envKey),                                           // -> { outDir, version, webappUrl, env, builtAt }
  publish(envKey, options),                                // -> { published: true, repoRoot, dest }
                                                           //    or { skipped: true, reason: 'no-repo-path' | 'up-to-date' | 'cancelled' }
  assertPublishedBuild(envKey, expectedVersion, options),   // -> { ok: true, attempts, version, env, webappUrl }
  deployHooks(options),                                    // -> gas-deploy postDeploy hooks
  summaryRows(options),                                    // -> gas-deploy extraRows
}
```

`publish` options: `{ yes, chained, confirmFn, log, warn, exec }`. `assertPublishedBuild` options:
see below — the same shape as `gas-deploy`'s `verifyOptions`. `deployHooks()` and `summaryRows()`
share state through the object `runStatic()` returned, which is why the summary can say a publish
was skipped instead of printing a URL nobody republished; call both off the **same** pipeline
object.

The module also exports `buildEnv`, `publishEnv`, `assertPublishedBuild`, `deployHooks`,
`summaryRows` and **`readBuildInfo_`** directly. `readBuildInfo_(file, options?)` is public on
purpose: a consumer stamping extra placeholders off `BUILD_INFO` (a build date, say) must read that
literal with the *same* code the pipeline reads it with — the alternative is the duplicate regex
that had already re-diverged at the package's first consumer.

## `version.json`

Written alongside each stamped page, and the *only* thing `assertPublishedBuild` reads:

```jsonc
{ "version": "2.5.0.9", "env": "sit", "webappUrl": "https://script.google.com/macros/s/AKfy…/exec", "builtAt": "2026-08-22T14:03:11.000Z" }
```

## Env-agreement assertion

`buildEnv` resolves `webappUrl`/`version` from `BUILD_INFO` and requires
`BUILD_INFO[envField] === envs[env].deployTarget` *before* writing anything. This is the guard
only one of the three pre-package copies had (GActionSheet) — it is what prevents publishing a
page pointed at last deploy's URL because the version file wasn't re-stamped for the env being
built.

## Publish

- `dest` is validated **before anything is written** (see *Publish safety* below).
- Missing `envs[env].repoKey` in `local.settings.json` = **warn and skip**, not a hard failure —
  a fresh clone without the sibling static-host repo checked out should not fail a deploy.
- A `repoKey` path that isn't a git checkout = throw.
- `git status`/`git add` are always scoped to `envs[env].dest` — an unscoped add publishes
  another app's half-finished work out of a shared host repo (RCV's finding).
- An already-clean `dest` is a no-op (skipped, not committed).
- A cross-repo push prompts for confirmation unless `chained: true` (invoked from a pipeline that
  already confirmed) or `yes: true` (non-interactive). Supply `confirmFn: async (message) =>
  boolean` for the prompt implementation — the package has no UI dependency of its own.
- `git fetch` + `git pull --rebase --autostash` run immediately before the publish commit, and the
  checkout must be on a branch with a tracking branch. A failed push raises a named diagnostic
  saying the commit exists locally and how to finish it.

## Publish safety — the host repo's `PUBLISHERS.md`

A static-host repo is shared by several project repos, each owning one folder, and the publish
starts by `rm -rf`-ing the folder it is about to write. So the host repo declares who publishes
what, and this package refuses anything that declaration does not authorise — GAS-Core
[ADR-0003](../../adr/0003-publish-ownership-manifest.md).

`PUBLISHERS.md` at the host repo root carries the human half (built output only, never hand-edited,
each folder owned 100 % by its originating repo, the folder → project → live-URL table) and one
fenced ```json block — **the first one in the file** — that this package reads:

```jsonc
{
  "pub/app-sit": { "project": "DemoApp", "env": "test", "url": "https://example.github.io/Static/pub/app-sit/" },
  "pub/app":     { "project": "DemoApp", "env": "prod", "url": "https://example.github.io/Static/pub/app/" }
}
```

- A `dest` with no exact entry is **refused**, listing what is registered.
- A `dest` whose entry names a different `project` than `config.projectName` is **refused**, naming
  the registered owner.
- A manifest present with no `config.projectName` declared is **refused** — ownership cannot be
  checked.
- Structural backstop, always active even with no manifest: a `dest` that is empty, absolute,
  contains `..`, resolves outside the host repo, resolves *to* the host repo, or names a `.git`
  directory is refused. `rm -rf` is unreachable until every check passes.
- A **missing or malformed** manifest warns and falls back to the structural checks only — the
  bootstrap window before a host repo has one. It is not a way to opt out: add the manifest.

Registering a new published folder is therefore a deliberate, reviewed two-line edit in the repo
that owns the namespace.

## `assertPublishedBuild`

Polls `liveUrl(env) + 'version.json'` until the published build agrees with what was just deployed.
No flag to turn it off when chained as a `postDeploy` step of `gas-deploy`'s `runCli` — a published
front end the CDN hasn't picked up yet is indistinguishable from a failed fix.

```js
{
  intervalSec = 5,
  timeoutSec = 300,          // the measured range is 35 s to ~90 s; 60 was under it
  expectedEnv,               // default: the env being asserted. `null` opts out.
  expectedWebappUrl,         // default: BUILD_INFO's webappUrl. `null` opts out.
}
```

**All three fields `version.json` carries are asserted, not just `version`.** The env-agreement
guard runs at *build* time only, so a `dist/prod` copied into a `test` dest, or a page published
from a stale `dist/`, used to satisfy this assertion (PLAN2 F6). Under `deployHooks()` the two
extra expectations come straight from the build step's own result, so both hooks are talking about
the same build rather than re-reading `BUILD_INFO`.

The two kinds of disagreement are not the same failure and are not handled the same way:

| Field | On mismatch | Why |
|---|---|---|
| `version` | keep polling to `timeoutSec` | the previous build is still being served — propagation |
| `env`, `webappUrl` | fail on the first read | the right *version* is serving and it is the wrong build; nothing about that converges |

The page must also tell the truth about version agreement at **runtime** — see
`best-practices/gas-static-frontend/README.md` §The static page interface contract, which this
assertion is the deploy-time half of.

## Provenance — where each behaviour came from, and what was left behind

This package is an extraction, not a design. F3Go30, RankChoiceVoting and GActionSheet each
hand-wrote the same three steps and had already diverged; PracticeMix was about to become the
fourth. Recording which copy each behaviour came from is what stops a converting project from
re-adding something that was dropped on purpose, or re-litigating a call already settled.

**Taken, and from where:**

| Behaviour | Source |
|---|---|
| Standard placeholder stamping (`STATIC_BUILD_VERSION_`, `STATIC_WEBAPP_URL_`) and missing-placeholder-is-a-hard-failure | all three copies agreed |
| Stamping every page **into memory first**, writing only after all succeed | **new** — none of the three did it. A two-page project used to leave page 1 written when page 2 failed. The env-agreement guard's "writes nothing" requirement forced the discipline, so it was applied uniformly |
| `deployTarget ↔ static env` as declared config (`envs`) | generalised from RCV's per-env `DEPLOYMENT_ID_KEY`/`THEME` object and GActionSheet's `ENV_MAP` |
| `webappUrl: { from: 'buildInfo' }` **and the env-agreement assertion** | GActionSheet's `readBuildInfo_` / `ENV_MAP.buildInfoEnv` check — the only copy that had it, and the reason this mode is the one that survived |
| Scoped `git add` / `git status` on `dest` | RCV's and GActionSheet's, which carry the same comment: an unscoped add publishes another app's half-finished work out of a shared host repo |
| Missing static-repo path = warn and skip | GActionSheet's posture, not F3Go30's and RCV's hard `process.exit(1)` — a fresh clone without the sibling repo should not fail a deploy |
| Confirm before a cross-repo push | GActionSheet's `confirm()`/`--yes`, generalised to an injected `confirmFn` (the package has no UI dependency) plus `chained` for pipeline invocation |
| `assertPublishedBuild` | **new** — none of the three read `version.json` back (RCV's own comment: "not currently read back"). Modelled on `gas-deploy`'s `assertDeployedVersion`: same poll/timeout/inject shape, pointed at the CDN instead of a `cmd=version` route |
| `PUBLISHERS.md` ownership guard and the pre-commit rebase | **new**, from the review that followed the first conversion — see §Publish safety and [ADR-0003](../../adr/0003-publish-ownership-manifest.md) |

**Deliberately not ported.** Each of these was in one of the copies and was left there:

- **F3Go30's CSP meta-tag generation** (`buildCspMeta_` / `collectScriptHashes_` / `insertCsp_`).
  A page-content concern specific to that project's PWA design, not a pipeline concern — "the
  package owns the pipeline, never the page". It stays in F3Go30. Whether the package should grow a
  consumer-side `transformPage(html, ctx)` hook instead is decided at F3Go30's conversion, where a
  real second use would justify it.
- **RCV's theme / theme-fonts / dev-contact stamping** (`devContactFromVersionJs_`) and
  **GActionSheet's `doc.html` multi-page-per-env specifics**. Both are already expressible through
  the generic `placeholders` map and `stampedPages` list with no package change, so hardcoding them
  would add surface for nothing. **Confirmed at RCV's conversion**: all three of its tokens went
  through `placeholders` untouched, including the two that are not `var … = null;` declarations
  (`data-theme="STATIC_THEME_"` and an HTML comment) — raw-token substitution covers them because
  it makes no assumption about the token's shape.
- **F3Go30's and RCV's deployment-ID `webappUrl` mode** — resolving `/exec` from a
  `local.settings.json` deployment ID with no `BUILD_INFO` round trip. Not a gap:
  [ADR-0001](../../adr/0001-webapp-url-from-build-info-only.md) records why a binding that is
  reconciled against nothing must not become the path of least resistance for the next consumer.
- **F3Go30's `wait-for-static-deploy.js`** (polling the published page for a
  `STATIC_BUILD_VERSION_` regex match) and **RCV's `smokeTestStaticApi.js` step 11**. Both are
  superseded by `assertPublishedBuild` reading `version.json`, which asserts three fields instead of
  scraping one out of a page body. A converting project retires them rather than keeping them
  alongside — RCV's step 11 was deleted at its conversion, along with the fourth hardcoded copy of
  the static URL it needed in order to scrape.
- **`static-urls.js` generalisation** (R9) — see below.
- **The three source projects themselves.** G1 extracted the package and converted exactly one
  consumer (PracticeMix), deliberately: converting three at once is the mistake this shape of work
  exists to avoid. The remaining conversions are their own stages — **RankChoiceVoting is now
  converted** (bead `GAS-Core-d7i`), leaving GActionSheet (`GAS-Core-rgh`) and F3Go30
  (`GAS-Core-hek`). RCV's conversion needed **no change to this package**, which is the result the
  staging deliberately sequenced it to test.

## What this package deliberately does not do

These are guardrails, not gaps. Each one was proposed, considered, and declined; re-opening one
needs a reason the survey of four independent implementations did not already answer.

- **No bundler, no framework, no page templating.** Four projects independently hand-wrote one
  self-contained HTML file, and every one of them says that was the right call. A build step that
  can only substitute tokens is a build step nobody has to debug.
- **The package owns the pipeline, never the page.** Anything about the page's *content* —
  CSP meta generation, themes, fonts, component markup — stays in the consumer, expressed through
  `placeholders` and `stampedPages` if it needs build-time values at all.
- **No shared static "framework" or component library.**
- **Not folded into the demo harness.** A `webapp-html` kind rendered through
  `HtmlService.createTemplateFromFile()` is fine for a lightweight internal demo page, but it is
  a different and lesser thing: this pattern exists specifically to escape the sandboxed iframe,
  and a demo running *inside* one cannot demonstrate it.
- `static-urls.js` generalisation (R9, bead `GAS-Core-hek`) — declaring the static base URL once,
  GAS-side, and reading it back from Node tooling. Not yet needed by a second consumer; decided at
  F3Go30's conversion, which is the second consumer that would justify it.
- The brokered-identity model (R5/R6/R7 — beads `GAS-Core-l81`, `GAS-Core-na8`) — orthogonal to
  the pipeline, and a page/backend concern rather than a build one; see
  [`best-practices/gas-static-frontend/README.md`](../../best-practices/gas-static-frontend/README.md)
  §"Two identity models — pick deliberately".
- A standalone CLI (`bin/`) — no consumer runs build/publish outside `deployHooks()` yet. F3Go30 and
  GActionSheet do today with their own scripts; whether this package should own that path is decided
  at the RCV/F3Go30 conversions (PLAN2 S17), where a second consumer's actual usage settles it,
  alongside the `webappUrl.from: 'resolve'` question it's coupled to.

## Tests

```bash
node --test test/*.test.js
```
