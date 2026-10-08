# Container/collection domain objects (the `I13` type-leak gap)

`GAS-Core-kto`, follow-on from `GAS-Core-o4k`. Sits alongside
[`../README.md#platform-boundary-ownership-i13-in-gas`](../README.md#platform-boundary-ownership-i13-in-gas),
which confines platform **identifiers**. This section documents the companion pattern for
platform **types**, which identifier confinement alone does not close.

## The gap

`I13` as ratified 2026-09-14 says a boundary's identifier is named only inside its owning
module, and its done-means is a grep for the (boundary, operation) pair returning one module.
That is necessary but not sufficient. A module can name `SpreadsheetApp` in exactly one file and
still hand back a raw GAS `Sheet` object to every caller — the identifier is confined, the *type*
is not, and the grep stays clean while the platform's shape propagates through the codebase
anyway.

Worked example (not GAS-Core's own code — cited because it is the clearest real instance):
`../../NDocs/src/SheetAdapter.js:33`'s `SheetAdapter_sheet()` is documented as "the only file
naming `SpreadsheetApp`" and passes the `I13` grep. It returns a bare `Sheet`
(`@returns {Sheet}`). `../../NDocs/src/TeamRepo.js:34` holds that `Sheet` in a local variable
(`var sheet = SheetAdapter_sheet(...)`) and calls `.getLastColumn()` / `.getRange()` on it
directly. `SpreadsheetApp` is confined to one file; the *Sheet type* is not — it sits in a
repository module two layers away from the adapter.

## The two-tier model

**a. Operations with no addressable instance are thin domain functions in one shim module.**
A UUID mint, a clock read, a log write — nothing here names an *instance* of anything, so there
is nothing to wrap. The shim is domain-named, never a re-export: `newOpId()` is the pattern;
`GasGlobals.getUuid()` is not. A rename buys nothing — it reproduces the
inventory-in-name-only failure `I13`'s ownership form was chosen over the filename form to avoid,
just at smaller scale.

**b. Resources with addressable instances are modelled as domain objects.** The driving
criterion is multiplicity, not complexity and not lifecycle. A spreadsheet and a sheet within it
are a **container** and a **collection** — the same shape a database and a table have. Model
that pair as your own types, so the backend can be Sheets, a SQL database, or a filesystem
without the call sites changing.

GAS-Core already has a conforming instance of this shape: `../../libs/LibSheets/libSheets.js`'s
`SpreadsheetManager` (container) and `ManagedSheet` (collection). `ManagedSheet` never leaks a
raw `Sheet`; `openOrCreateSheet()` / `openExistingSheet()` return a `ManagedSheet`, and every
caller operates through its domain-shaped methods (`appendRow`, `getAllRows`, ...). That is what
NDocs' `SheetAdapter_sheet()` would need to become to close its gap: a handle type of its own,
not the SDK's `Sheet`.

## The migration argument

This is the reason the pattern earns its cost, stated explicitly because it is easy to miss.

Addressing a collection by bare name — `SheetTable_all('Teams')` — looks decoupled and passes an
identifier-based grep. It silently encodes a Sheets topology anyway: exactly one implicit
container, collections uniquely named within it. The identifier is decoupled; the *shape* is
hardcoded. A container handle (`db.table('Teams')`) survives a second container appearing later;
a bare name does not — there is nowhere to say *which* container. This failure mode is silent by
construction: the code stays grep-clean under `I13`'s identifier test while the one-container
assumption hardens underneath it. Name it when reviewing a boundary module, because the grep
will never surface it.

## The handle's surface must be domain-shaped

This is the rule that keeps the pattern from degenerating into a rename with extra steps.
`table.append(record)` is the pattern. `handle.getRange(a, b).setValues(v)` is a pass-through
wrapper that has achieved nothing — its methods mirror the SDK's methods one for one, so every
call site still has to know the SDK's shape to use it correctly; only the identifier moved. A
domain handle earns its keep by expressing what the caller means (`append`, `findById`,
`allRows`), not by re-exporting what the platform means (`getRange`, `setValues`). `ManagedSheet`
passes this test; a hypothetical `SheetHandle` with `.getRange()`/`.setValues()` methods would
not.

## The testability consequence

A domain handle is easier to fake than a raw SDK object, and the fake cannot drift from the
platform's actual behavior — because it never claimed to model that behavior in the first place.
A fake `Sheet` has to reproduce Google's real semantics (`getRange(row, col, numRows, numCols)`
indexing, `getValues()` shape, `insertSheet` behavior on collision, ...) closely enough that
tests stay meaningful, and every gap between the fake and the real platform is a latent bug the
tests cannot see. A fake domain handle only has to satisfy the four or five methods the domain
actually calls.

Concrete case: `../../NDocs/tests/gas/gas-harness.js`'s `makeSheetsStub()` (lines ~28-64) is an
in-memory `SpreadsheetApp`/`Sheet` stand-in that reimplements `getRange().getValues()`,
`getRange().setValues()`, `appendRow`, `getLastRow`, `getLastColumn`, and `getSheetByName` /
`insertSheet` — six platform methods with real Google indexing semantics, built to emulate
Google's own shape closely enough to be trustworthy. Against a domain handle
(`TeamTable`/`SheetTable` in the container/collection shape), the harness would fake its own four
or five domain methods instead (e.g. `append`, `allRows`, `findById`) and would owe Google's
`Sheet` semantics nothing.

**This does not change `T14`.** A real-boundary conformance test is still owed by the module that
owns the crossing, whichever shape its return value takes. The domain handle changes what the
*layer above* the boundary has to fake to be tested off-platform; it does not touch the boundary
module's own obligation to prove a real crossing at least once.

## Scope note

This document establishes the pattern and (separately, see `../../knowledge-base/proposals/`)
drafts an `I13` amendment. It does not audit or refactor GAS-Core's own modules against the
pattern — see `GAS-Core-kto`'s AC6 findings, recorded in the bead and in the amendment draft, for
what a first-pass audit turned up. Fixing them is a separate decision.
