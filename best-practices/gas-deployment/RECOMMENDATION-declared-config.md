# Proposal — `libs/LibAdmin`: the admin gate as a declared option

**Status:** proposed (2026-08-22), reduced to its remaining live content 2026-08-25 (PLAN2 S12).
**Bead:** `GAS-Core-hl5` — this document is that bead's design input.
**Scope:** the GAS-side operator-secret gate copied into five projects.

> **What used to be here, and where it went.** This file began as the wider *declared
> configuration* recommendation. Everything in it that was true independently of `LibAdmin` has
> been graduated into permanent homes and removed:
>
> | Was | Now |
> |---|---|
> | §2 the two orthogonal auth axes | [`README.md`](README.md) §"Two orthogonal auth axes — decide each separately" |
> | §3 anchor declared / deployment ID cached, and why the cache stays | [`../../packages/gas-deploy/README.md`](../../packages/gas-deploy/README.md) §"Deployment description & the anchor" |
> | §5 canonical `local.settings.json` keys + the two rules | [`../../packages/gas-deploy/README.md`](../../packages/gas-deploy/README.md) §"Canonical keys", and `packages/gas-deploy/local.settings.example.json` |
> | §6 one config file or two | **decided** — [`adr/0002`](../../adr/0002-declared-config-two-files.md): two files |
> | §1 the problem statement, §7 scope | spent; git history holds them |
>
> What remains below is a design for code that does not exist yet, which belongs on the bead
> rather than in a README. It is kept as a file only until `GAS-Core-hl5` is picked up.

## The problem in one paragraph

`gas-deploy`'s Node half has one `buildPayload` and so has little room to diverge. The **server**
side is copied per project and the copies have separated — five variants of one security check,
each header saying "mirrors F3Go30's". That is the same signature as a copy-pasted
`Assertion_verify`: a fail-open divergence in one copy is silent. Worse,
[`../gas-webapp-admin/Admin.js`](../gas-webapp-admin/README.md) is itself described as "a copy of
NUUC-Dispatch's (the most current)" — the folder ships a **copy-me file**, which is a drift source
rather than a drift fix. Related open beads: `GAS-Core-9iu` (declared configuration),
`GAS-Core-8w0` (make the admin secret a declared option, not an omission).

---

## 1. The gate is already optional — but only by omission

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

## 2. Where the drift actually is — the five server-side copies

| Project | Secret property | Ungated before the gate | Notes |
|---|---|---|---|
| F3Go30, NUUC-Dispatch | `ADMIN_SHARED_SECRET` | `bootstrapSecret` | 16-char minimum, `already_bootstrapped` refusal |
| RankChoiceVoting | `ADMIN_SHARED_SECRET` | `bootstrapSecret`, **`setWebappUrl`** | the extra exemption exists for a real reason — see §4 |
| PracticeMix | `ADMIN_SHARED_SECRET` | via `adminDispatch_(payload, makeAdminContext_())` | restructured for injected-context testability; own response helper |
| GActionSheet | `WEBAPP_SECRET` + `TEST_TOKEN` + `ADMIN_SECRET` | GIS-verified routes bypass by design | three concurrent gates with a documented checking order |

## 3. `libs/LibAdmin` — one gate, declared exemptions

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

## 4. Avoiding the deadlock — why `ungatedActions` must be declared, not hardcoded

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

## 5. Keeping the two halves in agreement

The ungated list exists on both sides — Node (`ungatedActions`, deciding whether to attach the
secret) and GAS (deciding whether to demand it). Declaring it once in project config fixes the Node
half; the GAS half reads its own copy and can still drift. Cheap guard: a `getAdminContract`
diagnostic action returning the server's ungated list and auth-field name, which the caller can
compare against its own declaration. Optional, but it converts a silent mismatch into a one-line
check.

---
