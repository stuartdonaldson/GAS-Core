# Changelog — gas-deploy

## 1.4.1

- **`assertDeployedVersion` default `timeoutSec` doubled, 60 → 120.** Real deploys were observed
  taking longer than 60s to settle (edge propagation lag past what PLAN2 F8's settling logic
  assumed). Projects that don't pass `verifyOptions.timeoutSec` now get the longer budget for
  free; anything already passing its own `timeoutSec` is unaffected.

## 1.4.0

- **`gas-project.json` — the committed half of the declared-config split** ([ADR-0002](../../adr/0002-declared-config-two-files.md),
  narrowed by [ADR-0004](../../adr/0004-project-truth-is-identifiers-not-declarations.md)). A target's
  `scriptId` and `sheetId` are project truth — the same for every developer — so they now live in a
  committed file, scoped structurally by target key (`envs.sit.scriptId`), where a typo is caught in
  review once instead of per machine. `local.settings.json` keeps machine truth and secrets: clasp
  auth paths, admin secrets, the deployment-ID cache the deploy writes back.
- **Nothing changes for an unmigrated project.** With no `gas-project.json` present, every lookup
  degrades to the existing `*Key` indirection into `local.settings.json`, which stays supported as a
  legacy override. All 86 pre-existing tests pass unchanged.
- **Both directions of disagreement fail or report by name**, which is the cost ADR-0002
  §Consequences named — the split trades silent drift for silent absence unless every disagreement
  says so. An env declared in `gas-project.json` with no `claspAuth`/`authKey` in
  `local.settings.json` throws before anything shells out, naming the env, the key and both files. A
  target missing from a declared `envs` block throws, listing what *is* declared. A fact carried by
  both files takes the committed value and warns, naming the stale key to delete — silently
  preferring one would hide the very drift the split removes. A malformed `gas-project.json` is a
  named config error, not `Unexpected end of JSON input`.
- New `lib/project.js` (`loadProjectConfig`, `targetFact`); `config.projectFile` overrides the
  filename. Validated on RankChoiceVoting's conversion before any other repo migrates.

## 1.3.0

- **`assertDeployedVersion` settles on N consecutive agreeing reads** — `verifyOptions.settleReads`,
  default **2**, `1` restores the previous behaviour (PLAN2 F8). A single agreeing read only proves
  *an* edge has turned over: three PracticeMix stages independently watched `cmd=version` answer
  with the new version while one action still ran old code, converging in ~1 min for a code change
  and ~90 s for a manifest change. A disagreeing read resets the count, and a fleet that never
  settles times out saying so rather than reporting a plain expected-vs-actual.
  **Every deploy is now at least one poll interval (5 s) longer** — that is the cost of the proof.
- **The deploy summary's last row names the tooling versions** resolved from the consumer's own
  `node_modules` — `gas-deploy v1.3.0 · gas-static v1.3.0` (PLAN2 F10). Five repos consume these
  packages by git tag and three sat two minor versions behind with nothing anywhere saying so. New
  `lib/tooling.js` (`resolveToolingVersions`, `toolingRow`); the row never fails a deploy, printing
  `(not resolvable from this checkout)` when it cannot resolve either package.

## 1.2.1

- Documented `local.settings.json`: there is no fixed schema — every key is named by the consumer's
  own `*Key` config, not by the package.
- Documented the relationship between `target.anchor` and `describeDeployment`, and that
  `clasp deploy -d` **replaces** rather than appends — breaking the anchor/description pair fails one
  deploy later than the actual mistake.
- Ships `local.settings.example.json`; `lib/cli.js`'s "copy the .example" error now names that real
  path instead of a file that never existed.

## 1.2.0

- `bin/call-webapp.js` accepts an opt-in `postFn`, so a consumer whose web app is deployed
  `access: ANYONE` (not `ANYONE_ANONYMOUS`) — where the package's bare HTTPS POST can't reach a page
  that requires a signed-in Google session — can supply its own POST transport while still reusing
  the package's URL resolution and body/secret handling.

## 1.1.0

- `claspFields`: `.clasp.json` regeneration now accepts more than `{scriptId, rootDir}`, so a project
  with a GCP project, a Drive parent, or non-`.js` sources doesn't have its `clasp push` file set
  silently changed by the deploy. `scriptId`/`rootDir` are always written last, so a config can never
  override the target actually being deployed to.
- `resolveBeforeStamp` (opt-in): resolves the deployment **before** stamping its `/exec` URL into the
  project's version file, for a project (e.g. GActionSheet) whose stamped `webappUrl` must be the
  value the GAS runtime's `getWebAppUrl()` returns. Costs no extra `clasp deployments` call — the same
  resolution just happens earlier.
- `prePush` hooks (default required): run source-regeneration steps that must be part of the push
  itself (e.g. F3Go30's How-it-Works panels).
- `securedCmds`: scopes the admin secret to only the endpoints that actually gate on it, instead of
  every endpoint.
- Config keys renamed for clarity: `claspAuthKey`/`claspRootDir` → `authKey`/`rootDir`; the
  `'claspAuth'` default now lives in the package, so a consumer config never needs to spell the
  string `clasp` itself.
- `readLocalVersion` may return `{version, now}` so `--summary` can print the stamp time.

## 1.0.0

- Initial extraction: one implementation of the six deploy steps every GAS project had been
  hand-copying, replacing seven diverged copies of `manage-deployments.js`. See
  `best-practices/gas-deployment/RECOMMENDATION.md` for the survey that drove it.
- `lib/clasp.js` — `claspEnv` (always sets `clasp_config_auth`), `parseDeployments`,
  `resolveRevision` (stdout parse with a live-list fallback), `execWithRetry`.
- `lib/version.js` — bump/reset counters, `computeVersion`; `package.json` is the sole source of
  truth, and the stamped file is never read back.
- `lib/stampers.js` — `constStamper` (lineage B) and `buildInfoStamper` (lineage A).
- `lib/resolvers.js` — `settingsId` / `anchorMatch` / `soleActiveDeployment` resolution chain.
- `lib/verify.js` — `assertDeployedVersion`, `queryLiveVersion`, `pingWebapp`.
- `lib/webapp.js` — the single HTTP client; secrets travel in the request body only, never a header
  or query string.
