#!/usr/bin/env python3
"""Tier-1 tests for the shared Axiom tooling. Stdlib only, no network, no Axiom.

    python3 tools/test_axiom_tools.py

Covers the three things a repo's copy could silently get wrong: the --env
predicate (including the compatibility shim), the nested-`data` unflattening
that the 257-field fix makes necessary, and session grouping.
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import axiom_report as ar  # noqa: E402
import query_axiom as qa  # noqa: E402


class EnvPredicate(unittest.TestCase):
    def test_canonical_env_needs_no_config(self):
        self.assertEqual(qa.env_predicate("prod", {}),
                         "env in ('prod', 'production', 'PROD', 'PRODUCTION', 'TEMPLATE')")

    def test_sit_is_a_synonym_for_test(self):
        self.assertEqual(qa.env_predicate("sit", {}), qa.env_predicate("test", {}))

    def test_default_covers_every_observed_vocabulary(self):
        # A repo mid-migration has rows stamped both ways; the predicate is a set
        # membership precisely so it returns a complete answer during that window.
        prod = qa.env_predicate("prod", {})
        for legacy in ("production", "TEMPLATE"):
            self.assertIn(f"'{legacy}'", prod)

    def test_repo_may_override_the_field(self):
        settings = {"axiomEnv": {"field": "target",
                                 "values": {"prod": ["TEMPLATE"], "sit": ["TEST"]}}}
        self.assertEqual(qa.env_predicate("prod", settings), "target in ('TEMPLATE')")

    def test_unmapped_env_raises_rather_than_silently_matching_nothing(self):
        settings = {"axiomEnv": {"field": "target", "values": {"prod": ["TEMPLATE"]}}}
        with self.assertRaises(ValueError):
            qa.env_predicate("dev", settings)

    def test_single_quotes_cannot_escape_the_predicate(self):
        settings = {"axiomEnv": {"values": {"prod": ["a' or '1"]}}}
        self.assertNotIn("' or '", qa.env_predicate("prod", settings))


class FlattenEvent(unittest.TestCase):
    def test_nested_payload_is_lifted(self):
        match = {"_time": "2026-09-21T00:00:00Z",
                 "data": {"name": "sync.done", "env": "prod", "docId": "D1",
                          "data": {"changesCount": 3, "blank": None}}}
        row = qa.flatten_event(match)
        self.assertEqual(row["changesCount"], 3)
        self.assertEqual(row["docId"], "D1")       # hoisted column survives
        self.assertNotIn("blank", row)             # empty values dropped
        self.assertEqual(row["_time"], "2026-09-21T00:00:00Z")

    def test_dict_of_nones_counts_as_empty(self):
        # Axiom schema-backfill adds a field to EVERY row once any event sets it;
        # `v not in (None, "", {})` alone would let {a: None} through as detail.
        self.assertTrue(qa._is_empty({"a": None, "b": {"c": None}}))
        self.assertFalse(qa._is_empty({"a": None, "b": 1}))

    def test_unnested_payload_still_works(self):
        row = qa.flatten_event({"_time": "t", "data": {"name": "x", "k": "v"}})
        self.assertEqual(row["k"], "v")


class SessionGrouping(unittest.TestCase):
    def _act(self, ts, label, actor, detail, group=ar.SESSION):
        return ar.Activity(ts=ts, ts_str=str(ts), label=label, detail=detail,
                           actor=actor, group=group)

    def test_same_actor_within_gap_collapses(self):
        lines = ar.group_sessions([self._act(0, "A", "bob", "did a"),
                                   self._act(60, "B", "bob", "did b")], 300)
        self.assertEqual(len(lines), 1)
        self.assertIn("did a → did b", lines[0])

    def test_gap_exceeded_splits(self):
        lines = ar.group_sessions([self._act(0, "A", "bob", "did a"),
                                   self._act(9999, "B", "bob", "did b")], 300)
        self.assertEqual(len(lines), 2)

    def test_different_actors_never_merge(self):
        lines = ar.group_sessions([self._act(0, "A", "bob", "did a"),
                                   self._act(10, "B", "amy", "did b")], 300)
        self.assertEqual(len(lines), 2)

    def test_standalone_interrupts_a_session(self):
        lines = ar.group_sessions([self._act(0, "A", "bob", "did a"),
                                   self._act(10, "SYS", None, "swept", group=ar.STANDALONE),
                                   self._act(20, "B", "bob", "did b")], 300)
        self.assertEqual(len(lines), 3)

    def test_zero_gap_disables_grouping(self):
        lines = ar.group_sessions([self._act(0, "A", "bob", "did a"),
                                   self._act(10, "B", "bob", "did b")], 0)
        self.assertEqual(len(lines), 2)


class Duration(unittest.TestCase):
    def test_units(self):
        self.assertEqual(qa._parse_duration("2h").total_seconds(), 7200)
        self.assertEqual(qa._parse_duration("1d").total_seconds(), 86400)

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            qa._parse_duration("soon")


class Apl(unittest.TestCase):
    def test_filters_precede_the_limit(self):
        # If `limit` came first, filtering would apply after the top-N cut and
        # could return fewer than `limit` rows.
        captured = {}

        def fake_urlopen(req, timeout=0):
            captured["apl"] = req.data.decode()
            raise RuntimeError("stop here — request shape is what is under test")

        original = qa.urllib.request.urlopen
        qa.urllib.request.urlopen = fake_urlopen
        try:
            with self.assertRaises(RuntimeError):
                qa.query("ds", "tok", limit=5, since=qa._parse_duration("1h"),
                         name="sync", extra_where=["env in ('prod')"])
        finally:
            qa.urllib.request.urlopen = original
        apl = captured["apl"]
        self.assertLess(apl.index("where name contains"), apl.index("limit 5"))
        self.assertIn("where env in ", apl)


if __name__ == "__main__":
    unittest.main(verbosity=2)
