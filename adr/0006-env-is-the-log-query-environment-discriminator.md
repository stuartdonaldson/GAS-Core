# ADR-0006: `env` is the log-query environment discriminator, distinct from the deploy contract's `target`

Status: Accepted
Date: 2026-09-21
Supersedes: None — new decision

## Context

"Show me what happened in production" is the most common question asked of a log dataset, and
until now every GAS repo answered it differently — or could not answer it at all.

Observed across the four repos that log to Axiom:

| Repo | Field stamped | Values | Source |
|---|---|---|---|
| GActionSheet | `env` (top-level column) | `test` / `production` / `dev` | `BUILD_INFO.env` |
| NDocs | `env` (top-level column) | `test` / `production` | `BUILD_INFO.env` |
| F3Go30 | `target` | `TEST` / `TEMPLATE` / `unknown` | `APP_DEPLOY_TARGET` |
| GAS-Core template | *neither* | — | — |

Three consequences. A saved query does not port between repos. The GAS-Core template — the thing a
new repo copies — could not filter by environment at all, so a new repo either invented a fourth
vocabulary or read test and production events interleaved. And GActionSheet's own history shows the
fallback when no such column exists: substring-matching the free-text `version` field for `"(TEST)"`,
which breaks the moment a version string is formatted differently.

There is a second, subtler collision. GActionSheet's build stamps **both** `BUILD_INFO.env`
(`test`/`production`/`dev`) and `BUILD_INFO.target` (`TEST`/`PRODUCTION`), and it is tempting to
call that redundant and keep one. They answer different questions: `target` is compared over the
wire by deploy verification to prove the right code landed in the right place — it is part of the
*deploy contract* — while `env` is what a human or a report filters logs by. F3Go30, having only
`target`, uses the deploy-contract field as the query discriminator, which couples every saved
query to a contract it has no business depending on.

## Decision

**`GasLogger.log()` stamps a top-level `env` column on every entry, from `BUILD_INFO.env`, drawn
from the vocabulary `dev` | `test` | `prod`.** It is stamped by the logger, not by call sites, and
it is the field every query tool filters on (`tools/query_axiom.py --env`, and any cooked report
built on it). `sit` is an accepted synonym for `test` at the command line, since SIT is the
preferred spoken name for the same deployment target; it is not a stored value.

**`env` and `target` stay separate fields with separate purposes.** `target` belongs to the deploy
contract; `env` belongs to the query surface. A repo may stamp both.

The environment is stamped by the *emitter*, not inferred by the query layer, because an
environment is a property of the build that produced the row and the running deployment is the only
place that is reliably known. Inferring it downstream — from a version substring, or from which
dataset the row landed in — re-derives from something that was never promised to carry it.

A repo whose emitter predates this decision may declare a compatibility mapping under `"axiomEnv"`
in `local.settings.json`, naming its own field and value aliases, so `--env` works before the
emitter is changed. `query_axiom.py`'s defaults already accept every legacy spelling of the
canonical values (`production`, `TEMPLATE`, `SIT`, ...) on the `env` field, so only a repo using a
different *field name* needs the block at all.

## Consequences

- One `--env prod` works in every repo, and a saved query ports.
- The default value set is deliberately permissive (`prod` matches `prod`, `production`, `TEMPLATE`,
  ...), which means a repo mid-migration — some rows stamped the old way, newer ones the new way —
  still gets a complete answer instead of a half one. The cost is that a repo that genuinely uses
  `TEMPLATE` to mean something other than production would get false matches; no repo does.
- The `axiomEnv` shim is a migration affordance and is documented as one. A repo that still needs a
  non-default `field` has an emitter to bring to the standard; leaving the shim in place
  indefinitely re-creates the drift this ADR exists to end.
- Bringing a repo to the canonical vocabulary is an emitter change plus a redeploy, and historical
  rows keep their old value. The permissive default value set is what makes that a non-event.
