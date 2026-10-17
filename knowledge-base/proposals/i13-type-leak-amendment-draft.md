# DRAFT — proposed amendment to `I13`, awaiting owner ruling

**Status: DRAFT, NOT APPLIED. Do not edit `$DEVSTANDARD` from this file.**

Filed by `GAS-Core-kto` (2026-09-14), follow-on from `GAS-Core-o4k`. This is a proposal only. The
target file is `$DEVSTANDARD/test-framework/sdlc-implementation-principles.md`
(`/mnt/c/dev/DevStandard/test-framework/sdlc-implementation-principles.md`), which is a shared
normative document and had one amendment already land today (`I13` itself, `GAS-Core-o4k`). This
would be the second same-day amendment, which is exactly why it stops here instead of applying.

## The gap this closes

`I13` as ratified confines the boundary's **identifier** to one owning module and states its
done-means as a grep for the (boundary, operation) pair. That test passes a module that is the
sole owner of `SpreadsheetApp` and still returns a raw `Sheet` object to every caller — the
identifier is confined, the platform *type* is not, and the grep gives a false clean bill while
the platform's shape (and, per the container/collection migration argument documented in
`../../best-practices/gas-domain-objects/README.md`, its topology) leaks through the codebase.
Worked example: `../../../NDocs/src/SheetAdapter.js:33` (sole owner of `SpreadsheetApp`, `I13`-
clean) returns a bare `Sheet`; `../../../NDocs/src/TeamRepo.js:34` holds it in a variable and
calls SDK methods on it directly, two layers from the adapter.

## Current `I13` text (verbatim, for diff)

> ### I13 — Platform-boundary ownership
> Every external platform boundary — a vendor SDK, a runtime global, a hosted service client —
> has exactly one owning module, and the boundary's identifier is named only inside it.
> Near-neighbors: I6 states this for contract shapes, I12 for logic shapes; I13 extends it to
> platform boundaries.
>
> Rationale: it is what makes T14 auditable. T14's obligation attaches to a boundary
> *operation*; if the identifier is named across nine modules the operation set cannot be
> enumerated, so whether the obligation is discharged cannot be determined. With one owning
> module the operation set is that module's exported surface. Secondarily, the layer above the
> owner becomes runnable off-platform, which is what T12 focused helper tests require.
>
> Constraints that change behavior:
>
> - **The owned unit is the (boundary, operation) pair, not the SDK identifier.** ...
> - **Configuration a module reads to reach its own boundary belongs to that boundary.** ...
> - **Ownership is the test, not the filename.** ...
> - **The seam does not discharge T14.** ...
> - **Injection at the owner is preferred to a hard reference, where the platform permits it.** ...
> - **Exempt: single-file programs, illustrative examples, harnesses, demos, and test code.** ...
>
> Done means: for each (boundary, operation) pair the project touches, a grep for it returns
> exactly one production module, or a declared exemption.

(Five constraints elided above with `...` where unchanged — full text at
`$DEVSTANDARD/test-framework/sdlc-implementation-principles.md:78-92`.)

## Proposed wording (new opening sentence + one new constraint + revised done-means)

**Opening sentence — change:**

> Every external platform boundary — a vendor SDK, a runtime global, a hosted service client —
> has exactly one owning module, and the boundary's identifier is named only inside it.

→

> Every external platform boundary — a vendor SDK, a runtime global, a hosted service client —
> has exactly one owning module. The boundary's identifier is named only inside it, **and any
> value the boundary hands back that represents an addressable platform instance is wrapped in
> the owner's own type before it leaves the module.**

**New constraint, inserted after "Ownership is the test, not the filename," before "The seam does
not discharge T14":**

> - **A confined identifier does not confine the identifier's type.** Naming the boundary in one
>   module governs where the SDK is *invoked*; it says nothing about what that module *returns*.
>   A resource with an addressable instance — a spreadsheet and a sheet within it, a bucket and an
>   object within it — is a container and a collection. Model that pair as the owner's own domain
>   types; a caller holding the platform's own type for such a resource is holding a boundary leak
>   regardless of how confined the identifier that produced it was. Operations with no addressable
>   instance (a UUID mint, a clock read) have nothing to wrap and are unaffected. A handle's
>   surface must be domain-shaped (what the caller means), not a rename of the SDK's own methods
>   (what the platform means) — a wrapper whose methods mirror the SDK's achieves nothing.

**Done-means — change:**

> Done means: for each (boundary, operation) pair the project touches, a grep for it returns
> exactly one production module, or a declared exemption.

→

> Done means: for each (boundary, operation) pair the project touches, a grep for it returns
> exactly one production module, or a declared exemption — **and, for any operation that returns
> an addressable platform instance, that module's exported surface names no platform type; any
> handle it returns is a type the owner itself defines.**

## Why this shape and not another

- Extends the existing constraint list rather than replacing the identifier rule — the identifier
  rule is correct and load-bearing as far as it goes (`GAS-Core-o4k`'s audit and the
  (boundary, operation) / connection-parameter clauses stay exactly as ratified).
- States the new rule as **type confinement**, mirroring how the existing rule states
  **identifier confinement**, so the two read as one principle with two coordinates rather than
  a bolt-on.
- Does not touch `T14`: a real-boundary conformance test is still owed by the owning module
  regardless of what shape its return value takes. `../../best-practices/gas-domain-objects/README.md`
  states this explicitly so the amendment doesn't need to.
- Leaves the exemption clause (single-file/illustrative/harness/demo/test) untouched — it already
  covers the one GAS-Core case (`examples/demo-harness/harness.js:90`, `Harness.getSheet()`
  returns a raw `Sheet`) this amendment would otherwise flag; see AC6 findings below.

## AC6 findings (GAS-Core audit — listed, not fixed, per this bead's scope)

Audited by (boundary, operation) contract, not bare SDK identifier (the o4k audit hole applies
here too — a bare-identifier grep both over- and under-reports). One finding:

- `examples/demo-harness/harness.js:90` — `Harness.getSheet()` is documented `@returns {Sheet}`
  and returns the raw GAS `Sheet` (or `Spreadsheet`, for the no-`sheetName` path) directly to
  every demo function that calls it. Already covered by `I13`'s existing exemption (harness code,
  not a production layer — see `best-practices/README.md`'s disposition table), so this finding
  changes no disposition; it is recorded because the amendment's done-means would otherwise need
  to say so explicitly.

No other GAS-Core module (`GasLogger.js`, `AxiomLogger.js`, `Admin.js`, `libSheets.js`,
`NotificationSBCode.js`) returns a raw platform object across its public surface —
`libSheets.js`'s `SpreadsheetManager`/`ManagedSheet` already conform to the proposed rule, and
`GasLogger.js`'s `_getFolder()` (a raw `Folder`) is a private closure function, never part of the
module's returned public object.

## What happens next

This file is inert until the owner rules on it. On approval, the edit lands in
`$DEVSTANDARD/test-framework/sdlc-implementation-principles.md` (not by this bead), and
`best-practices/gas-domain-objects/README.md` gets a citation line pointing at the ratified `I13`
text the way the existing platform-boundary-ownership section does. On decline or revision, this
file is updated or superseded in place — it is a draft, not an ADR, so it carries no immutability
obligation until something is actually ratified.
