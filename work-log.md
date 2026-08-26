## 2026-06-18 08:32:34

### Summary:
Re-architected the libs/ test & demo harness instead of executing batch 4. After
flagging the existing approach as overly complex/expensive, pivoted the design
across three iterations to a final HYBRID model and re-scoped all tracking:

- **Dropped the shared integration aggregator** (examples/integrated/test-harness/)
  and its demo-vendoring machinery. Deleted scripts/copy-demo-files.sh +
  pairs-file.txt; reverted scripts/check-lib-drift.sh to its production-only
  version (the production-consumer anti-fork drift check is retained).
- **Adopted the hybrid model:** the deployable unit is a *demo* composing 1+
  libraries; demo logic co-locates in libs/<Name>/<name>Demo.js (a <LIB>_DEMOS
  manifest of named global functions) so a contributor adding a feature touches
  only libs/<Name>/. A shared examples/demo-harness/ wrapper provides
  Harness.getSheet() + onOpen menu + doGet; examples/demos/<demo>/demo.config.json
  declares {host, uses[]}; scripts/push-demo.sh assembles wrapper + uses[] libs
  and clasp-pushes to reusable hosts (scriptIds in libs/harness-hosts.json).
- **Rewrote docs/test-harness-design.md** to the hybrid (banner + §2/§4.0/§4.1/
  §4.3/§8/§9), marking aggregator sections superseded.
- **bd:** closed pos.6 (obsolete); created GAS-Core-sou (tool+wrapper) and
  GAS-Core-xnc (extract demos out of vendored libSheets.js); re-scoped
  pos.2/7/8/9/10; recorded 3 memories (authoritative:
  test-demo-harness-hybrid-model-2026-06-18). Created batch:8-demo-foundation
  (xnc+sou+7p5, model:sonnet), unblocked sou from pos.2 — ready to dispatch.

### Key Learnings:
- GAS V8 loads every file in a clasp project into ONE shared global scope with
  no require() — this single fact drove the entire pivot (it forced the
  aggregator's HARNESS_DEMOS_ namespacing + demo vendoring + drift policing).
- GAS menu items bind only to a NAMED zero-arg global function, never to an
  anonymous closure. The aggregator stored demos as entryPoint:(ctx)=>{} closures
  in a data array, so its per-feature menu click was a non-functional no-op. Fix:
  the demo manifest references the function by name string (demo:'libSheets_fn')
  and the function pulls its environment from a Harness accessor (zero-arg, bindable).
- clasp push overwrites a project's content, so a host project is a reusable
  "slot" — assemble the chosen demo at push time and nothing committed can drift
  (no vendoring, no drift check for demos).
- libSheets.js (the VENDORED production file) currently embeds demo functions
  (~lines 43-144) that ship to every consumer — extracting them (GAS-Core-xnc)
  is both the demo seed and a production-hygiene fix.

## 2026-06-18 15:56:57

### Summary:
Resolved GAS-Core-pos.2: adopted the new split harness-hosts.json schema (sheetId/sheetScriptId, docId/docScriptId, standalone). Updated scripts/push-demo.sh to resolve scriptId via `<host>ScriptId` and containerId via `<host>Id`, with an updated unset-host error message, and to print a clickable container URL (Sheet/Doc edit link) after a successful push. Updated docs/test-harness-design.md §4.0/§4.1 (mermaid node, layout block, prose) to document the new per-host containerId+scriptId shape. Closed GAS-Core-pos.2 in bd; Doc/Standalone hosts remain intentionally unprovisioned until a demo needs them (same manual one-off process used for Sheet).

### Key Learnings:
The container id (actual Sheet/Doc id) and the bound Apps Script project id are distinct and must both be tracked per host kind in libs/harness-hosts.json -- the scriptId drives `clasp push`, while the containerId is what lets push-demo.sh hand the user a real URL to the deployed demo (clasp open only opens the script editor, not the container).

## 2026-06-19 Session Summary

### Completed Batches (Test Harness Epic GAS-Core-pos)

Executed all 7 batches of the test harness epic, advancing from demo extraction through Tier 1/2/3 testing:

**Batch 8 (Demo Foundation)**
- GAS-Core-xnc: Extracted demo functions from vendored libSheets.js → libs/LibSheets/libSheetsDemo.js (hybrid manifest + named globals)
- GAS-Core-sou: Built push-demo tool, shared harness wrapper (examples/demo-harness/harness.js), demo.config.json schema, harness-hosts.json registry
- GAS-Core-7p5: Resolved require()-in-GAS-V8 bug (deleted obsolete libs/LibSheets/harness/demo.js)
- Live verification: pushed libsheets-basic demo to real Sheet host, confirmed menu binding works

**Batch 4 (Wiring Docs)**
- GAS-Core-pos.7: Added README contributor-flow section (PR workflow, Tier 1 gate, Tier 2 before tag, consumer re-pin + drift-check)

**Batch 5 (Sidebar)**
- GAS-Core-pos.8: Authored libs/LibSidebar/libSidebarDemo.js + composed libsheets-with-notifications demo (LibSheets + LibSidebar)
- Found & fixed real bug: push-demo.sh was silently dropping .html files (NotificationSidebar.html), breaking sidebar demo at runtime
- Verified composed demo assembly via --dry-run; both libsheets-basic and libsheets-with-notifications assemble correctly

**Batch 6 (Tier 2 Acceptance)**
- GAS-Core-pos.9: Pushed libsheets-basic demo to Sheet host, built Tier 2 acceptance pattern (deployment identity check + behavior assertions)
- Fixed bugs: push-demo.sh now excludes *.test.js (Node test files break GAS V8), uses clasp push --force for manifest overwrites
- Deleted salvage reference (examples/integrated/test-harness/) — aggregator no longer needed
- SANDBOX tests pass (31 Tier 1 + identity/doGet routing); LIVE requires OAuth consent (GAS-Core-2xf)

**Batch 7 (Tier 3 Playwright)**
- GAS-Core-pos.10: Created Playwright smoke spec (menu click → demo execution assertion)
- Created playwright.config.js, authenticate.js, updated .gitignore/README/package.json
- Manual/periodic gate by design (cannot auto-gate in CI; requires headed browser + Google auth)
- Documented blocker: GAS-Core-2xf (SpreadsheetApp OAuth) must be resolved before live testing

### Architecture Summary
- **Per-library standalone harnesses** (no aggregator, no HARNESS_DEMOS_ namespacing, no vendoring)
- **Hybrid demo model**: demo logic co-located in libs/<Name>/<name>Demo.js (LIBNAME_DEMOS manifest + named global fns)
- **Shared wrapper** (examples/demo-harness/harness.js): Harness.getSheet(), onOpen menu builder, doGet router
- **Push-demo tool** (scripts/push-demo.sh): assembles wrapper + chosen demo's libraries → clasp push to reusable host
- **Three-tier testing**: Tier 1 (Node regression, PR gate), Tier 2 (doGet acceptance, pre-release), Tier 3 (Playwright UI, periodic/manual)

### Issues Resolved
- 2 real bugs in push-demo.sh (missing .html files, non-interactive clasp behavior)
- Aggregator elimination + per-library harness consolidation completed
- Demo composition (multiple libs in one deployment) proven working

### Key Learnings
- GAS V8 single global scope requires library-prefixed manifests/functions to avoid collisions (no HARNESS_DEMOS_ namespace hack needed)
- Named global functions (vs closures) make GAS menu items click-bindable — this was the critical missing piece
- Reusable host as deployment slot (one demo active at a time) removes per-demo scaffolding cost
- Playwright headless cannot drive GAS editor nested iframes; headed + browser + auth required for Tier 3

### Blockers
- **GAS-Core-2xf**: Sheet host needs one-time OAuth consent (SpreadsheetApp scope) from host owner; after that Tier 2/3 tests become live-accessible
- **No git remote**: Local-only repo; commits created but no push path exists

### Next Steps
- Resolve GAS-Core-2xf (authorize SpreadsheetApp scope on Sheet host)
- Manual Tier 3 verification when ready (requires live browser + auth)
- Expand test harness to additional libraries (post-MVP)
- Consumer migrations can now follow documented contrib flow (Tier 1 gate + Tier 2 before tag)


## 2026-06-22 06:31:58

### Summary:
Updated `best-practices/gas-server-logging/` to match GActionSheet's current GasLogger design (it had moved past an earlier port made mid-session). Ported the Axiom-exclusive flush (no Drive fallback once AXIOM_TOKEN/AXIOM_DATASET are set — failures surface as timeouts, not silent gaps), `parentOp`/`getCurrentOp()` cross-execution correlation, and cached Axiom config lookup into `GasLogger.js`. Rewrote `gas-log-helpers.js` to add an Axiom query backend (auto-selected from `local.settings.json`) since the Drive-only version would have silently broken for any consumer enabling Axiom. Added new `query-axiom.py` CLI (stdlib-only). Rewrote README.md: corrected the "best-effort both sinks" framing to "exactly one sink, by design," added Cross-Execution Correlation and Sentinel-Watermark Waits sections (fixed timeouts are unsound for asserting absence against Axiom's variable ingest latency), condensed ADR-0019/0020 naming conventions inline, and added `local.settings.json` to `.gitignore` (wasn't covered anywhere previously). Also captured the Northlake-vs-personal-GitHub Axiom account identity question as an open decision in the README rather than resolving it.

### Key Learnings
- Cross-repo reference ported mid-session can go stale within the same session if the source repo is under active development — re-check `git log` on the reference path before finalizing, not just at the start.
- Axiom ingest-to-queryable latency is variable enough that absence assertions need a sentinel-watermark probe (post a fresh marker through the real path, wait for it to land, then check the suspect tag is absent up to that point) — a bare timeout produces false passes.
- A backend-switching test helper (Drive vs Axiom) must have its selection logic kept in sync with whatever the live GAS script's script properties actually say, or it silently polls an empty sink.

### Blockers
- Changes are uncommitted/unpushed (5 modified + 1 new file in `best-practices/gas-server-logging/`, plus `.gitignore`).
- No bd issue files this work yet.
- Template only — never live-tested against a real Axiom dataset/account; the Northlake-account decision is still open.

### Next Steps
- File a bd issue for this work, then commit + push.
- Resolve the Axiom account-identity decision, create the dataset/tokens, and run one live end-to-end test (`testGasLogger()` → Axiom Stream tab → `query-axiom.py` → `gas-log-helpers.js`).
- Re-check GActionSheet's `src/GasLogger.js`/`tests/helpers/gas_log.py` for further drift before next use of this template, given how quickly it moved this session.

## 2026-07-16 11:47:00
_session f53956f7 · v3 · 07-16_

### Objective 1: Rewrite best-practices/gas-server-logging with provenance research, ported features, and an Axiom-specific driver split
Rationale: The folder was already mid-rewrite (uncommitted) porting GActionSheet's current GasLogger design. Asked to trace where those advances came from and whether more was available to pull in, found GActionSheet's GasLogger.js/gas_log.py already matched the in-progress port (no further drift there), but a parallel fork in ~/proj/F3Go30 had independently added a run()/logError() entry-point wrapper, PII-masking helpers, and Node-unit-testable pure functions that hadn't made it back. Also found the README documented the sentinel-watermark absence-check pattern in prose without ever shipping a reusable implementation, unlike GActionSheet's Python test helper. After landing those, the developer asked "Is Axiom a well factored driver for this... there are many other possible logging providers" — flush() had Axiom's config/row-shaping/POST logic hardcoded inline rather than behind a swappable interface. Proposed a full N-driver plugin registry; developer scoped it down: "I'm ok leaving that there right now, but we should move all axiom code to an axiom specific module, and the query system should also support whichever one is configured."
Rejected: A full pluggable driver registry (array of driver objects iterated by flush()) was proposed but explicitly deferred by the developer in favor of the smaller Axiom-extraction-only scope; documented in README as the natural next step if a third sink appears.
Outcome [developer-facing]: GasLogger.js now carries zero Axiom-specific code — only its built-in Drive driver plus a one-line lazy discovery check (`typeof AxiomLogger !== 'undefined' && AxiomLogger.isConfigured()`, chosen over a load-time `registerDriver()` call to avoid a footgun from Apps Script's unordered file-bundling into one global scope). New AxiomLogger.js holds all Axiom config/row-shaping/ingest logic. Query side mirrors this: gas-log-helpers.js now owns only the file driver and delegates to new axiom-log-helpers.js's `createAxiomDriver()`. Added run()/logError() wrapper and maskPiiForLog_/maskRecipientListForLog_ helpers (from F3Go30) and axiomProbeLatency/assertGasLog/assertNoGasLog sentinel-watermark helpers (ported from GActionSheet's gas_log.py, previously undocumented-as-code). Added test_gas_logger.js (plain-Node unit test, no GAS runtime). README rewritten with a new "Sink Architecture" section explaining the driver split and its deliberate limits.
Outcome [internal]: Committed as aed9f44 (best-practices/gas-server-logging/ only — 8 files, unrelated pending changes in .beads/*, .gitignore, work-log.md left untouched for a separate commit).

### Key Learnings:
Apps Script's clasp bundles every project .js file into one shared global scope with no guaranteed load order, so a driver module cannot safely self-register into a core module via a top-level call (e.g. `GasLogger.registerDriver(AxiomLogger)` at file scope) — if the driver file happens to load first, the core global doesn't exist yet. A lazy `typeof X !== 'undefined'` check performed at call-time (not load-time) sidesteps the ordering hazard entirely.

## 2026-07-16 00:00:00
_session fc0a94e1 · v3 · 07-16_

### Objective 1: Document HtmlService vs. static-frontend feature availability
Rationale: User wanted a clear comparison of browser capabilities available inside GAS HtmlService's sandboxed iframe vs. a static first-party page calling the same web app as an API — info that existed but was scattered across the gas-static-frontend README's Problem, Storage persistence, and Identity sections.
Outcome [developer-facing]: Added a consolidated "Feature availability" comparison table to best-practices/gas-static-frontend/README.md (title, favicon, address bar, deep-link params, caching, ITP storage cap, GIS identity, CORS shape, config templating), placed right after the Problem section as a scannable quick reference, with a link down to the existing identity section for detail.

### Key Learnings:
The HtmlService-vs-static gap isn't about missing browser APIs — both run in the same real browser. It's entirely about which document the browser treats as top-level/first-party: that single fact explains title/favicon/URL control, CDN caching, and (on iOS Safari) whether the 7-day ITP storage clock ever resets.

## 2026-08-26 05:30:00
_session dec0c9e7 · v3 · 08-26_

### Objective 1: Convert RankChoiceVoting onto gas-static, and validate ADR-0002's config shape against a real project
Rationale: STAGING.md stage 2 (`convert-rcv`, bead GAS-Core-d7i). RCV was the second of four projects that had each hand-written the same stamp/publish/verify steps and diverged; it was sequenced second, on the more capable model, specifically because it was the conversion most likely to surface a needed package change. ADR-0002 had decided "declared config lives in two files" but explicitly forbade migrating any repo on that ADR alone — the shape was to be validated inside the first conversion that touched a project's config anyway, and if it bent, superseded rather than edited.
Rejected: Moving env declarations (labels, counters, anchors, static destinations) into `gas-project.json` as ADR-0002's content list literally said. They were already in each project's committed JS config module and had never been in `local.settings.json`, so none of them was drifting per machine — doing it would have satisfied the list while curing nothing, and left gas-deploy and gas-static each carrying two declaration mechanisms. Also rejected for this stage: a managed sparse host checkout that would delete `staticRepoPath` entirely (filed as `GAS-Core-bsi`, blocked on this stage) — it touches the publish path that `rm -rf`s directories, which does not belong inside a conversion.
Outcome [developer-facing]: RCV's `tools/build-static-pages.js` (161 lines) and `tools/publish-static-pages.js` (136) deleted, replaced by a `tools/static-pages.js` that is pure config. Converted to Mode A per adr/0001 — `script/version.js` gained a generated `BUILD_INFO` literal beside its existing consts and `resolveBeforeStamp: true`, so the page's backend URL is the `/exec` of the deployment this run resolved instead of a `local.settings.json` deployment ID reconciled against nothing. Theme, theme-fonts and dev-contact went through gas-static's generic `placeholders` with no package change, including two tokens that are not `var … = null;` declarations. `smokeTestStaticApi.js` step 11 removed as subsumed by `assertPublishedBuild`. Verified by a full SIT deploy, both gates green (v0.1.6.5, 8 propagation polls) and all 18 smoke steps passing.
Outcome [developer-facing]: gas-deploy v1.4.0 — new `lib/project.js` reads a committed `gas-project.json`, resolving `scriptId`/`sheetId` from it and falling back to the legacy `*Key` indirection. All three disagreement directions fail or warn by name, which is the loader obligation S14's handoff left open: a declared env with no secret throws before anything shells out; a target missing from a declared `envs` block throws listing what is declared; a fact in both files takes the committed value and warns which stale key to delete. 10 new tests, 86 pre-existing passing unchanged.
Outcome [internal]: adr/0004 supersedes adr/0002, narrowing the committed half from "declarations" to "per-env identifiers of external resources". `adr-quality-check` run, all five steps pass; 0002's Context/Decision/Consequences are byte-untouched. `GAS-Core-9iu`, `-8w0` and `-hl5` re-amended against 0004, each to its own concern. `measure-first-paint.js` elevated from PracticeMix into `best-practices/gas-static-frontend/` and generalised at its second consumer (F14's deferred half) — the ready selector and both URLs become arguments.

### Key Learnings:
An ADR's content list and its rationale can point at different files, and only a real migration surfaces it. ADR-0002 named the failure precisely — "project constants are re-entered on every machine, are never reviewed, and drift silently between developers" — then listed contents that were already committed and reviewable and had never drifted. The facts that actually matched its own rationale (three scriptIds, three sheetIds) were not on the list at all. Validating a config shape against one real project before migrating five is what caught it; the cost of skipping that step would have been five repos restructured around a distinction that cures nothing.

A second, sharper form of the same lesson: the boundary test that survives is "what kind of fact is this", not "who reads it". RCV's static host URL had three copies, and the third lives in a GAS script file that cannot `require()` the other two — so no JS module could ever have been their single source, and the fact had to move to JSON for reasons that have nothing to do with reviewability. Recognising it as an *identifier of an external resource*, the same category as `scriptId`, is what let one rule cover both.
