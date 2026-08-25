# HANDOFF — 2026-08-25 · planning-method thread

**Purpose:** resume one specific unfinished conversation — how staged multi-session plans get
authored, tracked and triggered across the estate. Not a plan, not a status doc.

**Delete this file when:** the decisions in §4 are made and filed as beads. Everything else here is
already recorded in a durable home and is repeated below only so a new session does not have to
re-derive it. If you are reading this more than a couple of weeks after 2026-08-25, prefer the beads
and `git log` over anything below.

> This file is deliberately the shape PLAN2 §4.2 warns about (`HANDOFF-*.md` accumulation, cited
> from GActionSheet's four of them). It was asked for explicitly and is fine as a one-shot bridge —
> the expiry condition above is what keeps it from becoming the anti-pattern.

---

## 1. How this thread started

Session H closed PLAN2 S11 + S12. In reporting it I listed three "things worth your attention"
**without saying whether each was captured as a bead, captured in the plan, or nowhere** — which
forced a follow-up question. That led to two findings:

1. A **debt audit** of all twelve closed PLAN2 stages (four uncaptured items found, all now filed).
2. A **design question**: do we need a staged-execution-plan skill, or is there a better way? Plans
   across the estate have drifted in style, each missing something different, with poor tracking of
   mid-session discoveries and no clear escalation path for decisions.

The design question is what remains open.

---

## 2. Done and committed — no action needed

| What | Where | Commit |
|---|---|---|
| PLAN2 S11 + S12 closed, beads closed | `PLAN2.md`, GAS-Core | `49d8bf6`, `dc71713` |
| PLAN2 v7.4 — debt audit, stage contract **rule 9** added to §6.0 | `PLAN2.md` §6.0, §8 | `b3aa4cb` |
| **Pattern D — Staged Execution** written | `DevStandard/doc-framework/planning-guide.md` | `a138d3c` (pushed, branch `feature/fixture-bootstrap-telemetry`) |
| Two conduct memories | `~/.claude/projects/-mnt-c-dev-GAS-Core/memory/` | n/a |

**Pattern D contains:** the split (what is a bead field vs. what the staging doc holds), the
nine-rule stage contract, the four-part handoff shape (Done / Found / Next stages must know /
Deliberately not done), the disposition rule, escalation via the `human` label, batching with two
anti-pairings, and a defined end state for the doc. Also extended that guide's entry table, *Where
Things Live*, and *Anti-Patterns*.

**Note on DevStandard:** `bin/bdls` and three `SKILL.md` files were already modified in that repo
when I arrived. I committed **only** `planning-guide.md` and left those alone. They are still dirty.

---

## 3. Facts a new session needs (verified, do not re-derive)

- **`bd human` is a real built-in beads command**, not a skill: `bd human list|respond|dismiss|stats`,
  keyed on the plain `human` label. **GAS-Core has never used it** — `bd human stats` returns
  `Total: 0`. Every decision PLAN2 parked in prose ("HELD, on the owner's call") was invisible to it.
- **`execute-beads` is a GAS-Core-local slash command**, at
  `/mnt/c/dev/GAS-Core/.claude/commands/execute-beads.md` — the only file in that directory. Not in
  DevStandard, not a global skill, not part of beads. It *consumes* `batch:<n>-<name>` and `model:`
  labels and refuses to run on inconsistent ones. **Nothing produces those labels.**
  It also tells the agent to run `bd human <id>`, which is not valid CLI (`bd human respond <id>` is).
- **`planning-guide.md` has no trigger.** Only `doc-bootstrap.md`, `doc-standard.md` and the
  doc-framework `README.md` reference it; **no skill does**. Global CLAUDE.md §5 loads the framework
  only "when modifying PLAN.md structure, bd integration, or tier". So Pattern D, as committed, will
  not fire at the moment someone writes a plan. **This is the crux of the remaining question.**
- **`.beads/issues.jsonl` already has 13 `batch:`/`model:` occurrences** from other work, but **none
  of the PLAN2 stage beads carry labels or `--acceptance`** — their descriptions all say "See
  PLAN2.md §6, do not restate AC here."
- **The core diagnosis:** PLAN2 hand-rolled in prose what the tracker already holds as data. §6.3's
  session table = `batch:` labels. Its model column = `model:` labels. "On the owner's call" =
  `human` label. Its AC checkboxes = `bd --acceptance`. This is the same drift as the four
  hand-copied `build-static-pages.js` scripts that S11 deleted.

---

## 4. Open — needs a decision before anything else happens

Nothing in this section is captured as a bead. That is deliberate: the answer to (a) changes what
the beads should say.

**(a) What mechanism makes Pattern D actually fire?** I recommended a thin `staged-plan` skill
wrapping it, then flagged that this has the same weakness one layer up — skills trigger on
description matching, which is better than a document nobody loads but is not guaranteed. Genuine
alternatives, and I have no evidence for which works better in this setup:

| Option | Fires when | Weakness |
|---|---|---|
| Thin `staged-plan` skill | Description match on "plan this out", "sequence these beads" | May not fire; another artifact to maintain |
| Template + a `plan-graduation-audit`-style **checker** | Run against an existing plan, on demand | Catches drift after the fact, not at authoring |
| Line in global CLAUDE.md §5 | Only if read attentively at the right moment | Weakest |

**(b) Should Pattern D be validated against PLAN2's remaining stages before tooling is built on it?**
Building a skill around an unproven shape is exactly the failure ADR-0002 sequenced against ("no
consumer migrates on this ADR alone; the shape is validated inside the first conversion"). PLAN2 has
seven open stages (S13, S15–S19) that could be that validation.

**(c) What do PLAN2's seven open stages do?** Three options, previously offered, not answered:
finish as-is against prose AC (my recommendation — rule 9 closed the leak that mattered); retrofit
fully to Pattern D (`--acceptance` + labels + `human` tags); or retrofit **labels only** from §6.3's
existing table, leaving AC wording untouched.

**(d) Candidate beads, unfiled pending the above:** `staged-plan` skill; `plan-batch` skill
(produces the `batch:`/`model:`/`--acceptance` that `execute-beads` consumes — the only genuinely
unbuilt piece; could merge into `staged-plan`); promote `execute-beads` from GAS-Core to
DevStandard and fix its `bd human <id>` error; adopt `human` labels for GAS-Core's already-parked
decisions (`GAS-Core-e5z`/F9, S7's blocked owner decisions).

**(e) You have not read Pattern D.** It is ~100 lines written from one project's experience.
Reviewing it is probably the right first move next session.

---

## 5. Beads filed this session

All four came from the debt audit, not the design discussion.

| Bead | P | What |
|---|---|---|
| `GAS-Core-geq` | P2 | The fourth PLAN2 §4.5 ADR (pipeline-vs-page boundary) was never written — S2 deferred it to S12, whose AC named READMEs only |
| `GAS-Core-d5t` | P2 | `test_download.py` / `test_upload.py` exist and nothing runs them; F5's declared entry point covers only part of the repo |
| `GAS-Core-rgc` | P3 | No document records the CI recipe or S3's Node-version glob trap |
| `GAS-Core-p97` | P3 | `PUBLISHERS.md` prose table and JSON block can drift; S4 noted it in ADR-0003 *Harder* rather than filing |

Three of the four shared one cause → **stage contract rule 9**, now in both PLAN2 §6.0 and Pattern D.
Also recorded as `bd remember` key `stage-contract-loses-cross-stage-deferrals` and commented onto
`GAS-Core-dof` (S19).

---

## 6. Interaction with PLAN2 S19 (`GAS-Core-dof`)

S19's scope is "fold the stage contract into DevStandard planning-guide (F21)". **Pattern D has now
done most of that** ahead of S19 and outside a stage — a rule-4 widening, done deliberately because
you asked for the guide to be updated. S19 should be re-scoped rather than run as written: what
remains for it is the trigger mechanism (§4a) and citing this exercise as the evidence. Its bead
already carries a comment with rule 9's reasoning.

**Not yet done:** `GAS-Core-dof`'s description still describes the original scope. Re-scoping it is
part of the §4 decision, not something to do blind.
