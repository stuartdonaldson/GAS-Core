# ADR-0002: Declared configuration lives in two files, not one

Status: Accepted
Date: 2026-08-24
Supersedes: [None — new decision]

## Context

`best-practices/gas-deployment/RECOMMENDATION-declared-config.md` §6 left one question open, and
three beads (`GAS-Core-9iu`, `GAS-Core-8w0`, `GAS-Core-hl5`) sit behind it: does a project declare
its deployment configuration in **one** file or **two**?

The rest of that document is agnostic to the answer. It establishes that the deployment **anchor**
(`TEST-WEB-APP`) is the one environment fact a human supplies, that the deployment **ID** is a cache
the deploy writes back and validates against the live list, and that the same fact gets the same
canonical key in every project (`scriptId`, `deploymentId`, `adminSecret`, `staticRepoPath`, …).
None of that depends on file layout — but implementation does.

The two shapes:

- **Two files** — a committed `gas-project.json` (envs, anchors, labels, counters, static
  destinations, the admin declaration and its ungated list) plus the gitignored
  `local.settings.json` (clasp auth, secrets, machine paths, and the deployment-ID cache).
- **One file** — everything stays in the gitignored `local.settings.json`, with anchors and static
  destinations added to each env block.

Today every project in the estate is on the one-file shape, and the consequence is visible: project
constants are re-entered on every machine, are never reviewed, and drift silently between
developers. That is the failure the declared-config work exists to remove.

One datapoint exists on cost. PracticeMix's P4 adopted the canonical `staticRepoPath` key rather
than a fourth project-local spelling of "the static repo" (`tools/static-pages.js`,
`local.settings.example.json`, `tests/unit/static-pages.test.js`). The adoption cost was zero: the
key was chosen at the moment the config was being written anyway. That says nothing about migrating
an existing project, but it does say the canonical-naming half of this work is free when taken at
the right moment — which is an argument for pairing the file split with a conversion rather than
running it standalone.

## Decision

Declared configuration is **two files**: a committed `gas-project.json` holding project truth, and
the gitignored `local.settings.json` holding machine truth and secrets.

The dividing line is *reviewability*: a fact that is the same for every developer on the project
(anchors, env names and their deploy targets, static publish destinations, labels, the admin
declaration) belongs in git, where a typo is caught in review once instead of per machine. A fact
that is per-machine or secret (clasp auth path, `adminSecret`, absolute paths, the deployment-ID
cache the deploy writes back) belongs in the file git never sees.

This is the recommendation §6 already stated; it is adopted here rather than re-argued. The whole
argument of §3 is that the anchor is project truth, and project truth should not live in a file git
never sees.

**No consumer repo migrates on this ADR alone.** The shape is validated against one real project
first — the RankChoiceVoting conversion (PLAN2 S15), which is touching that project's config
anyway — and only if it survives that conversion unchanged do the remaining four repos move in one
pass. A five-repo migration on an unvalidated shape is the failure mode this sequencing exists to
avoid.

## Consequences

**Easier:**
- A new developer clones and supplies only secrets; every project constant is already correct.
- A wrong anchor, a wrong deploy target, or a wrong static destination becomes a reviewable diff
  rather than a per-machine surprise.
- `gas-deploy`'s `*Key` indirection (`scriptIdKey`, `deploymentIdKey`, `secretKey`) can degrade to a
  legacy override for unmigrated projects instead of being the normal way to configure one.
- The three blocked beads (`GAS-Core-9iu`, `-8w0`, `-hl5`) can proceed.

**Harder:**
- A new file exists in every project, and every project needs a migration — mechanical, but five
  times over.
- Readers must know which half a given key lives in. The canonical key table stays the reference,
  and the split has to be stated in each package README that reads config.
- Two files can disagree: an env declared in `gas-project.json` with no matching secret in
  `local.settings.json` must fail loudly and by name, or the split trades silent drift for silent
  absence.

**Trade-off accepted:** the migration cost and the second file cost less than project constants that
no one can review. The sequencing (validate on RankChoiceVoting, then migrate the rest) caps the
downside — if the shape is wrong, one repo is affected, not five.
