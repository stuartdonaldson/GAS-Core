# ADR-0003: A static-host repo declares who publishes what, and `gas-static` validates against that declaration

Status: Accepted
Date: 2026-08-24
Supersedes: [None — new decision]

## Context

`gas-static`'s publish step copies one env's built `dist/` output into a **shared** static-host repo:
`nuuc-it/Static` currently carries `pub/AS`, `pub/AS-sit`, `pub/ballot` and `pub/pmix-sit` from three
project repos across two Google accounts, and `f3go30/static-pages` carries F3Go30's `dist/{sit,prod}`
beside RankChoiceVoting's `ballot/{sit,prod}`.

Two failure modes follow from that sharing, and neither was guarded.

**Destructive.** `lib/publish.js`'s `copyDir_()` opens with
`fs.rmSync(dest, { recursive: true, force: true })`, where `dest = repoRoot + envDef.dest` and
`repoRoot` comes from *another repo's* `local.settings.json`. Nothing validated `envDef.dest`. A
`dest` of `pub` instead of `pub/pmix` deletes every other project's published site; the scoped
`git status --porcelain -- pub` then faithfully reports the deletions, `git add pub` stages them, and
a chained publish (`chained: true`, which skips `confirmFn` by design) commits and pushes without a
prompt. The existing scoping guard protects against staging *unrelated* work; it does nothing about a
destructive `dest`.

**Losing.** The host repo is one repository on one branch. Another project publishing moves `main`
for everyone, so a publish from a checkout that has not fetched since is a non-fast-forward and the
push is rejected — *after* the commit is made. The backend is deployed, the page is committed
locally, and nothing is published.

The alternative to a declaration is for the package to infer a safe `dest` from path heuristics —
depth, name shape, sibling contents. That guesses at a fact the host repo actually knows, and it
gets no more correct as more publishers arrive.

The precedent already exists and is half-built: `f3go30/static-pages`' README already states the repo
holds only built output, is never hand-edited, and lists each folder with its owning project and live
URL. `nuuc-it/Static`'s README was the single line `# Static`.

## Decision

**The static-host repo declares the folder → project ownership map, and `gas-static` refuses any
publish that map does not authorise.**

The declaration is a `PUBLISHERS.md` at the host repo root: the human half (built output only, never
hand-edited, each folder owned 100 % by its originating project repo) plus one fenced ```json block —
the first in the file — of `{ "<dest>": { "project", "env", "url" } }`. One file, two readers: no
second artifact to keep in sync.

`publishEnv` resolves `envDef.dest`, requires an exact entry, and requires that entry's `project` to
equal the consumer's declared `config.projectName`. An absent entry, a mismatched owner, or an
undeclared `projectName` refuses the publish and names both the dest and the owner it is registered
to. Registering a new folder is therefore a deliberate two-line edit, reviewed in the repo that owns
the namespace.

Structural checks — empty, absolute, containing `..`, resolving outside the host repo, resolving *to*
the host repo, or naming a `.git` — run **first** and stay active even when no manifest is present, so
`rm -rf` is unreachable while any of them fails. A missing or malformed manifest warns and leaves the
structural checks as the only guard, which covers the bootstrap window before a host repo has one.

Because the map states that each folder is owned entirely by one repo, disjoint paths make a content
conflict impossible — so the fix for the losing case is allowed to be automatic and unattended:
`git fetch`, an assertion that the checkout is on a tracking branch, and `git pull --rebase
--autostash` immediately before the publish commit, with a named diagnostic on push failure saying the
commit exists locally and how to finish it.

## Consequences

**Easier:**
- A destructive `dest` is refused before anything is deleted, rather than discovered by its blast
  radius.
- A publisher pushing into a folder that is not theirs is refused by name, in both directions.
- A concurrent publish from another project no longer fails a deploy — the rebase is automatic and
  provably conflict-free.
- A human landing in a static-host repo finds one document that answers "what is this and who owns
  which folder", and the machine reads the same document.

**Harder:**
- A new published folder now takes an edit in a repo the publishing project may not routinely touch,
  before its first publish can succeed. That is the intended cost.
- The prose table and the JSON block can disagree; the JSON is what runs, and only the JSON is
  validated.
- Every consumer must declare `config.projectName`, and it must match the manifest's spelling exactly
  — a rename in one place is a refused publish in the other.

**Trade-off accepted:** an extra reviewed edit per new folder, and a required `projectName`, in
exchange for making the destructive failure impossible rather than unlikely. The heuristic
alternative was rejected because it guesses at a fact the host repo can simply state.
