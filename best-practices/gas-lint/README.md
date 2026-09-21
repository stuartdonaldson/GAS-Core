# Best Practice: ESLint for GAS Repos

A GAS project needs a lint config for one reason that has nothing to do with
style, and the config in this folder exists to serve it.

## The defect class

Apps Script has a **flat global scope and no import graph**. clasp concatenates
every `.js` file in the script project into one execution context, so a top-level
`function foo() {}` in one file *is* the global `foo` another file calls. Nothing
resolves that reference at build time, because there is no build.

So when a helper is moved between files, renamed, or deleted, the caller keeps
compiling, keeps deploying, and throws `ReferenceError` in **production**, the
first time that branch runs — which may be a rarely-taken error path, or a
time-based trigger nobody is watching. A full test sweep can miss it entirely if
no test exercises that branch.

`no-undef`, taught about the flat scope, catches the whole class in seconds.

## What makes the config non-obvious

ESLint lints one file at a time, so out of the box `no-undef` would flag every
legitimate cross-file call. `collectProjectGlobals()` in `eslint.config.js`
regex-scans the source tree for top-level `function NAME(` / `var NAME`
declarations and declares each one a project-wide global. `no-undef` then
validates a reference against *"a real GAS built-in OR something actually
declared somewhere in this source tree"* — the same invariant the runtime has.

There is no GAS-specific ESLint plugin on the registry that does this (checked);
this is the portable way to get it.

## Policy

| Rule | Level | Why |
|---|---|---|
| `no-undef` | **error** | The defect class above. Non-negotiable. |
| `no-unreachable` | **error** | Dead branch after a `return`/`throw` — usually a real editing mistake. |
| `no-fallthrough` | **error** | Missing `break` in a dispatch `switch`. |
| `no-unused-vars` | **warn** (permanent) | GAS entry points are called *by name* by the platform, from outside any file ESLint can see, so single-file analysis always reports them as unused. That is a permanent property of Apps Script, not a backlog. |
| `reportUnusedDisableDirectives` | warn | A suppression that no longer suppresses anything is a dead directive. |

`no-unused-vars` is a warning **permanently, for a structural reason** — not as a
deferred ratchet. Do not copy a rationale that describes some other repo's
inherited backlog; a new repo starts at zero deferred debt and should stay there.
If the count grows for a reason other than a new entry point (a genuinely dead
local, an orphaned catch variable), fix it then rather than letting it accumulate
until the rule becomes unreadable noise.

## Where it runs

**Merge gate, alongside the regression suite.** It runs in seconds, so there is
no argument for deferring it, and it catches precisely what an expensive live
test sweep can miss.

```jsonc
// package.json
"scripts": {
  "lint": "eslint src/"
}
```

An `[IMP]` bead closing on a fast targeted gate should include `pnpm run lint` —
it costs nothing and it is the cheapest possible check on exactly the kind of
cross-file move that an in-flight refactor makes.

## Adopting on a repo that already has violations

1. Copy `eslint.config.js` to the repo root; fix the two PER-PROJECT blocks (the
   GAS built-ins this project actually uses, including everything in
   `appsscript.json`'s `enabledAdvancedServices`, and the source directory).
2. Run it. Expect a first pass of false `no-undef` hits from built-ins missing
   from `gasGlobals` — add them, and only them.
3. Whatever `no-undef` still reports is **real**. Each one is a live
   `ReferenceError` waiting for its branch to run; fix them before merging the
   config, and do not downgrade the rule to get green. (On GActionSheet's
   adoption this surfaced one genuine pre-existing bug: an error branch
   referencing two variables that were never declared.)
4. `no-unused-vars` warnings are expected and need no action.

## Provenance

The `collectProjectGlobals` mechanic is GActionSheet's (`eslint.config.js`,
bead `gts-r2my`). NUUTS-Shell ported it and corrected the `no-unused-vars`
rationale to the structural one above. This folder is the merge of the two, with
the repo-specific bead references and backlog narrative removed so a new repo
does not inherit another project's history as if it were policy.
