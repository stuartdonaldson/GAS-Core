"""
Unit and integration tests for tests/upload.py.

Unit tests use mocked HTTP — no network required.
Integration test requires GAS_URL in .env and a live GAS deployment.
"""

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(__file__))
from upload import UploadError, post_snap

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SNAP_PATH = os.path.join(os.path.dirname(__file__), "..", "testdata", "minimal.snap")
ENDPOINT = "https://script.google.com/fake/exec"

SUCCESS_BODY = {
    "ok": True,
    "spreadsheetId": "1ABC123",
    "url": "https://docs.google.com/spreadsheets/d/1ABC123/edit",
    "publicSharing": True,
    "errors": [],
}


def _mock_response(body, status=200, raise_for_status=None):
    mock = MagicMock()
    mock.status_code = status
    mock.json.return_value = body
    mock.text = json.dumps(body)
    if raise_for_status:
        mock.raise_for_status.side_effect = raise_for_status
    else:
        mock.raise_for_status.return_value = None
    return mock


# ---------------------------------------------------------------------------
# Unit tests (mocked HTTP)
# ---------------------------------------------------------------------------

class TestPostSnapUnit(unittest.TestCase):

    @patch("upload.requests.post")
    def test_success_returns_parsed_fields(self, mock_post):
        mock_post.return_value = _mock_response(SUCCESS_BODY)
        result = post_snap(__file__, ENDPOINT)  # __file__ is a readable stand-in
        self.assertEqual(result["spreadsheet_id"], "1ABC123")
        self.assertIn("url", result)
        self.assertEqual(result["errors"], [])

    @patch("upload.requests.post")
    def test_raises_on_ok_false(self, mock_post):
        mock_post.return_value = _mock_response({"ok": False, "error": "snap parse failed"})
        with self.assertRaises(UploadError) as ctx:
            post_snap(__file__, ENDPOINT)
        self.assertIn("snap parse failed", str(ctx.exception))

    @patch("upload.requests.post")
    def test_raises_on_non_json_response(self, mock_post):
        mock = MagicMock()
        mock.raise_for_status.return_value = None
        mock.json.side_effect = ValueError("not json")
        mock.text = "<html>error</html>"
        mock_post.return_value = mock
        with self.assertRaises(UploadError) as ctx:
            post_snap(__file__, ENDPOINT)
        self.assertIn("not valid JSON", str(ctx.exception))

    @patch("upload.requests.post")
    def test_raises_on_http_error(self, mock_post):
        import requests as req
        mock_post.return_value = _mock_response(
            {}, status=500,
            raise_for_status=req.HTTPError("500 Server Error")
        )
        with self.assertRaises(UploadError) as ctx:
            post_snap(__file__, ENDPOINT)
        self.assertIn("HTTP request failed", str(ctx.exception))

    @patch("upload.requests.post")
    def test_gas_errors_surfaced_in_result(self, mock_post):
        body = {**SUCCESS_BODY, "errors": ["Sheet X failed to render"]}
        mock_post.return_value = _mock_response(body)
        result = post_snap(__file__, ENDPOINT)
        self.assertEqual(result["errors"], ["Sheet X failed to render"])

    @patch("upload.requests.post")
    def test_post_sends_correct_payload(self, mock_post):
        mock_post.return_value = _mock_response(SUCCESS_BODY)
        post_snap(__file__, ENDPOINT)
        call_kwargs = mock_post.call_args
        import json as _json
        sent = _json.loads(call_kwargs.kwargs.get("data") or call_kwargs.args[1])
        self.assertIn("filename", sent)
        self.assertIn("snapText", sent)


# ---------------------------------------------------------------------------
# Integration test (requires live GAS endpoint)
# ---------------------------------------------------------------------------

class TestPostSnapIntegration(unittest.TestCase):

    def setUp(self):
        env = _load_env()
        self.endpoint = os.environ.get("GAS_URL") or env.get("GAS_URL")
        if not self.endpoint:
            self.skipTest("GAS_URL not set — skipping integration test")
        if not os.path.exists(SNAP_PATH):
            self.skipTest(f"minimal.snap not found at {SNAP_PATH}")

    def test_upload_returns_spreadsheet_id(self):
        result = post_snap(SNAP_PATH, self.endpoint)
        self.assertIsInstance(result["spreadsheet_id"], str)
        self.assertTrue(len(result["spreadsheet_id"]) > 0, "spreadsheet_id is empty")
        self.assertIn("spreadsheets", result["url"])


# ---------------------------------------------------------------------------

def _load_env(path=None):
    if path is None:
        path = os.path.join(os.path.dirname(__file__), "..", ".env")
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip()
    return env


if __name__ == "__main__":
    unittest.main()
