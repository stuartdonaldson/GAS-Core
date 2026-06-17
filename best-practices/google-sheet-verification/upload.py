"""
tests/upload.py — POST a .snap file to the GAS doPost endpoint.

Public API:
    post_snap(snap_path, endpoint_url) -> dict
        Returns: { spreadsheet_id, url, public_sharing, errors }
        Raises:  UploadError on HTTP failure or ok=false response.
"""

import json
import os

import requests


class UploadError(Exception):
    pass


def post_snap(snap_path, endpoint_url, timeout=120):
    """
    POST a .snap file to the GAS web app endpoint.

    Args:
        snap_path:    Path to the .snap file.
        endpoint_url: GAS deployed web app URL.
        timeout:      HTTP request timeout in seconds.

    Returns:
        dict with keys: spreadsheet_id, url, public_sharing, errors

    Raises:
        UploadError if the HTTP request fails or the server returns ok=false.
    """
    with open(snap_path, "r", encoding="utf-8") as f:
        snap_text = f.read()

    filename = os.path.basename(snap_path)
    payload = {"filename": filename, "snapText": snap_text}

    try:
        resp = requests.post(
            endpoint_url,
            data=json.dumps(payload),
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        raise UploadError(f"HTTP request failed: {e}") from e

    try:
        data = resp.json()
    except ValueError as e:
        raise UploadError(f"Response is not valid JSON: {resp.text[:200]}") from e

    if not data.get("ok"):
        raise UploadError(f"GAS error: {data.get('error', 'unknown')}")

    return {
        "spreadsheet_id": data["spreadsheetId"],
        "url":            data["url"],
        "errors":         data.get("errors", []),
    }
