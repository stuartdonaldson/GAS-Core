---
description: Execute one logical batch of bd issues by dispatching to the model the batch requires
argument-hint: <batch-label, e.g. batch:2-libsheets>
---

# Execute bead batch: $ARGUMENTS

A "batch" is a `batch:<n>-<name>` label applied to one or more bd issues that were grouped
for (a) dependency order and (b) shared context — they touch the same files/library or
describe the same mechanism, so one agent with full context for the group does them better
than one agent per issue.

This command **cannot change its own model mid-session**. To run an issue on the model it
requires, it must spawn that work via the `Agent` tool with an explicit `model` parameter.
Do not just read the issues and implement them in the current session unless the current
session's model already matches the batch's required model.

## Procedure

1. `bd list --label=$ARGUMENTS --status=open` to resolve the batch to concrete issue IDs.
   If empty, stop and report — likely a typo or the batch is already closed.
2. For each issue in the batch, `bd show <id>` and confirm:
   - all issues in the batch carry the **same** `model:` label (sonnet/opus/human). If they
     don't, stop and report the mismatch rather than guessing.
   - none are blocked — `bd show <id>` should list no open `DEPENDS ON`. If any are
     blocked, report which blocker(s) are unclosed and stop (don't force through).
3. If the batch's model label is `model:human`: do not execute anything. Run
   `bd human <id>` for each issue and report back to the user — these need a human decision.
4. Otherwise, spawn **one** `Agent` tool call for the whole batch:
   - `model`: the batch's required model (`sonnet` or `opus`), taken from the `model:`
     label — not the model the current session happens to be running as.
   - `prompt`: self-contained — include each issue's ID, title, full description,
     acceptance criteria, and the "Critical files" references from the design plan. State
     the dependency order *within* the batch (e.g. "do C before D if D reads C's output").
     Tell the agent to:
     - `bd update <id> --claim` before starting each issue,
     - read referenced source files before writing code (don't assume contents from the
       issue text),
     - implement, run relevant tests/build,
     - `bd close <id> --reason="<one-line summary>"` when done,
     - report back what it did per issue.
   - Run it in the foreground (not `run_in_background`) — you need its result before
     reporting completion to the user.
5. After the Agent returns, verify with `bd show <id>` that closed issues are actually
   closed (don't trust the summary alone — check the actual bd state and, if code changed,
   skim the diff).
6. Report to the user: issues closed, issues skipped (and why), and what's newly
   unblocked (`bd ready`).

## Notes

- One batch = one Agent dispatch. Don't split a batch into per-issue Agent calls — the
  point of batching is shared context across the group.
- If `$ARGUMENTS` names an issue ID instead of a `batch:` label, treat it as a batch of one
  and follow the same procedure.
