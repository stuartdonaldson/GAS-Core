#!/usr/bin/env python3
"""
activity_log.py — Cooked activity report for <PROJECT>.

COPY THIS FILE to `tools/activity_log.py` in your repo and rewrite `classify()`
for your own events. Everything below the imports is an EXAMPLE, not a standard:
`axiom_report.py` and `query_axiom.py` are the standard, and they are copied
verbatim. This file is where all project knowledge lives.

Usage:
    python tools/activity_log.py [--limit N] [--since DURATION] [--env sit|prod]

Rules of thumb, learned from F3Go30's production original:

  - Name the REAL emitter fields. Open the GAS call site and read what it
    stamps; a guessed field name silently produces a report of '?'.
  - Document, in this docstring, what the report CANNOT say and why — e.g. a
    field deliberately not logged under the PII rule. A future reader will
    otherwise assume a gap is a bug.
  - Only join events you can join honestly. Correlate by the id the emitter
    stamps (`op` / `parentOp`); if two things happen in separate executions with
    no shared id, say the attribution is inferred (prefix '~') rather than
    presenting a guess as fact.
  - Alert labels are for things a human must act on. "The client retried and
    recovered" is not one of them.
  - Drop routine noise. One failed poll tick every 10s during an outage is
    expected; only the give-up point is a line worth printing.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from axiom_report import SESSION, ReportSpec, activity, run  # noqa: E402


def _op_index(events: list) -> dict:
    """op id -> facts scattered across OTHER events of the same execution.

    The join layer. An event often cannot describe itself completely: the
    request that opened the execution knows which front end called, the handler
    that ran knows what it decided. Correlate them by `op` (stamped by
    GasLogger.startOp on every entry of one execution) and the report can say
    both in one line.
    """
    index = {}
    for event in events:
        op = event.get("op")
        if not op:
            continue
        entry = index.setdefault(op, {})
        if event.get("name") == "request.received":
            entry["route"] = event.get("route")
    return index


def classify(event, ctx):
    """One flattened Axiom event -> an Activity, or None if it is not tracked."""
    name = event.get("name", "")

    # A tracked user action. group=SESSION means consecutive activities by the
    # same actor collapse onto one line, which is what turns "8 disconnected
    # events" into "one person did this, then this, then this".
    if name == "sync.complete":
        who = event.get("eu") or "?"
        route = ctx.indexes["by_op"].get(event.get("op"), {}).get("route", "unknown route")
        return activity(event, "SYNC", f"synced {event.get('changesCount', 0)} change(s) via {route}",
                        actor=who, group=SESSION)

    # A system action that belongs to nobody — always its own line.
    if name == "archive.swept":
        return activity(event, "ARCHIVE", f"archived {event.get('rowCount', '?')} row(s)")

    # Every server-side caught exception. GasLogger.run()'s catch-all uses the
    # tag 'error'; hand-rolled dispatcher catches use '<site>.error'. Both go
    # through logError(), so the payload carries errorName/errorKeyword and
    # never the exception's own message text.
    if name == "error" or name.endswith(".error"):
        detail = f"{name}: {event.get('errorKeyword', '?')} ({event.get('errorName', 'Error')})"
        return activity(event, "SERVER ERROR", detail)

    return None


SPEC = ReportSpec(
    classify=classify,
    title="activity",
    indexes={"by_op": _op_index},
    alert_labels={"SERVER ERROR"},
)

if __name__ == "__main__":
    sys.exit(run(SPEC))
