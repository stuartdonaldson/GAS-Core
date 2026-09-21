# ADR-0005: Each repo logs to its own Axiom dataset

Status: Accepted
Date: 2026-09-21
Supersedes: None — new decision

## Context

`best-practices/gas-server-logging/` gives a GAS project a structured log sink in Axiom. Nothing
in it, until now, said *which* dataset a project should use, so projects shared one. Four repos
(F3Go30, GActionSheet, NDocs, NUUTS-Shell) grew independent copies of the emitter and its query
tooling, and more than one pointed at the shared `nuuts` dataset.

**An Axiom dataset caps at 257 fields.** Every distinct key that has ever appeared at the *top
level* of an ingested row mints a permanent column. Past the cap, Axiom **silently drops** the new
field at ingest — the POST still returns 2xx, the event still arrives, and the field is simply not
there. Nothing in the response, and nothing in the emitter as originally written, reported it.

The `nuuts` dataset reached that cap (GActionSheet `gts-pfyx`). Two distinct causes contributed:

- **Row shape.** The emitter spread each event's free-form `data` payload as top-level keys, so
  ~190 call sites minted a column per distinct key — and a dynamic-key payload (one key per
  document id ever seen) minted them without bound.
- **Sharing.** Multiple projects contributed their own vocabularies to one budget.

The row-shape half was fixed per-repo (nest the payload under one `data` map field; hoist a short
fixed list of query keys). That fix bounds a single repo's consumption but does not make a shared
budget safe: consumption is still the sum across every project pointed at the dataset, and **the
repo that exhausts the budget is not the repo that breaks.** A project can be perfectly
well-behaved and lose a field because a sibling project shipped a new event shape that week.

NUUTS-Shell had already, independently, stood up its own `nuuts-shell` dataset for exactly this
reason — the convention was being invented per repo rather than stated once.

## Decision

**One Axiom dataset per repo.** `axiomDataset` in a repo's `local.settings.json` names a dataset
belonging to that repo alone, conventionally the repo name lowercased (`gactionsheet`, `ndocs`,
`nuuts-shell`, `f3go30`). A project never points at an existing dataset to "keep it all in one
place".

The nested row shape stays mandatory alongside it (`AxiomLogger.js` rule 1) — the two mitigations
are cumulative, not alternatives. Per-repo isolation bounds the blast radius; the nested shape
bounds the rate.

Every row continues to carry an `app` column, so a cross-project question is still answerable by a
union across datasets. `app` is what makes a row self-describing when it is pasted into a ticket;
isolation is what makes the dataset's field budget the owning repo's own to spend.

## Consequences

- A repo's field budget is its own. A sibling project cannot exhaust it, and a repo that does
  exhaust its own has a bounded, locally-diagnosable problem.
- Cross-project queries cost a union across datasets instead of a single `where app == ...`. This
  is rare enough — the routine question is always scoped to one project — that it is the right
  thing to make slightly harder.
- Setup gains a step: each new repo creates a dataset plus its two tokens (ingest, query) before
  logging works. `local.settings.example.json` and the README's **Four Standing Rules** state it,
  and `query_axiom.py` fails with an explicit message rather than an opaque 401 when it is skipped.
- Existing repos on the shared `nuuts` dataset must migrate to their own. Historical events stay
  where they are; no backfill is attempted, because the value of a log event decays in days and
  the cost of a migration does not.
