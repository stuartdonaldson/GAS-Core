#!/usr/bin/env python3
"""
axiom_report.py — Reusable base for a repo's COOKED Axiom report.

`query_axiom.py` answers "what events happened". A cooked report answers "what
did people and the system actually DO" — it classifies raw events into named
activities, joins events that belong to the same execution, collapses a burst of
related activities by one actor into a single session line, and surfaces the
handful of things a human should look at ahead of everything else.

THIS FILE IS A GAS-CORE STANDARD. Copy it verbatim; put nothing repo-specific in
it. A repo writes ONE small module — conventionally `tools/activity_log.py` —
that supplies a ReportSpec and calls `run(spec)`. See `activity_log.example.py`
next to this file for a worked example, and F3Go30's `tools/activity_log.py` for
the production original this was generalized from.

What a repo supplies (ReportSpec):

    classify(event, ctx) -> Activity | None
        The whole report. One raw flattened event in; one Activity out, or None
        for "not a tracked activity". THIS IS WHERE ALL PROJECT KNOWLEDGE LIVES:
        which event names matter, which payload fields to read, and how to phrase
        the line for a human. Name the real emitter field names — never guess
        them; read the call site.

    indexes  (optional)
        {name: fn(events) -> dict}. Cross-event joins built over the WHOLE raw
        result set before classification, reachable as ctx.indexes[name]. This is
        how a report recovers a fact that lives on a *different* event of the
        same execution (correlate by `op`, or by whatever id the emitter stamps)
        — e.g. "which front end opened the request that produced this identify
        event". Events that only exist to be joined against are never themselves
        reported as activities.

    alert_labels (optional)
        Labels surfaced in a leading section, ahead of the --limit truncation,
        because they are what a human should look at first: errors, give-ups,
        failed sends. A label that always means "the system healed itself" does
        NOT belong here.

    session_gap_seconds (optional, default 300)
        Activities with group=SESSION, the same actor, and within this many
        seconds of each other collapse onto one line. Set to 0 to disable.

Invariant worth preserving in any repo's classify(): a cooked report reads the
LOG, so it can only report what the emitter actually stamps. When a line you want
is not expressible, the fix is a new field on the emitter, not an inference in
this layer. Mark any inference you do make (F3Go30's original prefixes an
inferred actor with '~' so a reader can see it is a guess).
"""
import argparse
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from query_axiom import (  # noqa: E402  (sibling module, added to sys.path by the caller)
    _load_settings,
    _parse_duration,
    build_parser,
    env_predicate,
    flatten_event,
    query,
    resolve_credentials,
)

SESSION = "session"
STANDALONE = "standalone"

DEFAULT_SESSION_GAP_SECONDS = 300


@dataclass
class Activity:
    """One classified, human-readable thing that happened.

    ts       epoch seconds, for ordering and session grouping (None if unparseable)
    ts_str   pre-formatted local timestamp for display
    label    short ALL-CAPS kind, e.g. 'CHECKIN', 'SERVER ERROR' — also what
             alert_labels matches against
    actor    session grouping key (a person, a tenant, a document). None for
             activities that belong to nobody in particular.
    detail   the sentence a human reads
    group    SESSION (may be collapsed with adjacent same-actor activities) or
             STANDALONE (always its own line)
    """
    ts: float | None
    ts_str: str
    label: str
    detail: str
    actor: str | None = None
    group: str = STANDALONE


@dataclass
class ReportContext:
    """Passed to classify(). `indexes` holds whatever ReportSpec.indexes built."""
    indexes: dict = field(default_factory=dict)
    args: argparse.Namespace | None = None


@dataclass
class ReportSpec:
    classify: Callable[[dict, ReportContext], Activity | None]
    title: str = "activity"
    indexes: dict = field(default_factory=dict)
    alert_labels: set = field(default_factory=set)
    session_gap_seconds: int = DEFAULT_SESSION_GAP_SECONDS
    # Raw events fetched per requested output line. A cooked report drops most
    # events (joins, untracked names), so fetching 1:1 with --limit would
    # under-fill the report; 3x is the ratio the original settled on.
    fetch_multiplier: int = 3
    add_arguments: Callable[[argparse.ArgumentParser], None] | None = None


def fmt_time(iso_str: str) -> str:
    try:
        dt_utc = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
        return dt_utc.astimezone().strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, AttributeError):
        return str(iso_str)


def parse_epoch(iso_str: str) -> float | None:
    try:
        return datetime.fromisoformat(str(iso_str).replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def activity(event: dict, label: str, detail: str, *, actor: str | None = None,
             group: str = STANDALONE) -> Activity:
    """Build an Activity from a flattened event, handling both timestamp forms."""
    ts_iso = event.get("_time", "")
    return Activity(ts=parse_epoch(ts_iso), ts_str=fmt_time(ts_iso),
                    label=label, detail=detail, actor=actor, group=group)


def _format_tag(label: str) -> str:
    return f"[{label}]".ljust(18)


def group_sessions(activities: list, gap_seconds: int) -> list:
    """Collapse consecutive same-actor SESSION activities into one line each.

    `activities` must already be in chronological order. STANDALONE activities
    always get their own line.
    """
    lines = []
    pending = None

    def flush():
        nonlocal pending
        if pending is None:
            return
        who = pending["actor"] or "?"
        if len(pending["details"]) == 1:
            lines.append(f"{pending['ts_str']}  {_format_tag(pending['labels'][0])} {who}: {pending['details'][0]}")
        else:
            lines.append(f"{pending['ts_str']}  {_format_tag('SESSION')} {who}: " + " → ".join(pending["details"]))
        pending = None

    for act in activities:
        if act.group != SESSION or gap_seconds <= 0:
            flush()
            lines.append(f"{act.ts_str}  {_format_tag(act.label)} {act.detail}")
            continue
        key = (act.actor or "").strip().lower()
        same = (pending is not None and pending["key"] == key and act.ts is not None
                and pending["last_ts"] is not None
                and act.ts - pending["last_ts"] <= gap_seconds)
        if same:
            pending["labels"].append(act.label)
            pending["details"].append(act.detail)
            pending["last_ts"] = act.ts
        else:
            flush()
            pending = {"key": key, "actor": act.actor, "ts_str": act.ts_str,
                       "last_ts": act.ts, "labels": [act.label], "details": [act.detail]}
    flush()
    return lines


def collect(spec: ReportSpec, matches: list, args: argparse.Namespace) -> list:
    """Raw Axiom matches -> chronological list of Activity. Importable for tests."""
    events = [flatten_event(m) for m in matches]
    ctx = ReportContext(indexes={n: fn(events) for n, fn in spec.indexes.items()}, args=args)
    activities = [a for a in (spec.classify(e, ctx) for e in events) if a]
    activities.reverse()  # Axiom returns newest-first; read oldest-first
    return activities


def render(spec: ReportSpec, activities: list, args: argparse.Namespace) -> None:
    scope = f", env={args.env}" if getattr(args, "env", None) else ""
    alerts = [a for a in activities if a.label in spec.alert_labels]
    if spec.alert_labels:
        if alerts:
            print(f"\n{len(alerts)} item(s) to investigate, {args.since} lookback{scope}")
            print("-" * 96)
            for a in alerts:
                print(f"{a.ts_str}  {_format_tag(a.label)} {a.detail}")
            print("-" * 96)
        else:
            print(f"\nNothing to investigate in the {args.since} lookback{scope}.")

    lines = group_sessions(activities, spec.session_gap_seconds)[:args.limit]
    print(f"\n{len(lines)} {spec.title} lines, {args.since} lookback{scope}")
    print("=" * 96)
    for line in lines:
        print(line)
    print("=" * 96)


def run(spec: ReportSpec, argv: list | None = None) -> int:
    """Entry point a repo's report module calls from its own __main__ guard."""
    parser = build_parser(spec.classify.__doc__ or spec.title)
    parser.description = (sys.modules["__main__"].__doc__ or spec.title)
    if spec.add_arguments:
        spec.add_arguments(parser)
    args = parser.parse_args(argv)

    settings = _load_settings()
    dataset, token = resolve_credentials(settings)
    extra_where = [env_predicate(args.env, settings)] if args.env else []

    result = query(dataset, token,
                   limit=args.limit * spec.fetch_multiplier,
                   since=_parse_duration(args.since),
                   extra_where=extra_where)
    activities = collect(spec, result.get("matches", []), args)
    render(spec, activities, args)
    return 0
