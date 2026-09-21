# Best Practices

> **See [`../docs/demo-surface-matrix.md`](../docs/demo-surface-matrix.md)** for which interface
> surface (Sheet menu, sidebar, webapp, static HTML, etc.) demonstrates which pattern below, and
> [`../docs/demo-config-reference.md`](../docs/demo-config-reference.md) for shared setup steps
> (clasp, OAuth scopes for REST APIs, GIS sign-in, Script Properties) factored out of individual
> pattern READMEs.

Reusable patterns and tools derived from working implementations in active projects. Each folder contains:

- A `README.md` with architecture overview, annotated examples, setup instructions, and trade-offs
- Copies of reusable tools or scripts that can be used as a starting point in a new project

---

## Index

| Folder | Pattern | Source |
|---|---|---|
| [`gas-server-logging/`](gas-server-logging/README.md) | **The standard, copied verbatim** (see its §The Four Standing Rules): structured GAS server logging to Axiom (with a built-in Drive NDJSON fallback driver), an ingest failure that is never silent, `tools/query_axiom.py` with `--env`, and `tools/axiom_report.py` — a reusable base for a repo's cooked activity report. Binding decisions: [ADR-0005](../adr/0005-one-axiom-dataset-per-repo.md) (one dataset per repo — Axiom's 257-field cap drops new fields silently), [ADR-0006](../adr/0006-env-is-the-log-query-environment-discriminator.md) (`env`, not `target`, is the query discriminator). Per-repo deltas: [docs/adoption-axiom-lint-envrc.md](../docs/adoption-axiom-lint-envrc.md). | AudioTrackCombiner (origin), merged from F3Go30 + GActionSheet + NDocs |
| [`gas-lint/`](gas-lint/README.md) | ESLint for a GAS repo, for one reason: Apps Script's flat global scope has no import graph, so a moved/renamed/deleted helper surfaces as a **production `ReferenceError`**, not a build failure. `collectProjectGlobals` scans the source tree so `no-undef` can validate against the globals that actually exist at runtime. Required at the merge gate — [ADR-0007](../adr/0007-eslint-no-undef-over-scanned-globals-is-a-merge-gate.md). | GActionSheet (mechanic), NUUTS-Shell (rationale) |
| [`gas-playwright-testing/`](gas-playwright-testing/README.md) | Playwright testing for GAS web apps: nested iframe navigation, auth, console capture | AudioTrackCombiner |
| [`gas-deployment/`](gas-deployment/README.md) | Install the shared `gas-deploy` package (`packages/gas-deploy/`, a pnpm git-subdirectory dependency) rather than copy a template: stable named-deployment URLs, version stamping (pick a resolver + a stamper), and over-the-wire deploy verification (`cmd=version` — the mandatory, non-skippable proof that a deploy actually landed, replacing flaky end-to-end suites as the deploy gate). Includes §Deployment Models — single project w/ named deployments (GActionSheet, NUUC-Dispatch) vs two projects per env (F3Go30/RankChoiceVoting, forced by bound containers), with decision drivers (bound container → two projects; add-on/Marketplace overhead → single project). Also documents the shared webapp caller. | `packages/gas-deploy/`, consumed by F3Go30, RankChoiceVoting, GActionSheet, PracticeMix, NUUC-Dispatch |
| [`gas-cm-and-deployment/`](gas-cm-and-deployment/README.md) | Release-governance layer on top of `gas-deployment/`: `pnpm version`, git tags, post-release bump, deploy-stamp commit into git history. Deploy mechanics live in `gas-deployment/`; this folder no longer duplicates them. | AudioTrackCombiner v1.6+, adapted for the `gas-deploy` package |
| [`google-sheet-verification/`](google-sheet-verification/README.md) | Verify Google Sheet content by downloading as xlsx via Drive export URL | WingTools/WingReportGAS |
| [`gas-email-templating/`](gas-email-templating/README.md) | HTML email templating with HtmlService scriptlets, delivery policy (test-mode redirect + Drive audit record), XSS safety | F3Go30 |
| [`gas-acceptance-testing/`](gas-acceptance-testing/README.md) | End-to-end acceptance/scenario testing of a GAS app from Python: entry-point-as-call-site technique (incl. single-shot scheduled triggers), `run_fixture` dispatcher, completion-signal + artifact download, doc-scoped isolation, 6-min batching. GAS stack adapter for DevStandard `test-framework/sdlc-testing-principles.md` (`T1`–`T25`). | GActionSheet |
| [`gas-test-reporting/`](gas-test-reporting/README.md) | Allure test reporting for projects with pytest + Playwright: per-run isolation, deployment stamping via ledger, history trends, failure categorisation, WSL2 serve, smoke test pattern. | GActionSheet |
| [`gas-static-frontend/`](gas-static-frontend/README.md) | Porting an `HtmlService` page to a static HTML/JS front end (GitHub Pages, etc.) calling the GAS web app as a JSON API: CORS spike, config/identity routing, favicon/title/bookmarkable-URL fixes, build/publish pipeline, iOS/Safari 7-day storage cap, first-party GIS identity & access control. The build/publish pipeline it describes is the [`gas-static`](../packages/gas-static/README.md) package, not a copy-me script — this folder owns the **page**, the package owns the **pipeline**. | F3Go30, RankChoiceVoting, GActionSheet/NUUC-Dispatch |
| [`gas-webapp-admin/`](gas-webapp-admin/README.md) | WebApp `cmd=admin` operator routes gated by a set-once shared secret (bootstrapped over the wire, never typed into the editor) — the minimum core admin/diagnostic surface: `bootstrapSecret` (the one ungated door), `setScriptProperties`, `getScriptProperties` (key names only, never values), `getAuthInfo` runtime-scope diagnostics. Includes the deploy-time self-bootstrap hook-ordering pattern (bootstrap must precede the first secret-gated `postDeploy` hook). The CLI caller that owns URL/secret/payload boilerplate is now `gas-deployment/`'s shared package caller, not a copy in this folder. | F3Go30, NUUC-Dispatch, NUUTS-Shell |
| [`gas-workspace-addons/`](gas-workspace-addons/README.md) | Google Workspace Add-on (`addOns` manifest) setup, GCP/Marketplace SDK plumbing, and distribution. Includes §UI Location & Visibility — where each add-on surface actually renders (side panel vs. legacy bound-script menu, both now nested under Extensions with an auto-`Help` item), why a script bound to one host (e.g. a Sheet) still fires `onOpen()` inside another host it's installed as an add-on for (e.g. Docs), a `CardService` fallback for `universalActions` entries that don't reliably surface, and why the Marketplace SDK Application Configuration's per-host deployment-version pointer going stale causes silent, host-asymmetric breakage that looks like a code regression but isn't. | GActionSheet |
| [`gas-domain-objects/`](gas-domain-objects/README.md) | Container/collection domain-object pattern that closes `I13`'s type-leak gap: identifier confinement alone does not stop a boundary module from returning a raw platform type (e.g. a GAS `Sheet`). Two-tier model (instance-less domain shims vs. container/collection domain objects), the migration argument for why bare-name addressing hardcodes topology, the domain-shaped-handle rule, and the testability consequence. | NDocs (worked example of the gap), GAS-Core `libs/LibSheets` (worked example of the pattern) |

---

## Noted Patterns (not yet elevated)

Patterns observed in the same projects that may be worth full documentation if they recur in a third project.

| Pattern | Summary | Source |
|---|---|---|
| GAS WebApp response-delivery transient 404 (`echo` hop) | A GAS Web App call is two hops: `/exec` returns a 302 to `script.googleusercontent.com/macros/echo?user_content_key=...`, and the client follows that redirect to get the actual JSON body. Observed once: the second hop stalled 26.8s then 404'd with a generic Google HTML error page — read by the client as "Non-JSON response" — while server-side logs (correlated by `op` id) confirmed the script itself completed successfully in ~9s. Ruled out as the cause on retest: Brave Shields on/off (both states produced clean runs afterward) and slow backend execution (a later clean run had a *longer* `doPost` than the failing one). Diagnostic recipe: capture a HAR at failure time, confirm the 302→echo→404 shape, cross-reference server logs by `op` id to rule out (or confirm) backend involvement before debugging application code. First occurrence — watch for a second project before elevating. | `GActionSheet/knowledge-base/references/gas-webapp-echo-fetch-transient-404.md` |
| Unit testing GAS `.js.html` source in Node.js | Strips the `<script>` wrapper at test time with a regex, evaluates the source via `new Function`, and uses a dual-export guard (`if (typeof module !== 'undefined') module.exports = ...`) so the same file works as a GAS HtmlService include and a Node.js unit-testable module. No build step. Uses Node's built-in `node:test` runner. | `AudioTrackCombiner/tests/unit/` |
| JSON serialization contract / round-trip validation | Locks the exact serialization settings as a named constant, then asserts that `load → dump → reload` produces bit-identical floats, preserves key ordering, and leaves unrelated fields untouched across a corpus of real asset files. Catches silent data corruption from serialization drift before it propagates. | `WingTools/WingLoad2/tests/test_snap_round_trip.py` |
| Standard-GCP-project OAuth provisioning for GAS web apps | The gotcha set for binding a GAS script to an explicit GCP project: sensitive scopes (e.g. `script.external_request`, `admin.directory.group*.readonly`) must be registered on the OAuth consent screen or they're **silently dropped** from the deployer's grant — the manifest's `oauthScopes` alone is not enough; the underlying API must also be separately Enabled in GCP Console → APIs & Services → Library (a disabled API can suppress the consent prompt entirely, with no dialog and no error at that step); the consent prompt only fires when a run actually *calls* the needing service (entry points that return early "authorize" with an incomplete token — fix: a parameterless auth-probe function); verification-exemption rules (a logo voids the non-sensitive-scope exemption; authorized domain must be the full subdomain for public-suffix hosts like `github.io`; External vs Internal user type). **Second confirmed occurrence (2026-07-23, GActionSheet/Spike S2, Admin SDK Directory scopes) — ready to elevate to a proper best-practices folder** (likely merges into `gas-static-frontend` + `demo-config-reference`, or a new `gas-oauth-scope-provisioning/`). | `NUUC-Dispatch/docs/OPERATIONS.md` §Initial provisioning, §Failure Modes; `GActionSheet/knowledge-base/references/gas-admin-directory-external-groups.md` |
| Group-conferred Drive access for external members via Admin SDK | `DriveApp.getFolderById(id).getAccess(email)` resolves direct grants but never expands group membership — even for domain-managed groups. Fallback: `Drive.Permissions.list(id, {supportsAllDrives:true})` (Drive v2) to find `type:'group'` entries, then `AdminDirectory.Members.get(groupKey, memberKey)` per group (NOT `.hasMember()`, which throws `Invalid Input: memberKey` for external/non-domain memberKeys even on real members). Also: `DriveApp.setSharing()` throws on Shared Drive items — use `Drive.Permissions.insert/remove` (v2) instead. First occurrence — watch for a second project needing this before elevating. | `GActionSheet/knowledge-base/references/gas-admin-directory-external-groups.md` (Spike S2, `GTaskSheet-79dw.2`) |

---

## Platform-boundary ownership (`I13` in GAS)

This section is the GAS expression of DevStandard **`I13` — Platform-boundary ownership**
(`$DEVSTANDARD/test-framework/sdlc-implementation-principles.md`, added 2026-09-14,
`GAS-Core-o4k`). `I13` owns the principle; this section owns the GAS mechanism and GAS-Core's
per-module disposition.

Each external platform boundary a project touches — Sheets, Drive, Docs, Admin SDK, mail,
outbound HTTP, cache, locks, script properties — has **exactly one owning module**, and the
boundary is named only inside it. This is the same discipline `I6` states for contract shapes
and `I12` for logic shapes, applied to platform boundaries.

Two things it buys, in order of importance:

1. **`T14` becomes auditable.** `T14` requires ≥1 real-boundary conformance test per *boundary
   operation*. If `AdminDirectory` is named in nine files you cannot enumerate the operations,
   so you cannot tell whether the obligation is discharged. With one owning module the
   operation list is the module's exported surface.
2. **The layer above becomes testable off-platform.** Everything that is not the owning module
   can run under `node --test` in a `vm` sandbox against a stub, which is what `T12` focused
   helper tests need.

**The seam does not discharge `T14`.** A stubbed owning module proves the *caller's* logic, not
the boundary's contract. Each boundary operation still needs its real crossing, and that
crossing is written against the owning module. Read `T12` and `T14` together here.

**Ownership is about the module, not the filename.** A `*Adapter.js` suffix is one way to
express it; a driver, a library, or a route file is another. The test is "is this the only
place that names the (boundary, operation) pair," not "does the filename end in `Adapter`."

### The two clauses that matter most in GAS

GAS makes two of `I13`'s constraints load-bearing rather than academic, and both are what let
`gas-server-logging/` conform on the merits — it never reaches for `I13`'s exemption clause,
which is available to non-production artifacts only.

**The owned unit is the (boundary, operation) pair, not the SDK identifier.** `UrlFetchApp` is
named in both `AxiomLogger.js` (POST to the Axiom ingest endpoint) and
`gas-webapp-admin/Admin.js` (GET Google's `tokeninfo`). Those are two remote contracts that
happen to share one SDK function; they are not a duplicated operation, and merging them would
be nonsense. Audit by remote contract, never by grepping the SDK name alone.

**Connection parameters belong to the boundary they reach.** `AXIOM_TOKEN`/`AXIOM_DATASET` are
how you address Axiom; `GAS_LOGGER_FOLDER_ID` is how you address the Drive sink. Reading them
inside the module that owns the corresponding boundary *is* that ownership — not a second claim
on some shared "script properties" boundary. The property store is a boundary in its own right
only where the store itself is the subject, which in GAS-Core is exactly
`gas-webapp-admin/Admin.js`'s `setScriptProperties` operator route and nothing else.

Without that clause `PropertiesService` would appear to have three owners in GAS-Core
(`GasLogger.js`, `AxiomLogger.js`, `Admin.js`) and logging would fail `I13`. With it there is
one property-*store* boundary (`Admin.js`) and two boundaries that address themselves
(`GasLogger.js` → Drive, `AxiomLogger.js` → Axiom). The clause covers the config read only; the
boundary call it parameterises stays confined either way.

**Why the loggers self-configure rather than take injected config.** `I13` prefers injection at
the owner, but GAS offers no ordered bootstrap to inject in: clasp bundles every `.js` into one
global scope with no load-order guarantee, so a load-time
`GasLogger.registerDriver(AxiomLogger)` is a footgun — if the driver file loads first,
`GasLogger` does not exist yet. That is why `GasLogger.flush()` discovers its driver by
well-known global name at *flush* time (`typeof AxiomLogger !== 'undefined' &&
AxiomLogger.isConfigured()`), and why `AxiomLogger._getConfig()` reads its properties lazily and
memoises. `I13`'s injection clause admits exactly this case: where the runtime offers no ordered
bootstrap, lazy self-configuration inside the owner satisfies the principle, and the absence of
a bootstrap is recorded as the reason. This paragraph is that record.

### Disposition

Every GAS-Core module that names a platform global (full audit, 2026-09-14):

| Module | Boundary owned | Disposition |
|---|---|---|
| `gas-server-logging/GasLogger.js` | Drive log sink — `DriveApp`, `Utilities`, `MimeType`, plus `GAS_LOGGER_FOLDER_ID` as that sink's connection parameter | **Conforms on the merits, no exemption used.** Sole owner of the Drive-sink operations; its `PropertiesService` read is the Drive sink's own address (connection-parameter clause). Sink architecture is already the driver seam and `maskPiiForLog_` is already extracted for Node unit tests. No refactor. |
| `gas-server-logging/AxiomLogger.js` | Axiom ingest endpoint — `UrlFetchApp.fetch` to `api.axiom.co/v1/datasets/*/ingest`, plus `AXIOM_TOKEN`/`AXIOM_DATASET` as its connection parameters | **Conforms on the merits, no exemption used.** A different remote contract from `Admin.js`'s `tokeninfo` GET, so the shared `UrlFetchApp` identifier is not a shared operation ((boundary, operation) clause). Its `PropertiesService` read is Axiom's own address (connection-parameter clause). Lazy self-configuration is justified above. No refactor. |
| `gas-webapp-admin/Admin.js` | Two boundaries: the **property store as subject** (`setScriptProperties` — enumerate/write/expose) and the Google `tokeninfo` endpoint (`UrlFetchApp`, `ScriptApp.getOAuthToken`, `Session`) | **Conforms.** This is the estate's single property-*store* owner — the one place the store itself is the subject rather than a means to another boundary. No refactor. |
| `libs/LibSheets/libSheets.js` | Sheets (`SpreadsheetApp`) | **Conforms, and is the better shape.** The spreadsheet is injected (`spreadsheet \|\| SpreadsheetApp.getActiveSpreadsheet()`), so the global appears once as a default, not at call sites. Injection at the boundary owner is the preferred expression. |
| `libs/LibSidebar/NotificationSBCode.js` | Sidebar UI + its property/lock store (`HtmlService`, `SpreadsheetApp.getUi`, `PropertiesService`, `LockService`, `Utilities`) | **Conforms.** Sole owner of the sidebar boundary. No refactor. |
| `gas-static-frontend/gas-backend-example.js` | — | **Exempt — illustrative.** A deliberately single-file, readable end-to-end example; splitting it into adapters would defeat the document it serves. |
| `gas-static-frontend/measure-first-paint.js`, `examples/demo-harness/harness.js`, `libs/**/\*Demo.js`, `libs/**/test/\*.test.js` | — | **Exempt — harness, demo, and test code.** Not production layers; nothing sits above them to keep testable. |

No GAS-Core production module fails `I13`, and none relies on the exemption clause. Every one
of them would fail a *filename* form of the rule (`*Adapter.js` only) — which is the evidence
that the filename form is over-specified and the ownership form is the one that was promoted.

**Audit recipe.** Grepping the SDK identifier alone over-reports: it flags `UrlFetchApp` twice
for two unrelated remote contracts, and `PropertiesService` three times for what are really one
store-as-subject owner and two connection-parameter reads. Enumerate (boundary, operation)
pairs by remote contract, then check each has one owner.

**Identifier confinement is not type confinement.** `I13` as ratified says nothing about what an
owning module *returns* — a module can be the sole owner of `SpreadsheetApp` and still hand a raw
`Sheet` to every caller. See [`gas-domain-objects/README.md`](gas-domain-objects/README.md) for
the container/collection domain-object pattern that closes this gap, and
[`../knowledge-base/proposals/i13-type-leak-amendment-draft.md`](../knowledge-base/proposals/i13-type-leak-amendment-draft.md)
for the drafted (not yet ratified) `I13` amendment.

---

## When to Use These

These are proven patterns, not mandates. Apply them when:
- You are starting a new GAS project and face the same challenge
- You want a reference implementation before designing your own solution
- You are adapting an existing project to add testing or deployment automation

Each pattern is independently adoptable — you do not need all four for any given project.
