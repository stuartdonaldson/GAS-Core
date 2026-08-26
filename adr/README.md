# GAS-Core Architecture Decision Records

Durable decisions about **the code GAS-Core ships** — the packages under `packages/`, the GAS-side
libraries under `libs/`, and the contracts they impose on the repos that consume them.

## Scope rule

Three kinds of document carry decision-shaped content in this estate, and they are not
interchangeable:

| Document | Records | Test |
|---|---|---|
| **A GAS-Core ADR** (this folder) | a choice that constrains code GAS-Core ships | would a consumer's behaviour change if this were reversed? |
| **A best-practice README** (`best-practices/*/README.md`) | a pattern a project *may* adopt | is it advice a project is free to decline? |
| **A project ADR** (that project's own `adr/`) | what one project chose for itself | does it depend on that project's data, threat model, or users? |

Worked examples:

- "`webappUrl.from` supports `buildInfo` only" → **GAS-Core ADR** ([0001](0001-webapp-url-from-build-info-only.md)) — it constrains every consumer of `gas-static`.
- "One config file or two" → **GAS-Core ADR** ([0002](0002-declared-config-two-files.md)) — five repos change behaviour on it.
- "If the content is link-shared, the client can read it directly with an API key" → **best-practice README** — a pattern, adopted per project.
- "PracticeMix reads Drive files directly by ID" → **PracticeMix ADR** — the assumption is about that folder's sharing and that app's threat model.

`bd remember` stays for working insight that is not a decision. An ADR is for a choice a future
reader must not silently reverse.

## Format

`000N-slug.md`, matching the convention already used in the consumer repos (PracticeMix's `adr/`):

```
# ADR-000N: Title

Status: Accepted | Proposed | Superseded
Date: YYYY-MM-DD
Supersedes: [None — new decision] | [ADR-000M](000M-slug.md)

## Context
## Decision
## Consequences
```

## Rules

- **One decision per ADR.** Bundled choices become untraceable the moment one of them is revisited.
- **Accepted ADRs are never edited — they are superseded.** A new ADR with `Supersedes:` pointing
  at the old one; the old one gains `Superseded by:` and nothing else changes.
- Run the `adr-quality-check` skill before committing any new or modified ADR.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-webapp-url-from-build-info-only.md) | `gas-static` resolves the web-app URL from `BUILD_INFO` only | Accepted |
| [0002](0002-declared-config-two-files.md) | Declared configuration lives in two files, not one | Superseded by [0004](0004-project-truth-is-identifiers-not-declarations.md) |
| [0003](0003-publish-ownership-manifest.md) | A static-host repo declares who publishes what, and `gas-static` validates against it | Accepted |
| [0004](0004-project-truth-is-identifiers-not-declarations.md) | The committed config file holds per-env identifiers, not env declarations | Accepted |
