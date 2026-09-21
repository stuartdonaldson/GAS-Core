#!/usr/bin/env python3
"""
query_axiom.py — Query this repo's Axiom dataset without re-deriving the APL
request shape and auth every time.

THIS FILE IS A GAS-CORE STANDARD (best-practices/gas-server-logging/tools/).
Copy it into a repo verbatim; do not fork it. Everything repo-specific lives in
`local.settings.json` (gitignored). If you need a new *filter*, add it here and
push the change back to GAS-Core rather than editing one repo's copy — that
divergence is exactly what this file was published to stop.

Stdlib only, on purpose: it must run in any repo with a `python3` on PATH,
with or without a virtualenv activated.

Usage:
    python tools/query_axiom.py [--limit N] [--since DURATION]
                                [--env dev|sit|test|prod] [--side gas|python]
                                [--name SUBSTRING] [--where APL_EXPR]
                                [--raw [PATH]] [--json]

Examples:
    python tools/query_axiom.py                       # last 200 events, last 24h
    python tools/query_axiom.py --limit 50 --since 2h
    python tools/query_axiom.py --env prod --since 7d
    python tools/query_axiom.py --env sit --name sync.warn
    python tools/query_axiom.py --side python
    python tools/query_axiom.py --where "data.docId == '1AAE...'"
    python tools/query_axiom.py --raw /tmp/axiom_dump.json

DURATION accepts <N>s / <N>m / <N>h / <N>d (e.g. 30m, 2h, 1d). Default: 24h.

Configuration (`local.settings.json`, gitignored — see local.settings.example.json):

    "axiomDataset":    "<repo-name>"          # ONE DATASET PER REPO. See README
                                              # "Dataset Convention" — a shared
                                              # dataset silently drops new fields
                                              # once it hits Axiom's 257-field cap.
    "axiomToken":      "<INGEST token>"       # write-only; server-side only, set as
                                              # the AXIOM_TOKEN script property.
                                              # NEVER read by this tool.
    "axiomQueryToken": "<READ-ONLY token>"    # what this tool uses. A separate token
                                              # from the ingest one, by design: this
                                              # one lives on developer laptops.

    "axiomEnv": { ... }                       # OPTIONAL. Only needed by a repo whose
                                              # emitter does not yet stamp the
                                              # canonical `env` column — see
                                              # DEFAULT_ENV_CONFIG below.
"""
import argparse
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

_DURATION_RE = re.compile(r"^(\d+)([smhd])$")

# --- Environment discrimination -------------------------------------------------
#
# CANONICAL: the emitter (GasLogger.log) stamps a top-level `env` column on every
# row, whose value is BUILD_INFO.env, drawn from the vocabulary dev | test | prod.
# `--env sit` is an accepted synonym for `test` (SIT is the preferred spoken name
# for the same deployment target); both map to the same predicate.
#
# COMPATIBILITY: three pre-standard emitters are in the wild and disagree — one
# stamps env='production', another stamps a `target` column with TEST/TEMPLATE, a
# third stamps nothing at all. Rather than make `--env` lie, the mapping is data:
# a repo whose emitter has not yet been brought to the canonical shape declares
# its own field and value aliases under "axiomEnv" in local.settings.json, e.g.
#
#   "axiomEnv": {"field": "target", "values": {"sit": ["TEST"], "prod": ["TEMPLATE"]}}
#
# The defaults below already cover all three observed vocabularies for a repo that
# uses the canonical `env` field, so most repos need no "axiomEnv" block at all.
# This shim is a MIGRATION AFFORDANCE, not the standard: a repo that still needs a
# non-default `field` has an emitter to fix, and the README says so.
DEFAULT_ENV_CONFIG = {
    "field": "env",
    "values": {
        "dev": ["dev", "development", "DEV"],
        "test": ["test", "sit", "TEST", "SIT"],
        "sit": ["test", "sit", "TEST", "SIT"],
        "prod": ["prod", "production", "PROD", "PRODUCTION", "TEMPLATE"],
    },
}

ENV_CHOICES = ["dev", "test", "sit", "prod"]


def find_settings_path(start: pathlib.Path | None = None) -> pathlib.Path:
    """Nearest local.settings.json at or above `start` (default: this file's dir).

    Walking up rather than hardcoding `../local.settings.json` is what lets the
    same file work whether a repo keeps it in tools/ or scripts/.
    """
    start = (start or pathlib.Path(__file__).resolve().parent)
    for candidate in [start, *start.parents]:
        path = candidate / "local.settings.json"
        if path.exists():
            return path
    raise FileNotFoundError(
        "local.settings.json not found at or above "
        f"{start} — copy local.settings.example.json and fill in your Axiom values."
    )


def _load_settings() -> dict:
    return json.loads(find_settings_path().read_text())


def _parse_duration(spec: str) -> timedelta:
    m = _DURATION_RE.match(spec.strip())
    if not m:
        raise ValueError(f"Bad --since value '{spec}', expected e.g. 30m, 2h, 1d")
    n, unit = int(m.group(1)), m.group(2)
    return {"s": timedelta(seconds=n), "m": timedelta(minutes=n),
            "h": timedelta(hours=n), "d": timedelta(days=n)}[unit]


def env_predicate(env: str, settings: dict) -> str:
    """APL `where` clause selecting one deployment environment.

    Emits an `in (...)` set rather than an equality so a repo mid-migration (some
    rows stamped 'production', newer ones 'prod') still gets a complete answer.
    """
    config = dict(DEFAULT_ENV_CONFIG)
    config.update(settings.get("axiomEnv") or {})
    field = config.get("field", "env")
    values = (config.get("values") or {}).get(env)
    if not values:
        raise ValueError(
            f"--env {env} has no mapping. Add one under \"axiomEnv\".values in "
            "local.settings.json, or bring the emitter to the canonical `env` "
            "vocabulary (dev|test|prod) — see README 'Environment Discrimination'."
        )
    rendered = ", ".join("'" + str(v).replace("'", "") + "'" for v in values)
    return f"{field} in ({rendered})"


def query(dataset: str, token: str, *, limit: int, since: timedelta,
          side: str | None = None, name: str | None = None,
          where: str | None = None, extra_where: list | None = None) -> dict:
    """Run one APL query. Importable — the cooked-report tools build on this."""
    now = datetime.now(timezone.utc)
    start = now - since
    filters = []
    if side:
        filters.append(f"side == '{side}'")
    if name:
        filters.append(f"name contains '{name}'")
    for clause in (extra_where or []):
        filters.append(clause)
    if where:
        filters.append(where)
    # `where` must precede `order by`/`limit` in the pipeline, otherwise filtering
    # would apply after the top-N cut and could return fewer than `limit` rows.
    apl = f"['{dataset}']"
    for f in filters:
        apl += f" | where {f}"
    apl += f" | order by _time desc | limit {limit}"

    body = {
        "apl": apl,
        "startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endTime": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    req = urllib.request.Request(
        "https://api.axiom.co/v1/datasets/_apl?format=legacy",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:500]
        hint = ""
        if e.code in (401, 403):
            hint = ("\nHint: axiomQueryToken must be a READ-ONLY QUERY token with this "
                    "dataset in its scope. An ingest token (axiomToken) cannot query — "
                    "mint a second token in Axiom Settings -> API Tokens.")
        raise RuntimeError(f"Axiom query failed ({e.code}): {detail}{hint}") from e


def _is_empty(v) -> bool:
    """True for None/''/{} and for dicts whose values are all themselves empty.

    Catches a stray `DBG:{a:None,b:None}` that Axiom's schema backfill adds to
    every row once ANY event has set that field — `v not in (None, "", {})`
    alone does not (a dict of Nones is not `{}`).
    """
    if v in (None, "", {}):
        return True
    if isinstance(v, dict):
        return all(_is_empty(x) for x in v.values())
    return False


def flatten_event(match: dict) -> dict:
    """One Axiom match -> a flat dict of its non-empty fields.

    The standard row shape nests each event's free-form payload under one `data`
    map field (AxiomLogger.js rule 1 — a top-level spread walks the dataset into
    Axiom's 257-field cap, after which new fields are SILENTLY dropped). This
    lifts those sub-keys back up for display, so a reader never has to know
    which fields happened to be hoisted.
    """
    row = {k: v for k, v in (match.get("data") or {}).items() if not _is_empty(v)}
    payload = row.pop("data", None)
    if isinstance(payload, dict):
        row.update({k: v for k, v in payload.items() if not _is_empty(v)})
    row["_time"] = match.get("_time")
    return row


def _print_table(matches: list) -> None:
    for m in matches:
        row = flatten_event(m)
        ts = row.pop("_time", "?")
        side = row.pop("side", "?")
        name = row.pop("name", "?")
        env = row.pop("env", row.pop("target", "?"))
        for noise in ("version", "app", "caller"):
            row.pop(noise, None)
        detail = " ".join(f"{k}={v}" for k, v in row.items())
        print(f"{ts}  {env:<5} {side:<6} {name:<32} {detail}")


def build_parser(description: str = __doc__) -> argparse.ArgumentParser:
    """Shared flags, so a cooked-report tool offers the same surface as this one."""
    parser = argparse.ArgumentParser(description=description,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", "-n", type=int, default=200,
                        help="Max events to return (default: 200)")
    parser.add_argument("--since", default="24h",
                        help="How far back to look, e.g. 30m, 2h, 1d (default: 24h)")
    parser.add_argument("--env", choices=ENV_CHOICES,
                        help="Filter to one deployment environment ('sit' == 'test')")
    return parser


def resolve_credentials(settings: dict) -> tuple:
    """(dataset, query_token). Exits with a usable message rather than a KeyError."""
    dataset = settings.get("axiomDataset")
    token = settings.get("axiomQueryToken")
    if not dataset or not token:
        print("ERROR: axiomDataset / axiomQueryToken not set in local.settings.json.\n"
              "  axiomDataset    — this repo's OWN dataset (one per repo, see README)\n"
              "  axiomQueryToken — a READ-ONLY query token, separate from the ingest\n"
              "                    token (axiomToken) the server uses.",
              file=sys.stderr)
        raise SystemExit(1)
    return dataset, token


def main() -> int:
    parser = build_parser()
    parser.add_argument("--side", choices=["gas", "python"], help="Filter to one side")
    parser.add_argument("--name", help="Filter to event names (tags) containing this substring")
    parser.add_argument("--where", help="Raw APL `where` expression, e.g. \"data.docId == 'xyz'\"")
    parser.add_argument("--raw", nargs="?", const="-", metavar="PATH",
                        help="Dump full JSON response (to PATH, or stdout if no PATH given)")
    parser.add_argument("--json", action="store_true",
                        help="Print one flattened JSON object per event (pipe to jq)")
    args = parser.parse_args()

    settings = _load_settings()
    dataset, token = resolve_credentials(settings)

    extra_where = [env_predicate(args.env, settings)] if args.env else []

    result = query(
        dataset, token,
        limit=args.limit, since=_parse_duration(args.since),
        side=args.side, name=args.name, where=args.where, extra_where=extra_where,
    )
    matches = result.get("matches", [])

    if args.raw is not None:
        text = json.dumps(result, indent=2)
        if args.raw == "-":
            print(text)
        else:
            pathlib.Path(args.raw).write_text(text)
            print(f"Wrote {len(matches)} events to {args.raw}", file=sys.stderr)
        return 0

    if args.json:
        for m in matches:
            print(json.dumps(flatten_event(m)))
        return 0

    scope = f", env={args.env}" if args.env else ""
    print(f"{len(matches)} events, {args.since} lookback, dataset={dataset}{scope}")
    _print_table(matches)
    return 0


if __name__ == "__main__":
    sys.exit(main())
