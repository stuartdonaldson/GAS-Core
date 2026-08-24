# Recommendation — declared configuration: environment identity and the admin gate

**Status:** proposed (2026-08-22)
**Scope:** the configuration surface shared by `gas-deploy`'s consumers — F3Go30,
RankChoiceVoting, GActionSheet, NUUC-Dispatch, PracticeMix.
**Relationship to [`RECOMMENDATION.md`](RECOMMENDATION.md):** that document is complete and
explicitly has no Stage 6. This is the separate follow-on it asks for. It changes no deploy
mechanics; it decides **where each fact is declared, who supplies it, and which parts are
optional**.

Companion: [`../gas-static-frontend/RECOMMENDATION.md`](../gas-static-frontend/RECOMMENDATION.md)
(the static pipeline) and [`../gas-webapp-admin/README.md`](../gas-webapp-admin/README.md) (the
GAS-side admin route this makes a declared option).

---

## 1. Problem

`gas-deploy` consolidated the *code*. The *configuration* is still spread across three surfaces
with no rule saying which holds what:

| Surface | Committed? | Holds today |
|---|---|---|
| `tools/manage-deployments.js` config object | yes | anchors, labels, counters, hooks |
| `tools/call-webapp.js` `envMap` | yes | anchors **again**, secret keys, ungated actions |
| `local.settings.json` | no (gitignored) | clasp auth, script/deployment IDs, secrets, repo paths, log dirs |

Two consequences, both observed:

**Project truth is hidden in a gitignored file, and developer truth is hardcoded in a committed
one.** The anchor (`TEST-WEB-APP`) is identical on every machine yet is written twice, by hand, in
two committed files. The deployment ID is *derived* — `lib/cli.js:202` writes it back after every
deploy — yet it sits in the hand-edited settings file alongside the secrets, which makes it look
like input.

**The developer-facing keys have drifted, for facts that are the same everywhere.** From the
survey of all five `local.settings.json` files:

| Fact | Names in use |
|---|---|
| static hosting repo checkout | `staticPagesRepoPath`, `nuucStaticPagesRepoPath`, `staticPortalRepoPath` |
| operator secret | `adminSecret`, `sitAdminSecret`/`prodAdminSecret`/`nuucAdminSecret`, `webappSecret` (+ `testToken`) |
| script project | `scriptId`, `testScriptId`/`templateScriptId`, `sitScriptId`/`prodScriptId`/`nuucScriptId` |
| server log location | `gasLogDir`, `GAS_LOGGER_LOCAL_PATH` (+ `GAS_LOGGER_PARENT_FOLDER_ID`, `GAS_LOGGER_PROJECT_PREFIX`) |
| container | `testSpreadsheetId`/`templateSpreadsheetId`, `nuucSheetId`, `testSheetId`/`testDocId` |

`local.settings.json` is a **developer-facing interface**. The same fact must not have a different
key in a different project — that is the whole cost of the drift, paid every time someone moves
between repos. (`axiomDataset`/`axiomToken`/`axiomQueryToken` are already uniform across four
projects and need no change — proof the convergence is achievable, not aspirational.)

And the GAS-side admin gate is copy-paste — five variants of one security check, detailed in §4.

---

## 2. Two orthogonal auth axes

Conflating these is why projects end up with the wrong one, or with neither:

| | **Axis 1 — operator secret** (`cmd=admin`) | **Axis 2 — visitor identity** (GIS / brokered assertion) |
|---|---|---|
| Answers | "is this call from the project's own tooling?" | "who is the human on the page?" |
| Held by | a developer's gitignored `local.settings.json` | the visitor's browser, verified server-side |
| Gates | Script Properties, diagnostics, maintenance | feature and data access in the app |
| Needed when | you want scriptable operator actions instead of clicking the editor UI | the web app is `ANYONE_ANONYMOUS` and does anything privileged |
| Implementation | [`../gas-webapp-admin/`](../gas-webapp-admin/README.md) + `gas-deploy`'s `authField`/`securedCmds` | [`../gas-static-frontend/`](../gas-static-frontend/README.md) §identity |

A project may need **neither, either, or both**. PracticeMix will need both. Each axis is declared
independently; neither is implied by adopting `gas-deploy`.

---

## 3. Environment identity: anchor declared, deployment ID cached

### The rule

| Value | Who supplies it | Where | Required |
|---|---|---|---|
| **anchor** (`TEST-WEB-APP`) | the developer, once, in the deployment's description when creating it | declared env config | **yes** — it is the environment's identity |
| **deployment ID** | the deploy, written back automatically (`lib/cli.js:202`) | the gitignored/cache half | **no** — populated on first deploy, never hand-entered |
| resolver order | the package | `settingsId → anchorMatch → soleActiveDeployment` | — |

The developer already performs exactly one irreducible manual step: create the deployment and type
a description. The anchor *is* that step's output, so it is the only environment fact that
genuinely belongs to a human. Everything else about the deployment is derivable from it.

### Why keep the cached ID at all

Not as a second declaration — as a fallback with three distinct jobs:

1. **The no-clasp-auth path.** `resolveEnvDeploymentId` tries the live deployment list and falls
   through to the stored value on any failure. Anchor matching *requires* `clasp deployments`:
   auth plus a network round trip. Without the cache, `node tools/call-webapp.js version` fails on
   a machine that has never run `clasp login`, and in CI.
2. **Deletion detection.** `settingsId` validates the cached ID against the live list and refuses
   loudly — *"is not among this script project's live deployments — it was deleted or
   recreated"*. An anchor-only project silently resolves the replacement instead. Sometimes that
   is correct; you should still be told.
3. **Cost.** `resolveFromLiveList: false` skips the `clasp deployments` call entirely — which is
   what lets a version poll run a dozen requests without a dozen clasp invocations.

The objection — two sources of truth for one fact — is already neutralised: the tool rewrites the
cache after every deploy, and validates it against the live list before trusting it.

### Both failure modes are already loud

`anchorMatch` refuses on **zero** matches and on **more than one**, naming every candidate.
`settingsId` refuses a vanished ID. Making the anchor primary trades away no detection.

### Migration is free

F3Go30 and RankChoiceVoting carry no anchors today (lineage B — one deployment per script project,
resolved by settings-ID or sole-active). Because `describeDeployment` rewrites the description as
`${anchor} v${version}` on **every** deploy, their next deploy resolves via the cached ID, writes
the anchored description, and anchor matching works from then on. No hand-edited descriptions, no
flag day. Anchoring them anyway is worth it purely to delete "which lineage is this project?" from
the config surface.

### Conventions this requires

- Anchors must not be substrings of one another — `WEB-APP` would match both targets. Use
  `<ENV>-WEB-APP`. `anchorMatch` catches a collision loudly rather than guessing, but the naming
  rule keeps it from arising.
- Deployment-archiving tooling must never strip or rewrite an anchored description (GActionSheet's
  already refuses: it filters out every deployment whose description contains a target anchor).
- The package still never creates a deployment. A new URL stays a deliberate human decision.

---

## 4. The admin gate as a declared option

### 4.1 It is already optional — but only by omission

`lib/webapp.js:buildPayload` is the seam:
`if (!authField || ungated.has(action) || !secret) return { action, ...extraBody };`. Omit
`secretKey` and no auth field is ever attached. A project can use `gas-deploy` end to end with no
secret at all.

Three gaps make that optionality accidental rather than declared:

1. **A missing secret is silent.** `secretKey` absent and `secretKey` present-but-unreadable are
   indistinguishable — both send an unauthenticated request, and you get `forbidden` back with no
   hint that the real cause is a typo in `local.settings.json`. RankChoiceVoting and PracticeMix
   each hand-rolled a better message locally. **Fix:** if the admin option is declared and the
   action is not ungated, a missing secret is a configuration error raised before the request.
2. **`cmd=version` must never carry the secret, and that is convention only.** It has to answer
   before any secret is bootstrapped and on an `ANYONE_ANONYMOUS` deployment. Every project routes
   it ahead of the gate server-side, but RankChoiceVoting omits `securedCmds`, so its *client*
   attaches `adminSecret` to `cmd=version` and `cmd=api` anyway. **Fix:** `version` is
   unconditionally ungated in the package, not per-project remembering.
3. **Naming drift** — `ADMIN_SHARED_SECRET` vs `WEBAPP_SECRET`; `authField` of `adminSecret` /
   `testToken` / `secret`. Keep it pluggable; declare a default.

### 4.2 The GAS side is where the real drift is

One `buildPayload` serves everyone, so the Node half has little room to diverge. The server-side
gate is copied per project, and the copies have separated:

| Project | Secret property | Ungated before the gate | Notes |
|---|---|---|---|
| F3Go30, NUUC-Dispatch | `ADMIN_SHARED_SECRET` | `bootstrapSecret` | 16-char minimum, `already_bootstrapped` refusal |
| RankChoiceVoting | `ADMIN_SHARED_SECRET` | `bootstrapSecret`, **`setWebappUrl`** | the extra exemption exists for a real reason — see §4.4 |
| PracticeMix | `ADMIN_SHARED_SECRET` | via `adminDispatch_(payload, makeAdminContext_())` | restructured for injected-context testability; own response helper |
| GActionSheet | `WEBAPP_SECRET` + `TEST_TOKEN` + `ADMIN_SECRET` | GIS-verified routes bypass by design | three concurrent gates with a documented checking order |

Every header says "mirrors F3Go30's" / "pattern derived from the sibling projects". This is the
same signature as `Assertion_verify` — a copy-pasted security check, where a fail-open divergence
in one copy is silent. `best-practices/gas-webapp-admin/Admin.js` is itself described as "a copy of
NUUC-Dispatch's (the most current)", i.e. the folder currently ships a **copy-me file**, which is a
drift source rather than a drift fix.

### 4.3 `libs/LibAdmin` — one gate, declared exemptions

Move the gate into a canonical GAS library beside `LibSheets`/`LibSidebar`; the best-practices
`Admin.js` becomes an *example consumer* rather than the master copy.

```js
function doPost(e) {
  if (e.parameter.cmd === 'version') return handleVersionRequest_();   // never reaches the gate
  if (e.parameter.cmd === 'admin') {
    return LibAdmin.handlePost(e, {
      // Declared, per project. This is what stops the fork.
      ungatedActions: ['bootstrapSecret', 'setWebappUrl'],
      handlers: {
        setScriptProperties: setScriptProperties_,
        getAuthInfo: getAuthInfo_,
      },
      // secretProperty: 'ADMIN_SHARED_SECRET',  // default
      // authField: 'adminSecret',               // default
    });
  }
  return jsonOutput_({ ok: false, error: 'unknown_cmd' });
}
```

Owned by the library, identically for everyone:

- `bootstrapSecret` — always ungated, set-once, minimum length enforced, `already_bootstrapped`
  refusal, never re-settable over the wire;
- the secret comparison itself, and **fail-closed by default**: an action that is neither ungated
  nor authenticated returns `forbidden`, never `unknown_action` (which would leak the action
  namespace to an unauthenticated caller);
- uniform `{ok, error}` responses at HTTP 200 (Apps Script cannot set meaningful status codes, so
  the body is the contract);
- logging that records the action name and never the secret.

### 4.4 Avoiding the deadlock

The exemptions exist because **gating them makes a fresh project undeployable**, and a library that
cannot express them would be forked on first contact:

- `bootstrapSecret` — chicken-and-egg: it is how the secret comes to exist.
- `setWebappUrl` (RankChoiceVoting) — stores the running deployment's *own* `/exec` URL, and is
  called by the deploy on every PROD push. On a fresh project no secret is bootstrapped yet, so
  gating it deadlocks the very first deploy's URL stamp.
- `cmd=version` — must answer before bootstrap and on an anonymous deployment, because deploy
  verification depends on it. Handled by never routing it through the gate at all, not by listing
  it as an exemption.

So `ungatedActions` is a **declared list**, not a hardcoded pair. The admission test for adding
one, which the library's docs must state: the action is **idempotent**, **non-sensitive** (returns
and stores nothing an attacker gains from), and **genuinely required before a secret can exist**.
`setWebappUrl` passes all three. Anything failing one belongs behind the gate.

GActionSheet's three-gate variant (`WEBAPP_SECRET` + `TEST_TOKEN` + `ADMIN_SECRET`, plus
GIS-verified bypass routes) will not fold in cleanly and should stay a **declared exception**, not
be forced into the library — but its `bootstrapSecret`/`version` handling should still match.

### 4.5 Keeping the two halves in agreement

The ungated list exists on both sides — Node (`ungatedActions`, deciding whether to attach the
secret) and GAS (deciding whether to demand it). Declaring it once in project config fixes the Node
half; the GAS half reads its own copy and can still drift. Cheap guard: a `getAdminContract`
diagnostic action returning the server's ungated list and auth-field name, which the caller can
compare against its own declaration. Optional, but it converts a silent mismatch into a one-line
check.

---

## 5. Canonical developer-facing keys

`local.settings.json` is a developer-facing interface: the same fact gets the same key in every
project. camelCase throughout (no `SCREAMING_CASE`).

| Fact | Canonical key | Replaces |
|---|---|---|
| clasp auth file | `claspAuth` | already uniform; a second Google account becomes a per-env override, not `nuucAuth` |
| script project | `scriptId` (per-env override when each env is its own script project) | `testScriptId`/`templateScriptId`, `sitScriptId`/`prodScriptId`/`nuucScriptId` |
| deployment (cache) | `deploymentId`, per env — written by the deploy | `testDeploymentId`, `sitDeploymentId`, `nuucDeploymentId`, … |
| operator secret | `adminSecret` (per-env when the envs are separate script projects) | `sitAdminSecret`/`prodAdminSecret`/`nuucAdminSecret`, `webappSecret` |
| static hosting repo | `staticRepoPath` (per-env override for a second host) | `staticPagesRepoPath`, `nuucStaticPagesRepoPath`, `staticPortalRepoPath` |
| server log directory | `gasLogDir` | `GAS_LOGGER_LOCAL_PATH` |
| server log Drive folder | `gasLogFolderId` | `GAS_LOGGER_PARENT_FOLDER_ID` |
| server log prefix | `gasLogPrefix` | `GAS_LOGGER_PROJECT_PREFIX` |
| container | `sheetId` / `docId`, per env | `testSpreadsheetId`/`templateSpreadsheetId`, `nuucSheetId`, `testSheetId`/`testDocId` |
| Axiom | `axiomDataset`, `axiomToken`, `axiomQueryToken` | **no change** — already uniform |

Two rules rather than a fixed key list:

1. **Env-scoping is structural, not a prefix.** A fact that varies per environment is written once
   per environment; a fact that is project-wide is written once. This removes the "does this
   project prefix or not?" question that produced `scriptId` vs `testScriptId` vs `sitScriptId` —
   and it stops a project whose two deployments share one script project from having to write the
   same `scriptId` twice.
2. **Project-specific keys are fine, as long as they don't restate a canonical concept.**
   PracticeMix's `initialFolderId` and GActionSheet's test-fixture doc IDs are legitimately local;
   a fourth spelling of "the static repo" is not.

`gas-deploy`'s existing `*Key` indirection (`scriptIdKey`, `deploymentIdKey`, `secretKey`) becomes a
**legacy override** for projects that have not migrated, not the normal way to configure a project.
Env-name aliases stay supported — F3Go30 calls its PROD target `template` — via `envAliases`.

---

## 6. Open decision

**One config file or two.** Everything above is agnostic to this; it needs settling before
implementation.

- **Two files** — a committed `gas-project.json` (envs, anchors, labels, counters, static
  destinations, the admin declaration and its ungated list) plus a gitignored `local.settings.json`
  (clasp auth, secrets, machine paths, and the deployment-ID cache). Project truth is reviewable in
  git; a typo'd anchor is caught in review rather than per machine; a new developer clones and
  supplies only secrets. Costs a new file and a migration.
- **One file** — everything stays in the gitignored `local.settings.json`, with anchors and static
  destinations added to each env block. Nothing new to learn, but project constants are re-entered
  on every machine and can drift silently between developers — the failure this document exists to
  remove.

Recommendation: two files. The whole argument of §3 is that the anchor is project truth, and
project truth should not live in a file git never sees.

---

## 7. Out of scope

- Deploy mechanics, resolver behaviour, stamper shapes — [`RECOMMENDATION.md`](RECOMMENDATION.md)
  is complete and closed.
- Migrating any project between lineage A and lineage B.
- GActionSheet's three-gate auth model, beyond aligning its `bootstrapSecret`/`version` handling.
- The static build/publish pipeline — [`../gas-static-frontend/RECOMMENDATION.md`](../gas-static-frontend/RECOMMENDATION.md).
