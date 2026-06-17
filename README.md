# GAS-Core

Single repo for Google Apps Script practices and reusable libraries. Replaces
the former `GAS-Practices` folder (now a redirect — see its README).

## Structure

| Path | Purpose |
|------|---------|
| `best-practices/` | GAS-specific methodology docs (testing, deployment, logging, email templating, etc.) |
| `libs/` | Canonical, versioned shared GAS library code (e.g. `libs/LibSheets/`) |

## Consuming `libs/` from an app project

Each lib has its own `CHANGELOG.md` with a version number. Consumer projects
vendor a copy in (or, once wired up, a git submodule pinned to a tagged commit)
and record the version pulled. Do not hand-edit a vendored copy in place —
branch this repo, make the change, bump the version, and re-sync consumers.

## Status

- Repo just established (2026-06-17), local only, not yet pushed to a remote.
- `libs/LibSheets/` seeded from the most mature copy found across projects
  (`GApps/apps/Groups-Users/scripts/libSheets.js`); other project copies are
  not yet migrated to consume this version — see `libs/LibSheets/CHANGELOG.md`.
- Submodule wiring + drift-check tooling for consumer projects is not yet built.
