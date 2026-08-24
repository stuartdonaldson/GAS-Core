# Demo Surface Matrix

What interface surface demonstrates which library/best-practice, and what's actually live vs. a
documented gap. Configuration steps referenced from cells are factored out to
[`demo-config-reference.md`](demo-config-reference.md) rather than repeated here — a cell says
*which* config sections it needs, not how to do them.

## Surfaces (glossary)

| Surface | Container | Delivery mechanism | Status in this repo |
|---|---|---|---|
| **Sheet menu** | Bound Sheet | `onOpen()` menu item → named global fn (`push-demo.sh` harness) | ✅ built |
| **Sheet sidebar** | Bound Sheet | Menu opens an `HtmlService` sidebar, self-driving via `google.script.run` | ✅ built |
| **Doc menu** | Bound Doc | Same model as Sheet menu, different container | ❌ host stub exists (`docId`/`docScriptId` empty in `harness-hosts.json`), never provisioned |
| **Sheets/Docs add-on** | Installable across users | `CardService` UI, Marketplace-style manifest, `homepageTrigger` | ❌ not attempted — architecturally distinct from the bound-script harness (install flow, not a reused owned host); treat as a separate future track, not a `push-demo.sh` variant |
| **Standalone webapp (JSON)** | None (standalone script) | `doPost`/`doGet` returning JSON, called via `fetch()` | ✅ built (`gas-static-frontend/gas-backend-example.js`) |
| **Standalone webapp (HTML)** | None or bound | `doGet` returning `HtmlService.createTemplateFromFile()` rendered page | ❌ not built — the harness's `doGet` currently only returns JSON (`?action=info`, `?demo=`) |
| **Dialog** | Bound Sheet/Doc | `HtmlService` + `showModalDialog` | ❌ not built |
| **Static HTML** | None — hosted anywhere over HTTPS | Plain top-level page, calls a GAS webapp as a JSON API via `fetch()` | ✅ built (`static/index.html`, GitHub Pages) — **deliberately outside** the `push-demo.sh` harness; see note below |

**Why static HTML isn't in the harness:** it exists specifically to escape constraints
`HtmlService` rendering can never fix from inside GAS (sandboxed-iframe first-paint cost, no
client-side `document.title`/favicon control, no CDN caching, iOS Safari's 7-day ITP storage cap).
Folding it into `push-demo.sh`/`harness-hosts.json` would defeat the pattern. See
`best-practices/gas-static-frontend/README.md`.

## Matrix

`✅` = live demo exists · `❌` = gap, nothing built · `—` = not a meaningful pairing · `⟳` = cross-cutting, composes into whichever surface's server code runs it (not a standalone demo)

| Feature / best-practice | Sheet menu | Sheet sidebar | Doc menu | Add-on | Webapp (JSON) | Webapp (HTML) | Dialog | Static HTML |
|---|---|---|---|---|---|---|---|---|
| LibSheets (sheet mgmt) | ✅ `libsheets-basic` | — | — | — | — | — | — | — |
| LibSidebar (notifications) | (launches via menu) | ✅ `libsheets-with-notifications` | — | — | — | — | ❌ same content, different chrome — not built | — |
| gas-email-templating | — | — | ❌ | — | — | — | ❌ natural fit: preview rendered template without sending | — |
| gas-static-frontend (CORS/JSON split) | — | — | — | — | ✅ backend half | — | — | ✅ frontend half |
| gas-static-frontend (GIS identity & access control) | — | — | — | — | ✅ `whoami` action, full verify+allowlist | — | — | ✅ sign-in card |
| gas-cm-and-deployment (version stamping) | — | — | — | — | ✅ `?action=info` (JSON only) | ❌ would be a natural page — not built | — | — |
| gas-server-logging (Axiom/Drive) | ⟳ | ⟳ | ⟳ | ⟳ | ⟳ | ⟳ | ⟳ | — (no server) |
| REST API calls needing OAuth scopes | — | — | — | — | ❌ no demo exercises this — see [config reference §3](demo-config-reference.md#3-calling-a-google-rest-api-that-requires-the-scripts-own-oauth-identity) | — | — | — |
| gas-acceptance-testing, gas-editor-testing, gas-playwright-testing, gas-test-reporting, google-sheet-verification | — | — | — | — | — | — | — | — |

The last row is deliberately all `—`: these are testing-methodology practices, not
consumer-facing features. They're already demonstrated by the harness's own Tier 1/2/3 test
suites (`docs/test-harness-design.md`), not by a UI surface — don't build a "demo" of a test
practice.

## Configuration needed per row

Cross-reference into [`demo-config-reference.md`](demo-config-reference.md) — listed once here so
a given demo's setup cost is visible without opening every cell:

| Feature | Config sections needed |
|---|---|
| LibSheets / LibSidebar (harness demos) | [clasp project setup](demo-config-reference.md#clasp-project-setup) (via `push-demo.sh`, not manual), [host provisioning](demo-config-reference.md#host-provisioning-push-demosh-harness-only) |
| gas-static-frontend, `ping` action | [clasp project setup](demo-config-reference.md#clasp-project-setup) |
| gas-static-frontend, `whoami`/GIS sign-in | above, plus [anonymous webapp identity model](demo-config-reference.md#anonymous-webapp-identity-model), [GIS OAuth client ID](demo-config-reference.md#gis-oauth-client-id-sign-in), [Script Properties](demo-config-reference.md#script-properties) |
| gas-server-logging (Axiom) | [Script Properties](demo-config-reference.md#script-properties) (`AXIOM_TOKEN`/`AXIOM_DATASET`) |
| Any future REST-API-with-OAuth demo | [OAuth scopes for REST APIs](demo-config-reference.md#oauth-scopes-for-calling-rest-apis) |
| Static HTML publish | [Static hosting publish](demo-config-reference.md#static-hosting-publish-github-pages) |

## Known gaps, prioritized

1. **REST-API-with-OAuth-scopes demo** — nothing in the repo exercises `oauthScopes` +
   `ScriptApp.getOAuthToken()` or Advanced Services; the config reference describes the mechanism
   but there's no worked, running example.
2. **Webapp-HTML `kind`** — `doGet` only ever returns JSON today; a version-stamp page for
   `gas-cm-and-deployment` would be the smallest real example.
3. **`dialog` kind** — smallest new surface to add to the harness; natural fit for
   `gas-email-templating` (preview without sending).
4. **Doc host** — stub only; provision when a concrete Doc-bound demo needs it, not before.
5. **Add-on surface** — out of scope for the current harness model; would need its own
   install-flow-aware test tier if pursued.
