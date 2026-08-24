# gas-static

The shared static-front-end build/publish/verify pipeline for Google Apps Script projects that
escape `HtmlService`'s sandboxed iframe. One implementation of the three steps F3Go30, RCV and
GActionSheet each hand-copied: **stamp, publish, verify** — mirroring `gas-deploy`'s shape.

Background and the drift this replaces:
`best-practices/gas-static-frontend/RECOMMENDATION.md` §3.1.

The package owns the *pipeline*, never the page: no bundler, no framework, no page templating.
Every surveyed project hand-wrote one self-contained HTML file and every one of them says that
was the right call.

## Install

pnpm only, same reason as `gas-deploy` (npm has never supported subdirectory git dependencies):

```jsonc
"dependencies": {
  "gas-static": "github:stuartdonaldson/GAS-Core#gas-static-v1.2.0&path:/packages/gas-static"
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
| `webappUrl` | `{ from: 'buildInfo', file, envField }`. `file` is a GAS-side version file (e.g. `src/Version.js`) carrying a `BUILD_INFO`-shaped literal; `envField` (default `'env'`) is the BUILD_INFO key checked against each env's `deployTarget`. |
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

Polls `liveUrl(env) + 'version.json'` until the reported `version` matches. No flag to turn it
off when chained as a `postDeploy` step of `gas-deploy`'s `runCli` — a published front end the
CDN hasn't picked up yet is indistinguishable from a failed fix.

```js
{ intervalSec = 5, timeoutSec = 60 }   // same shape as gas-deploy's verifyOptions
```

## What this package deliberately does not do

- No bundler, no framework, no page templating.
- No shared static "framework" or component library.
- `static-urls.js` generalisation (R9) — not yet needed by a second consumer.
- The brokered-identity model (R5/R6/R7) — orthogonal; see
  `best-practices/gas-static-frontend/RECOMMENDATION.md` §3.3.
- A standalone CLI (`bin/`) — no consumer runs build/publish outside `deployHooks()` yet. F3Go30 and
  GActionSheet do today with their own scripts; whether this package should own that path is decided
  at the RCV/F3Go30 conversions (PLAN2 S17), where a second consumer's actual usage settles it,
  alongside the `webappUrl.from: 'resolve'` question it's coupled to.

## Tests

```bash
node --test test/*.test.js
```
