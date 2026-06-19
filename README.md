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

## Contributor flow: changing a `libs/<Name>/` library

Code, tests, and demo land together in one PR. Each library has its own
standalone test harness — there is no aggregator and no shared demo registry,
so a library PR never touches files outside its own directory.

1. Extend the library locally; add or update `libs/<Name>/test/` and
   `libs/<Name>/harness/demo.js` to cover the new behavior.
2. Open a PR scoped to `libs/<Name>/**` — code, tests, and demo registration
   land together as one reviewable unit.
3. **Tier 1** (`node --test`, plain Node, no live Google resources) is the
   **PR gate** — required on every PR touching a library.
4. **Tier 2** — the library's own standalone bound harness, run via its
   `doGet()` against its bound test fixture — runs before a version-tag
   bump, exercising real Sheets/Docs API behavior.
5. Maintainer merges, bumps the version tag, and updates `CHANGELOG.md`.
6. Consumers re-pin the submodule and re-copy the flat PRODUCTION file, then
   run `check-lib-drift.sh`, per the
   [Consuming `libs/` from an app project](#consuming-libs-from-an-app-project)
   section above.

Tiering policy in full (see `docs/test-harness-design.md` §4–§5):

| Tier | What | When |
|------|------|------|
| 1 | `node --test`, pure-function coverage, no GAS runtime | Every PR (gate) |
| 2 | Library's own bound harness `doGet()` vs its test fixture, real Sheets/Docs API | Before tagging a release |
| 3 | Playwright driving the deployed harness UI (menu clicks, dialogs) | Periodic/manual smoke test, not a default gate |

Tier 3 example: `examples/demos/libsheets-basic/smoke.spec.js` (+ its
co-located `playwright.config.js` and `authenticate.js`) drives the bound
Sheet's harness menu and asserts the demo's sheet tabs appear. It is a
**periodic / manual gate, not a PR gate** — run it headed against a deployed
host before a UI-heavy release; it skips when `SHEET_URL` is unset. See the
spec's header for the run procedure.

A library's harness is standalone and bound only to that library's test
fixture — it is not vendored into consumer demos and does not register into
any cross-library aggregator.

## Status

- Repo just established (2026-06-17), local only, not yet pushed to a remote.
- `libs/LibSheets/` seeded from the most mature copy found across projects
  (`GApps/apps/Groups-Users/scripts/libSheets.js`); other project copies are
  not yet migrated to consume this version — see `libs/LibSheets/CHANGELOG.md`.
- `libs/LibSidebar/` seeded from `GApps/libraries/LibSidebar/` (notification
  sidebar for Sheets); `F3Go30` has a forked copy not yet migrated — see
  `libs/LibSidebar/CHANGELOG.md`.
- Submodule wiring + drift-check tooling for consumer projects is not yet built.
