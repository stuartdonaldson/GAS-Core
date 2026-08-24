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
| [`gas-server-logging/`](gas-server-logging/README.md) | GAS server-side logging to Google Drive, read by dev tooling via Drive for Desktop | AudioTrackCombiner |
| [`gas-playwright-testing/`](gas-playwright-testing/README.md) | Playwright testing for GAS web apps: nested iframe navigation, auth, console capture | AudioTrackCombiner |
| [`gas-deployment/`](gas-deployment/README.md) | Install the shared `gas-deploy` package (`packages/gas-deploy/`, a pnpm git-subdirectory dependency) rather than copy a template: stable named-deployment URLs, version stamping (pick a resolver + a stamper), and over-the-wire deploy verification (`cmd=version` — the mandatory, non-skippable proof that a deploy actually landed, replacing flaky end-to-end suites as the deploy gate). Includes §Deployment Models — single project w/ named deployments (GActionSheet, NUUC-Dispatch) vs two projects per env (F3Go30/RankChoiceVoting, forced by bound containers), with decision drivers (bound container → two projects; add-on/Marketplace overhead → single project). Also documents the shared webapp caller. | `packages/gas-deploy/`, consumed by F3Go30, RankChoiceVoting, GActionSheet, PracticeMix, NUUC-Dispatch |
| [`gas-cm-and-deployment/`](gas-cm-and-deployment/README.md) | Release-governance layer on top of `gas-deployment/`: `pnpm version`, git tags, post-release bump, deploy-stamp commit into git history. Deploy mechanics live in `gas-deployment/`; this folder no longer duplicates them. | AudioTrackCombiner v1.6+, adapted for the `gas-deploy` package |
| [`google-sheet-verification/`](google-sheet-verification/README.md) | Verify Google Sheet content by downloading as xlsx via Drive export URL | WingTools/WingReportGAS |
| [`gas-email-templating/`](gas-email-templating/README.md) | HTML email templating with HtmlService scriptlets, delivery policy (test-mode redirect + Drive audit record), XSS safety | F3Go30 |
| [`gas-acceptance-testing/`](gas-acceptance-testing/README.md) | End-to-end acceptance/scenario testing of a GAS app from Python: entry-point-as-call-site technique (incl. single-shot scheduled triggers), `run_fixture` dispatcher, completion-signal + artifact download, doc-scoped isolation, 6-min batching. GAS stack adapter for DevStandard `atdd-bdd.md`. | GActionSheet |
| [`gas-test-reporting/`](gas-test-reporting/README.md) | Allure test reporting for projects with pytest + Playwright: per-run isolation, deployment stamping via ledger, history trends, failure categorisation, WSL2 serve, smoke test pattern. | GActionSheet |
| [`gas-static-frontend/`](gas-static-frontend/README.md) | Porting an `HtmlService` page to a static HTML/JS front end (GitHub Pages, etc.) calling the GAS web app as a JSON API: CORS spike, config/identity routing, favicon/title/bookmarkable-URL fixes, build/publish pipeline, iOS/Safari 7-day storage cap, first-party GIS identity & access control. Includes [`RECOMMENDATION.md`](gas-static-frontend/RECOMMENDATION.md) — cross-project survey of the three hand-copied build/publish pipelines, the proposed `gas-static` package (build → publish → `assertPublishedBuild`), the brokered-identity model (NUUC-Dispatch → target app) vs. direct GIS, and the PracticeMix migration plan. | F3Go30, RankChoiceVoting, GActionSheet/NUUC-Dispatch |
| [`gas-webapp-admin/`](gas-webapp-admin/README.md) | WebApp `cmd=admin` operator routes gated by a set-once shared secret (bootstrapped over the wire, never typed into the editor): `setScriptProperties`, `getAuthInfo` runtime-scope diagnostics. The CLI caller that owns URL/secret/payload boilerplate is now `gas-deployment/`'s shared package caller, not a copy in this folder. | F3Go30, NUUC-Dispatch |
| [`gas-workspace-addons/`](gas-workspace-addons/README.md) | Google Workspace Add-on (`addOns` manifest) setup, GCP/Marketplace SDK plumbing, and distribution. Includes §UI Location & Visibility — where each add-on surface actually renders (side panel vs. legacy bound-script menu, both now nested under Extensions with an auto-`Help` item), why a script bound to one host (e.g. a Sheet) still fires `onOpen()` inside another host it's installed as an add-on for (e.g. Docs), a `CardService` fallback for `universalActions` entries that don't reliably surface, and why the Marketplace SDK Application Configuration's per-host deployment-version pointer going stale causes silent, host-asymmetric breakage that looks like a code regression but isn't. | GActionSheet |

---

## Noted Patterns (not yet elevated)

Patterns observed in the same projects that may be worth full documentation if they recur in a third project.

| Pattern | Summary | Source |
|---|---|---|
| Unit testing GAS `.js.html` source in Node.js | Strips the `<script>` wrapper at test time with a regex, evaluates the source via `new Function`, and uses a dual-export guard (`if (typeof module !== 'undefined') module.exports = ...`) so the same file works as a GAS HtmlService include and a Node.js unit-testable module. No build step. Uses Node's built-in `node:test` runner. | `AudioTrackCombiner/tests/unit/` |
| JSON serialization contract / round-trip validation | Locks the exact serialization settings as a named constant, then asserts that `load → dump → reload` produces bit-identical floats, preserves key ordering, and leaves unrelated fields untouched across a corpus of real asset files. Catches silent data corruption from serialization drift before it propagates. | `WingTools/WingLoad2/tests/test_snap_round_trip.py` |
| Standard-GCP-project OAuth provisioning for GAS web apps | The gotcha set for binding a GAS script to an explicit GCP project: sensitive scopes (e.g. `script.external_request`, `admin.directory.group*.readonly`) must be registered on the OAuth consent screen or they're **silently dropped** from the deployer's grant — the manifest's `oauthScopes` alone is not enough; the underlying API must also be separately Enabled in GCP Console → APIs & Services → Library (a disabled API can suppress the consent prompt entirely, with no dialog and no error at that step); the consent prompt only fires when a run actually *calls* the needing service (entry points that return early "authorize" with an incomplete token — fix: a parameterless auth-probe function); verification-exemption rules (a logo voids the non-sensitive-scope exemption; authorized domain must be the full subdomain for public-suffix hosts like `github.io`; External vs Internal user type). **Second confirmed occurrence (2026-07-23, GActionSheet/Spike S2, Admin SDK Directory scopes) — ready to elevate to a proper best-practices folder** (likely merges into `gas-static-frontend` + `demo-config-reference`, or a new `gas-oauth-scope-provisioning/`). | `NUUC-Dispatch/docs/OPERATIONS.md` §Initial provisioning, §Failure Modes; `GActionSheet/knowledge-base/references/gas-admin-directory-external-groups.md` |
| Group-conferred Drive access for external members via Admin SDK | `DriveApp.getFolderById(id).getAccess(email)` resolves direct grants but never expands group membership — even for domain-managed groups. Fallback: `Drive.Permissions.list(id, {supportsAllDrives:true})` (Drive v2) to find `type:'group'` entries, then `AdminDirectory.Members.get(groupKey, memberKey)` per group (NOT `.hasMember()`, which throws `Invalid Input: memberKey` for external/non-domain memberKeys even on real members). Also: `DriveApp.setSharing()` throws on Shared Drive items — use `Drive.Permissions.insert/remove` (v2) instead. First occurrence — watch for a second project needing this before elevating. | `GActionSheet/knowledge-base/references/gas-admin-directory-external-groups.md` (Spike S2, `GTaskSheet-79dw.2`) |

---

## When to Use These

These are proven patterns, not mandates. Apply them when:
- You are starting a new GAS project and face the same challenge
- You want a reference implementation before designing your own solution
- You are adapting an existing project to add testing or deployment automation

Each pattern is independently adoptable — you do not need all four for any given project.
