# Changelog — gas-static

## 1.3.0

- **`assertPublishedBuild` asserts all three fields `version.json` carries** (PLAN2 F6), not just
  `version`: new `expectedEnv` (default: the env being asserted) and `expectedWebappUrl` (default:
  `BUILD_INFO`'s `webappUrl`), each opt-out-able with `null`. The env-agreement guard ran at *build*
  time only, so a `dist/prod` copied into a `test` dest, or a page published from a stale `dist/`,
  satisfied the old assertion. A version mismatch still polls (propagation); an env/webappUrl
  mismatch on a page already serving the right version fails on the first read, because nothing
  about a wrong build in the right place converges.
- `deployHooks()`'s verify step passes the env and `/exec` URL the **build step just resolved**, so
  the two hooks cannot be talking about different builds.
- **Default `timeoutSec` raised from 60 to 300** (PLAN2 F8). The measured propagation range is 35 s
  (first Pages publish) to ~90 s (manifest change); 60 contradicted all of it. `deployHooks()`
  already passed 300, so only direct callers change — and they change to the honest number.
- **`readBuildInfo_` is scoped to the `BUILD_INFO` literal and returns every field found**, `buildDate`
  included (PLAN2 F13). The old regex took the first `"name": "…"` match anywhere in the file, so a
  comment or a second literal above `BUILD_INFO` silently won; and because it returned a fixed three
  fields, PracticeMix wrote a duplicate regex of its own for `buildDate` — the package's field-reader
  re-diverging at its first consumer. A file with no such literal now throws by name instead of
  returning empty strings. New `options.literalName` for a differently-named literal.

## 1.2.0

- **Publish safety (PLAN2 F3/F4, [ADR-0003](../../adr/0003-publish-ownership-manifest.md)).** The
  static-host repo now declares who publishes what in a `PUBLISHERS.md` ownership map, and
  `publishEnv` validates `dest` against it *before* `copyDir_()`'s `rm -rf` is reachable: an
  unregistered `dest`, a `dest` registered to another project, or a manifest with no
  `config.projectName` declared all refuse the publish by name. New `lib/publishers.js`.
- Structural backstop, active even with no manifest present: a `dest` that is empty, absolute,
  contains `..`, resolves outside the host repo, resolves *to* the host repo, or names a `.git`
  directory is refused. A missing or malformed manifest warns and leaves these as the only guard.
- **Automatic rebase before the publish commit.** `git fetch`, an assertion that the checkout is on
  a tracking branch, and `git pull --rebase --autostash` now run immediately before the commit, so a
  concurrent publish from another project no longer turns into a rejected push with the page
  committed locally and nothing published. Safe unattended because the ownership rule makes the
  published paths disjoint. A failed push raises a named diagnostic saying the commit exists locally
  and how to finish it.
- New config key: `projectName` — required once the host repo has a `PUBLISHERS.md`.

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
