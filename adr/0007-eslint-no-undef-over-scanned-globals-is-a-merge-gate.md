# ADR-0007: A GAS repo lints with `no-undef` over a scanned project-global set, at the merge gate

Status: Accepted
Date: 2026-09-21
Supersedes: None — new decision

## Context

Apps Script has a flat global scope and no import graph. clasp concatenates every `.js` file in the
script project into one execution context, so a top-level `function foo() {}` in one file *is* the
global `foo` another file calls. Nothing resolves that reference before it runs, because there is
no build step.

So a helper that is moved between files, renamed, or deleted leaves its callers compiling, pushing
and deploying cleanly, and throws `ReferenceError` in **production**, the first time that branch
runs — potentially a rarely-taken error path or an unattended time-based trigger. A full regression
sweep can miss it entirely if no test exercises that branch, and on this estate the full sweep runs
against a live Google backend and costs hours, so it is not run per change anyway.

Neither DevStandard nor GAS-Core published an ESLint config, so the mechanic that catches this was
invented once (GActionSheet `gts-r2my`) and then hand-copied into NUUTS-Shell, along with a
rationale paragraph describing GActionSheet's own ~90-item `no-unused-vars` backlog — history that
does not transfer to a new repo but reads like policy once copied. NUUTS-Shell corrected that
paragraph; nothing carried the correction back.

Off-the-shelf ESLint cannot do this job: it analyses one file at a time and would flag every
legitimate cross-file call as `no-undef`. There is no GAS-aware plugin on the registry (checked).

## Decision

**GAS-Core publishes `best-practices/gas-lint/eslint.config.js`, and a GAS repo copies it and runs
it at the merge gate alongside the regression suite.**

The load-bearing part is `collectProjectGlobals()`: a regex scan of the source tree for top-level
`function NAME(` / `var NAME` declarations, each declared a project-wide global. `no-undef` then
validates a reference against *"a real GAS built-in OR something actually declared somewhere in this
source tree"* — the invariant the runtime actually has. A regex, not an AST walk: it matches the
declaration style GAS code is written in and stays legible to whoever extends it next.

Rule levels:

| Rule | Level |
|---|---|
| `no-undef`, `no-unreachable`, `no-fallthrough` | **error** |
| `no-unused-vars` (`args: 'none'`) | **warn**, permanently |
| `reportUnusedDisableDirectives` | warn |

`no-unused-vars` is a warning for a **structural** reason, not as a deferred ratchet: GAS entry
points (`doGet`, `doPost`, `onOpen`, menu and trigger callbacks, manifest-bound handlers) are
called by name by the platform from outside any file ESLint can see, so single-file analysis will
always report them as unused. That is permanent, not a backlog. The published config states that
reason and deliberately does **not** carry GActionSheet's backlog narrative.

Only two blocks are per-project: the GAS built-in services this project actually references
(including everything in `appsscript.json`'s `enabledAdvancedServices`), and the source directory.

## Consequences

- The `ReferenceError`-in-production class is caught in seconds, per change, by something far
  cheaper than the sweep that would otherwise have to find it — and often would not.
- Lint joins the regression suite as a merge-gate requirement. A fast targeted gate on an `[IMP]`
  bead should include it too; it costs nothing and cross-file moves are exactly what in-flight
  refactors make.
- Adopting on an existing repo is a two-step: add the built-ins that are genuinely missing from
  `gasGlobals`, then fix what `no-undef` still reports, because those are real. Downgrading the rule
  to reach green forfeits the entire value. (GActionSheet's adoption surfaced one live pre-existing
  bug this way — an error branch referencing two variables that were never declared.)
- A repo whose sources are not in `src/` edits two lines. A repo whose globals are declared in a
  style the regex does not match (`let`, `const`, conditional declaration) will get false
  `no-undef` hits; the fix is to declare cross-file globals in the matched style, which is also the
  style that actually works reliably in a flat scope.
