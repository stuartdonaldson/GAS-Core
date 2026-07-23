# Best Practices

Reusable patterns and tools derived from working implementations in active projects. Each folder contains:

- A `README.md` with architecture overview, annotated examples, setup instructions, and trade-offs
- Copies of reusable tools or scripts that can be used as a starting point in a new project

---

## Index

| Folder | Pattern | Source |
|---|---|---|
| [`gas-server-logging/`](gas-server-logging/README.md) | GAS server-side logging to Google Drive, read by dev tooling via Drive for Desktop | AudioTrackCombiner |
| [`gas-playwright-testing/`](gas-playwright-testing/README.md) | Playwright testing for GAS web apps: nested iframe navigation, auth, console capture | AudioTrackCombiner |
| [`gas-deployment/`](gas-deployment/README.md) | Clasp-based deployment management: stable TEST/PROD URLs, version stamping. Includes §Deployment Models — single project w/ named deployments (AudioTrackCombiner, GActionSheet, NUUC-Dispatch) vs two projects per env (F3Go30, forced by bound containers), with decision drivers (bound container → two projects; add-on/Marketplace overhead → single project). | AudioTrackCombiner + F3Go30/GActionSheet/NUUC-Dispatch |
| [`gas-cm-and-deployment/`](gas-cm-and-deployment/README.md) | Configuration management + release workflow: npm version, git tags, post-release bump, deploy stamp | AudioTrackCombiner v1.6+ |
| [`google-sheet-verification/`](google-sheet-verification/README.md) | Verify Google Sheet content by downloading as xlsx via Drive export URL | WingTools/WingReportGAS |
| [`gas-email-templating/`](gas-email-templating/README.md) | HTML email templating with HtmlService scriptlets, delivery policy (test-mode redirect + Drive audit record), XSS safety | F3Go30 |
| [`gas-acceptance-testing/`](gas-acceptance-testing/README.md) | End-to-end acceptance/scenario testing of a GAS app from Python: entry-point-as-call-site technique (incl. single-shot scheduled triggers), `run_fixture` dispatcher, completion-signal + artifact download, doc-scoped isolation, 6-min batching. GAS stack adapter for DevStandard `atdd-bdd.md`. | GActionSheet |
| [`gas-test-reporting/`](gas-test-reporting/README.md) | Allure test reporting for projects with pytest + Playwright: per-run isolation, deployment stamping via ledger, history trends, failure categorisation, WSL2 serve, smoke test pattern. | GActionSheet |
| [`gas-static-frontend/`](gas-static-frontend/README.md) | Porting an `HtmlService` page to a static HTML/JS front end (GitHub Pages, etc.) calling the GAS web app as a JSON API: CORS spike, config/identity routing, favicon/title/bookmarkable-URL fixes, build/publish pipeline, iOS/Safari 7-day storage cap, first-party GIS identity & access control. | F3Go30 |
| [`gas-webapp-admin/`](gas-webapp-admin/README.md) | WebApp `cmd=admin` operator routes gated by a set-once shared secret (bootstrapped over the wire, never typed into the editor), plus a CLI caller tool owning URL/secret/payload boilerplate: `setScriptProperties`, `getAuthInfo` runtime-scope diagnostics. | F3Go30, NUUC-Dispatch |

---

## Noted Patterns (not yet elevated)

Patterns observed in the same projects that may be worth full documentation if they recur in a third project.

| Pattern | Summary | Source |
|---|---|---|
| Unit testing GAS `.js.html` source in Node.js | Strips the `<script>` wrapper at test time with a regex, evaluates the source via `new Function`, and uses a dual-export guard (`if (typeof module !== 'undefined') module.exports = ...`) so the same file works as a GAS HtmlService include and a Node.js unit-testable module. No build step. Uses Node's built-in `node:test` runner. | `AudioTrackCombiner/tests/unit/` |
| JSON serialization contract / round-trip validation | Locks the exact serialization settings as a named constant, then asserts that `load → dump → reload` produces bit-identical floats, preserves key ordering, and leaves unrelated fields untouched across a corpus of real asset files. Catches silent data corruption from serialization drift before it propagates. | `WingTools/WingLoad2/tests/test_snap_round_trip.py` |
| Standard-GCP-project OAuth provisioning for GAS web apps | The gotcha set for binding a GAS script to an explicit GCP project with a public GIS sign-in surface: sensitive scopes (e.g. `script.external_request`) must be registered on the OAuth consent screen or they're **silently dropped** from the deployer's grant; the consent prompt only fires when a run actually *calls* the needing service (entry points that return early "authorize" with an incomplete token — fix: a parameterless auth-probe function); verification-exemption rules (a logo voids the non-sensitive-scope exemption; authorized domain must be the full subdomain for public-suffix hosts like `github.io`; External vs Internal user type). Deliberately left maturing in the source project until its dispatcher build stabilizes — merge here afterward (likely into `gas-static-frontend` + `demo-config-reference`). | `NUUC-Dispatch/docs/OPERATIONS.md` §Initial provisioning, §Failure Modes |
| Generated `.clasp.json` from `local.settings.json` | `.clasp.json` (gitignored) is regenerated by the deploy tool from `local.settings.json` on every run, so the real `scriptId` is never committed and retargeting the repo at a different Apps Script/GCP project is a one-file edit. Candidate extension to `gas-deployment`. | `NUUC-Dispatch/tools/manage-deployments.js` (`ensureClaspJson()`) |

---

## When to Use These

These are proven patterns, not mandates. Apply them when:
- You are starting a new GAS project and face the same challenge
- You want a reference implementation before designing your own solution
- You are adapting an existing project to add testing or deployment automation

Each pattern is independently adoptable — you do not need all four for any given project.
