"""
tests/download.py — Download a Google Sheet as .xlsx via the public export URL.

Sharing is inherited from the output folder (ANYONE_WITH_LINK). No auth required.

Public API:
    download_xlsx(spreadsheet_id) -> bytes
        Returns raw .xlsx file bytes.
        Raises: DownloadError on HTTP failure or non-xlsx response.
"""

import requests


XLSX_MAGIC = b"PK\x03\x04"  # ZIP/OOXML magic bytes


class DownloadError(Exception):
    pass


def export_url(spreadsheet_id):
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx"


def download_xlsx(spreadsheet_id, timeout=60):
    """
    Download a Google Sheet as .xlsx bytes via the public Drive export URL.

    No authentication required — the output folder grants ANYONE_WITH_LINK access.

    Args:
        spreadsheet_id: Google Sheets file ID from the upload response.
        timeout:        HTTP request timeout in seconds.

    Returns:
        Raw .xlsx bytes.

    Raises:
        DownloadError on HTTP failure or invalid xlsx content.
    """
    url = export_url(spreadsheet_id)
    try:
        resp = requests.get(url, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise DownloadError(f"HTTP request failed: {e}") from e

    content = resp.content
    if not content.startswith(XLSX_MAGIC):
        raise DownloadError(
            f"Response does not look like an xlsx file "
            f"(got {len(content)} bytes, starts with {content[:8]!r})"
        )

    return content
