# ADR-0001: `gas-static` resolves the web-app URL from `BUILD_INFO` only

Status: Accepted
Date: 2026-08-24
Supersedes: [None — new decision]

## Context

Every static front end built by `packages/gas-static` must answer one question at build time: what
`/exec` URL does the published page POST to? That URL is baked into the page and served from a CDN,
so a wrong answer is not discovered by the build — it is discovered by a user.

Two mechanisms exist in the estate today.

| | **Mode A — `from: 'buildInfo'`** (`packages/gas-static/lib/build.js:23`) | **Mode B — deployment ID read from settings** (F3Go30, RankChoiceVoting) |
|---|---|---|
| Mechanism | `gas-deploy` resolves the named deployment during *this* deploy (`resolveBeforeStamp: true`), `buildInfoStamper` writes `{version, buildDate, env, webappUrl}` into a GAS-side file, and the static build reads that file back | the build reads a deployment ID out of `local.settings.json` and constructs `https://script.google.com/macros/s/<id>/exec` |
| Produced when | by the deploy running right now | whenever the ID was last written or hand-entered |
| Reconciled against | the live resolver chain (`settingsId → anchorMatch → soleActiveDeployment`) on that same run | nothing, at build time |
| Carries `env`? | yes — which is what enables the env-agreement assertion: refuse to build if `BUILD_INFO.env` disagrees with the env being built | no — a `prod` dist can be built against a `test` deployment and nothing notices |
| Can build without deploying? | no — a clean clone must deploy (or hold a stamped file) first | yes — no clasp auth, no network |
| Failure mode | a missing or stale stamp fails loudly at build time | a deleted or recreated deployment bakes a **dead URL into a published page** |

Mode B's advantage is real, and is why two projects chose it: it decouples the static build from the
deploy. `RECOMMENDATION-declared-config.md` §3 defends keeping a cached deployment ID for the same
reasons — the no-clasp-auth path, deletion detection, and cost. But it defends the cache as a
*fallback for resolution*, where `resolveEnvDeploymentId` validates the cached ID against the live
deployment list and refuses loudly when it has vanished. A build-time read of that same file does
neither.

Three consumers (F3Go30, RankChoiceVoting, GActionSheet) remain unconverted, and the missing Mode B
support in `gas-static` has been named as the blocker for two of them.

## Decision

`gas-static`'s `config.webappUrl.from` accepts `'buildInfo'` and nothing else. A `deploymentId` mode
is refused: unconverted consumers move to Mode A rather than the package growing a mode to match
them.

Adding `from: 'deploymentId'` would place the unreconciled binding inside the package and make it
the path of least resistance for the next consumer — the opposite of what the package exists to do.
Converting instead is cheap: `gas-deploy` already supports `resolveBeforeStamp`, so the change per
project is a config flag plus a `BUILD_INFO` literal server-side.

If standalone build without deploying is ever genuinely required — established by a conversion
actually blocking on it, not assumed — the correct third mode is **`from: 'resolve'`**: call the
same `resolveEnvDeploymentId` chain the deploy uses, at build time, so the anchor is matched against
the live deployment list and a vanished deployment is refused rather than published. That keeps the
reconciliation and drops the deploy coupling. It is named here so the next reader reaches for it
rather than for `deploymentId`, and it is not built until a conversion demands it.

## Consequences

**Easier:**
- Every published page carries a URL that was reconciled against the live deployment list on the run
  that produced it. A vanished or recreated deployment fails the build instead of shipping.
- The env-agreement assertion is available to every consumer, because `env` travels with the URL in
  the same stamp. Only one of the three pre-package copies (GActionSheet) had this guard.
- One mode means one code path to test, and no per-consumer question of which mode a project is on.

**Harder:**
- A clean clone cannot build a correct static page without first deploying (or possessing a stamped
  `BUILD_INFO`). Building on a machine with no clasp auth, and republishing a page without
  redeploying the backend, both stop being possible.
- F3Go30 and RankChoiceVoting must adopt `resolveBeforeStamp` plus a server-side `BUILD_INFO`
  literal as part of their conversion — a small change, but one that cannot be skipped.
- The escape hatch for a project that genuinely needs a standalone build does not exist yet, so the
  first conversion that hits that requirement is blocked until `from: 'resolve'` is built.

**Trade-off accepted:** losing the standalone build costs less than the failure it prevents. A dead
`/exec` URL in a CDN-cached page is found by a user, is served until the cache expires, and gives no
signal at build time; needing to deploy before building is an inconvenience that fails immediately
and loudly.
