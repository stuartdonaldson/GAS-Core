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
  "gas-static": "github:stuartdonaldson/GAS-Core#gas-static-v1.0.0&path:/packages/gas-static"
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

## Config reference

| key | meaning |
|---|---|
| `root` | Absolute project root. Everything else is relative to it. |
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

- Missing `envs[env].repoKey` in `local.settings.json` = **warn and skip**, not a hard failure —
  a fresh clone without the sibling static-host repo checked out should not fail a deploy.
- A `repoKey` path that isn't a git checkout = throw.
- `git status`/`git add` are always scoped to `envs[env].dest` — an unscoped add publishes
  another app's half-finished work out of a shared host repo (RCV's finding).
- An already-clean `dest` is a no-op (skipped, not committed).
- A cross-repo push prompts for confirmation unless `chained: true` (invoked from a pipeline that
  already confirmed) or `yes: true` (non-interactive). Supply `confirmFn: async (message) =>
  boolean` for the prompt implementation — the package has no UI dependency of its own.

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

## Tests

```bash
node --test test/*.test.js
```
