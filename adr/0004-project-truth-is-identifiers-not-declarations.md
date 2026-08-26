# ADR-0004: The committed config file holds per-env identifiers, not env declarations

Status: Accepted
Date: 2026-08-25
Supersedes: [ADR-0002](0002-declared-config-two-files.md)

## Context

[ADR-0002](0002-declared-config-two-files.md) decided that declared configuration lives in two
files — a committed `gas-project.json` and the gitignored `local.settings.json` — split by
*reviewability*. It also listed what the committed half holds: "envs, anchors, labels, counters,
static destinations, the admin declaration and its ungated list". That list was written before any
project had been migrated, and ADR-0002 said so explicitly: no repo migrates on that ADR alone, the
shape is validated against RankChoiceVoting first, and if the shape has to bend the right move is a
superseding ADR rather than an edit.

The conversion ran (bead `GAS-Core-d7i`). The shape bent, in one specific way.

**Every item on that list is already in a committed, reviewable file** — the project's JS config
module. A `gas-deploy` consumer declares its envs, labels, counters and anchors in
`tools/manage-deployments.js`; a `gas-static` consumer declares its static destinations in
`tools/static-pages.js`. Both are checked into the project repo. They were never in
`local.settings.json`, so they were never re-entered per machine and never drifted between
developers — which is the failure ADR-0002 §Context names as the reason the split exists.

What *is* still in the gitignored file, and is identical for every developer, is the set of per-env
**identifiers**: RankChoiceVoting's `sitScriptId` / `prodScriptId` / `nuucScriptId` and its three
`*SheetId` keys. Nine values, no secrets among them — an Apps Script project ID appears in every
editor URL — re-entered by hand on every machine, reviewed by nobody. Those are the constants
ADR-0002 was actually describing.

So the ADR's list and the ADR's own rationale point at different files. Moving the declarations
into JSON would satisfy the list while curing nothing, and would leave `gas-deploy` and `gas-static`
carrying two declaration mechanisms — a JS config surface and a JSON one — where a reader must now
know which of the two a given project used.

One more class of fact turned out to sit with the identifiers rather than the declarations. The
static host a project publishes to — the repo (`f3go30/static-pages`), the GitHub Pages base URL it
is served at, and this project's own registered folder within it (`ballot/sit`) — had **three**
copies in RankChoiceVoting: `tools/manage-deployments.js`'s `STATIC_ENTRY_BASE_URL`,
`tools/publish-static-pages.js`'s `DEST_MAP`, and `script/ApiBridge.js`'s `_staticPagesBaseUrl_`.
The third is a GAS-side runtime file, which cannot `require()` the other two, so no JS module can be
the single source for all three consumers. These are identifiers of an external resource in exactly
the sense `scriptId` is — and `dest` is not even declared here in the first place: the authoritative
declaration is the host repo's `PUBLISHERS.md` ownership map ([ADR-0003](0003-publish-ownership-manifest.md)),
which this only references.

## Decision

The committed `gas-project.json` holds **per-env identifiers of external resources**, scoped
structurally by target key: the Apps Script project (`scriptId`), the spreadsheet (`sheetId`), and
the static host this env publishes to (its repo, its Pages base URL, and this project's registered
folder in it).

```jsonc
{
  "envs": {
    "sit": {
      "scriptId": "1tGLrQ…",
      "sheetId":  "1RCQlZ…",
      "static":   { "host": "f3", "dest": "ballot/sit" }
    }
  },
  "staticHosts": {
    "f3": { "repo": "f3go30/static-pages", "pagesUrl": "https://f3go30.github.io/static-pages/", "repoKey": "staticRepoPath" }
  }
}
```

**Env declarations stay in the project's JS config module.** Labels, counters, emoji, anchors,
deploy targets and the admin declaration remain where they are — committed, reviewable, and
expressed in the one mechanism the packages already have.

The test is *what kind of fact it is*, not who reads it: an identifier names something outside the
repo that the project did not invent and cannot change by editing code; a declaration is a choice
the project made about how it deploys. The `liveUrl` a page is served at is **composed** from
identifiers (`pagesUrl + dest`) rather than declared separately, so it cannot drift from the folder
actually published to.

ADR-0002's decision survives intact: configuration is two files, and the dividing line is
reviewability. What changes is which facts were on the wrong side of that line. ADR-0002 assumed
the answer was "the declarations"; the answer is "the identifiers", because the declarations were
never in the gitignored file to begin with.

A fact that is per-machine or secret — clasp auth paths, admin secrets, API tokens, absolute paths,
and the deployment-ID cache the deploy writes back — stays in `local.settings.json`, unchanged.

## Consequences

**Easier:**
- The migration for the remaining four repos is *smaller* than ADR-0002 implied: move `scriptId`,
  `sheetId` and the static-host identifiers into a new committed file and delete them from
  `local.settings.json`. No config module is restructured, and no package grows a second
  declaration surface.
- A new developer clones, supplies only secrets, and every project identifier is already correct —
  which is what ADR-0002 set out to achieve.
- `gas-static` needed **no change at all** to support this. A consumer's `tools/static-pages.js`
  reads `gas-project.json` itself and composes the `envs`/`liveUrl` config the package already
  takes. That is evidence the boundary is in the right place: the package's config surface did not
  have to learn about the file.
- The static host's three copies collapse to one. `liveUrl` is composed from `pagesUrl + dest`, and
  the GAS-side runtime gets the composed URL stamped into `BUILD_INFO` at deploy time instead of
  keeping a fourth hand-maintained copy.

**Harder:**
- Two files can disagree, and ADR-0002 §Consequences was right that the split trades silent drift
  for silent absence unless every disagreement fails loudly and by name. `gas-deploy` v1.4.0
  implements all three directions: an env declared in the committed half with no secret in the
  gitignored one throws before anything shells out; a target missing from a declared `envs` block
  throws listing what is declared; a fact carried by both files takes the committed value and warns,
  naming the stale key to delete.
- "Which file does this key live in?" is still a question a reader must answer, and the answer is
  now a category test (is it an identifier, or a declaration, or a secret?) rather than a list.

**Trade-off accepted:** narrowing the committed half to identifiers cures the drift ADR-0002 named
while leaving the packages with one declaration mechanism instead of two. The cost is that ADR-0002's
list — which several beads (`GAS-Core-9iu`, `-8w0`, `-hl5`) were amended against — no longer reads
as written; those beads are re-amended to point here.

**Not decided here:** where the admin declaration and its ungated list live is `GAS-Core-hl5`'s
call, not this ADR's. ADR-0002 placed it in the committed half on the reasoning that an exemption
list widening a security gate must be reviewable in git. That reasoning is untouched by this
narrowing — an ungated-action list is a declaration, and declarations stay in the committed JS
config module, which is equally reviewable.
