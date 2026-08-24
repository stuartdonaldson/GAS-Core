# Changelog — gas-deploy

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
