# Changelog — gas-static

## 1.1.0

- Adds `lib/deploy.js`:
  - `deployHooks(opts)` — the build → publish → `assertPublishedBuild` chain as `gas-deploy`
    `postDeploy` hooks, in the one safe order, each `required: true` (overriding `gas-deploy`'s
    warn-and-continue default, which is wrong when a stale static page would ship beside a fresh
    backend). Publish runs chained; `assertPublishedBuild`'s timeout is 300s. `envFor` maps a deploy
    target key onto a differently-named static env.
  - `summaryRows(opts)` — the `(ctx) => rows` function `gas-deploy`'s `extraRows` takes, sharing state
    with the hooks so a publish skipped for an unset repo path is reported as skipped rather than
    printing a URL nobody actually republished.
- Fixes the dropped deploy-summary row: a consumer hand-rolling this hook chain itself (as PracticeMix
  originally did) tends to lose the published-page row from the deploy summary — the part a reader
  actually keeps.

## 1.0.0

- Initial extraction: one implementation of the stamp → publish → verify pipeline that F3Go30, RCV
  and GActionSheet had each hand-copied, mirroring `packages/gas-deploy`'s shape.
- Adds the env-agreement assertion (only GActionSheet's copy had it) and `assertPublishedBuild` (none
  of the three copies read `version.json` back after publishing).
- PracticeMix is the first and only consumer at this version; the three existing hand-rolled copies
  are deliberately not converted yet (see PLAN2 F7).
