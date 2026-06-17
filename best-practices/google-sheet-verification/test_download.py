"""
Unit and integration tests for tests/download.py.

Unit tests use mocked HTTP — no network required.
Integration test requires GAS_URL in .env and a live GAS deployment.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(__file__))
from download import DownloadError, download_xlsx, export_url, XLSX_MAGIC
from upload import post_snap

FAKE_ID = "1ABC123fakeSpreadsheetId"
SNAP_PATH = os.path.join(os.path.dirname(__file__), "..", "testdata", "minimal.snap")


def _mock_response(content, status=200, raise_for_status=None):
    mock = MagicMock()
    mock.status_code = status
    mock.content = content
    if raise_for_status:
        mock.raise_for_status.side_effect = raise_for_status
    else:
        mock.raise_for_status.return_value = None
    return mock


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------

class TestDownloadXlsxUnit(unittest.TestCase):

    @patch("download.requests.get")
    def test_success_returns_bytes(self, mock_get):
        xlsx_bytes = XLSX_MAGIC + b"\x00" * 100
        mock_get.return_value = _mock_response(xlsx_bytes)
        result = download_xlsx(FAKE_ID)
        self.assertEqual(result, xlsx_bytes)

    @patch("download.requests.get")
    def test_constructs_correct_url(self, mock_get):
        mock_get.return_value = _mock_response(XLSX_MAGIC + b"\x00" * 100)
        download_xlsx(FAKE_ID)
        called_url = mock_get.call_args.args[0]
        self.assertIn(FAKE_ID, called_url)
        self.assertIn("export?format=xlsx", called_url)

    @patch("download.requests.get")
    def test_no_auth_header_sent(self, mock_get):
        mock_get.return_value = _mock_response(XLSX_MAGIC + b"\x00" * 100)
        download_xlsx(FAKE_ID)
        call_kwargs = mock_get.call_args.kwargs
        headers = call_kwargs.get("headers", {})
        self.assertNotIn("Authorization", headers)

    @patch("download.requests.get")
    def test_raises_on_http_error(self, mock_get):
        import requests as req
        mock_get.return_value = _mock_response(
            b"", status=403,
            raise_for_status=req.HTTPError("403 Forbidden")
        )
        with self.assertRaises(DownloadError) as ctx:
            download_xlsx(FAKE_ID)
        self.assertIn("HTTP request failed", str(ctx.exception))

    @patch("download.requests.get")
    def test_raises_on_non_xlsx_response(self, mock_get):
        mock_get.return_value = _mock_response(b"<html>sign-in page</html>")
        with self.assertRaises(DownloadError) as ctx:
            download_xlsx(FAKE_ID)
        self.assertIn("does not look like an xlsx", str(ctx.exception))

    def test_export_url_format(self):
        url = export_url("mySheetId")
        self.assertEqual(
            url,
            "https://docs.google.com/spreadsheets/d/mySheetId/export?format=xlsx"
        )


# ---------------------------------------------------------------------------
# Integration test
# ---------------------------------------------------------------------------

class TestDownloadXlsxIntegration(unittest.TestCase):

    def setUp(self):
        env = _load_env()
        self.endpoint = os.environ.get("GAS_URL") or env.get("GAS_URL")
        if not self.endpoint:
            self.skipTest("GAS_URL not set — skipping integration test")
        if not os.path.exists(SNAP_PATH):
            self.skipTest(f"minimal.snap not found at {SNAP_PATH}")

    def test_upload_then_download_returns_valid_xlsx(self):
        upload_result = post_snap(SNAP_PATH, self.endpoint)
        spreadsheet_id = upload_result["spreadsheet_id"]

        xlsx_bytes = download_xlsx(spreadsheet_id)

        self.assertTrue(len(xlsx_bytes) > 0, "Downloaded file is empty")
        self.assertTrue(
            xlsx_bytes.startswith(XLSX_MAGIC),
            f"File does not start with xlsx magic bytes: {xlsx_bytes[:8]!r}"
        )


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
