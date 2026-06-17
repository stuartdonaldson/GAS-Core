# GAS-Core

Single repo for Google Apps Script practices and reusable libraries. Replaces
the former `GAS-Practices` folder (now a redirect — see its README).

## Structure

| Path | Purpose |
|------|---------|
| `best-practices/` | GAS-specific methodology docs (testing, deployment, logging, email templating, etc.) |
| `libs/` | Canonical, versioned shared GAS library code (e.g. `libs/LibSheets/`) |

## Consuming `libs/` from an app project

Each lib has its own `CHANGELOG.md`/version tag (e.g. `libsheets-v1.0.0`) and
a `CONSUMERS.md` registry. Setup for a consumer project:

1. `git submodule add <this-repo> vendor/gas-core`
2. `cd vendor/gas-core && git checkout libsheets-v1.0.0 && cd -` then commit
   the submodule pin.
3. Copy the needed file into the clasp script directory (clasp doesn't
   resolve submodule paths, so it needs a flat copy where it expects files):
   `cp vendor/gas-core/libs/LibSheets/libSheets.js script/libSheets.js`
4. Add a line to a local pairs-file (e.g. `vendor/gas-core-pairs.txt`):
   `libs/LibSheets/libSheets.js  script/libSheets.js`
5. Run `vendor/gas-core/scripts/check-lib-drift.sh vendor/gas-core vendor/gas-core-pairs.txt`
   before every push (wire into a pre-push hook or CI) — it fails if the
   submodule isn't cleanly pinned or the vendored copy has drifted.

Do not hand-edit the vendored copy in place — the drift check will catch it.
Branch GAS-Core, make the change there, bump the version/tag, then re-pin and
re-copy in the consumer.

## Status

- Repo just established (2026-06-17), local only, not yet pushed to a remote.
- `libs/LibSheets/` seeded from the most mature copy found across projects
  (`GApps/apps/Groups-Users/scripts/libSheets.js`); other project copies are
  not yet migrated to consume this version — see `libs/LibSheets/CHANGELOG.md`.
- `libs/LibSidebar/` seeded from `GApps/libraries/LibSidebar/` (notification
  sidebar for Sheets); `F3Go30` has a forked copy not yet migrated — see
  `libs/LibSidebar/CHANGELOG.md`.
- Submodule wiring + drift-check tooling for consumer projects is not yet built.
