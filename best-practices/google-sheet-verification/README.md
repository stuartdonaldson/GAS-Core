# Best Practice: Verifying Google Sheet Content via xlsx Export

## Overview

When a Google Apps Script writes data to a Google Sheet, verifying the sheet's content from an automated test requires an approach that works without the Sheets API and without service account credentials. This pattern uses Google Drive's public xlsx export URL to download the sheet as an Excel file and examines it with `openpyxl` (Python).

**The key insight:** Any Google Sheet shared with "Anyone with the link" can be downloaded as xlsx by hitting a predictable export URL — no OAuth, no Sheets API, no authentication token.

**Use when:** You have a GAS web app that writes output to a Google Sheet and you want to assert on the sheet's content from a Python test suite.

**Provenance:** Extracted from [WingTools/WingReportGAS](../../../../g-Proj/WingTools/WingReportGAS). Reference files in that project:
- `tests/download.py` — the original download helper
- `tests/upload.py` — the original GAS endpoint POST helper
- `tests/test_download.py` — unit + integration tests for the download helper
- `tests/test_upload.py` — unit + integration tests for the upload helper
- `scripts/Code.js` — GAS endpoint that calls `setSharing()` and returns `spreadsheetId`

---

## Problem

Verifying a Google Sheet's content in automated tests normally requires either the Google Sheets API (which needs OAuth and a service account) or scraping the Sheet's web UI. Both are complex to set up and brittle to maintain. Google Drive provides a simpler path: any Sheet shared with "Anyone with the link" can be exported as xlsx via a predictable unauthenticated URL, making it readable with standard Excel libraries in any language.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Python** | 3.9+ |
| **requests** | `pip install requests`; HTTP download of the xlsx export |
| **openpyxl** | `pip install openpyxl`; parse xlsx bytes into workbook/worksheet objects |
| **Google Apps Script project** | The GAS endpoint must call `DriveApp.getFileById(id).setSharing(ANYONE_WITH_LINK, VIEW)` on created sheets |
| **GAS Drive scope** | `appsscript.json` must include the Drive scope for the `setSharing` call |
| **pytest** | `pip install pytest`; used in the example test files (any test framework works) |

No Google API key or OAuth credentials are needed for the download. The `requests` call is a plain unauthenticated HTTP GET.

---

## Architecture

```
Test code (Python)                   Google Drive (public)
─────────────────────────────────    ─────────────────────────────────
1. POST snap data to GAS endpoint ──► GAS writes to Google Sheet
                                      (shared: Anyone with link)
2. GET /export?format=xlsx ──────────► Drive returns .xlsx bytes
3. openpyxl.load_workbook(BytesIO) 
4. Assert on cell values / headers
```

**Key facts:**
- The export URL is deterministic given the spreadsheet ID: `https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx`
- The GAS endpoint returns the spreadsheet ID in its response — no hardcoding needed
- The sheet must be shared with "Anyone with the link (viewer)" — the export URL respects that sharing setting
- No Google API key or OAuth scope is required for the download
- The xlsx format preserves all cell values including formulas evaluated to their current values

---

## How It Works — Annotated Example

### Step 1: GAS endpoint creates the sheet and returns its ID

```javascript
// GAS doPost handler
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.create('Report-' + data.filename);

  // Share so the test can download it
  DriveApp.getFileById(ss.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // ... write data to ss ...

  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      spreadsheetId: ss.getId(),
      url: ss.getUrl(),
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### Step 2: Python test POSTs data and downloads the sheet

```python
from tests.upload import post_snap
from tests.download import download_xlsx
import openpyxl
import io

def test_channel_sheet_written(gas_endpoint, snap_file):
    # Upload snap → GAS creates sheet, returns spreadsheet_id
    result = post_snap(snap_file, gas_endpoint)
    spreadsheet_id = result['spreadsheet_id']

    # Download the sheet as xlsx (no auth required)
    xlsx_bytes = download_xlsx(spreadsheet_id)

    # Parse and assert
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
    ws = wb['Channel Details']

    headers = [cell.value for cell in ws[1]]
    assert 'Ch #' in headers
    assert 'Channel Name' in headers

    # Check a data row
    row2 = [cell.value for cell in ws[2]]
    assert row2[headers.index('Ch #')] == 1
```

### Step 3: Unit test the download function independently

```python
from unittest.mock import patch, MagicMock
from tests.download import download_xlsx, DownloadError, XLSX_MAGIC

@patch('download.requests.get')
def test_validates_xlsx_magic_bytes(mock_get):
    mock_get.return_value = MagicMock(
        content=b'<html>sign-in page</html>',
        raise_for_status=lambda: None
    )
    with pytest.raises(DownloadError, match='does not look like an xlsx'):
        download_xlsx('any-id')
```

---

## Export URL Reference

```python
def export_url(spreadsheet_id):
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx"
```

Optional parameters:
- `&gid=<sheet_id>` — export a specific sheet tab (default: all sheets)
- No authentication headers should be sent — the export URL works via sharing settings alone

---

## Sharing Configuration in GAS

```javascript
// Make spreadsheet readable by anyone with the link
DriveApp.getFileById(spreadsheetId)
  .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
```

Alternatively, share the output **folder** with ANYONE_WITH_LINK and files created in it inherit the permission — this avoids an extra API call per sheet.

---

## One-Time Setup

### 1. Python dependencies

```bash
pip install requests openpyxl
```

### 2. Configure the GAS endpoint URL

```
# .env
GAS_URL=https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
```

### 3. Create a test fixture with a minimal known-good snapshot

Store a `testdata/minimal.snap` (or equivalent) so integration tests can POST a known payload and verify a deterministic output.

---

## Reusable Files

| File | Purpose |
|---|---|
| `download.py` | `download_xlsx(spreadsheet_id)` — HTTP download with magic-byte validation |
| `upload.py` | `post_snap(snap_path, endpoint_url)` — POST file to GAS endpoint |
| `test_download.py` | Unit + integration tests for the download helper |
| `test_upload.py` | Unit + integration tests for the upload helper |

---

## Validating xlsx Content

```python
import openpyxl
import io

wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))

# List sheets
print(wb.sheetnames)

# Read headers from first row
ws = wb['Sheet Name']
headers = [cell.value for cell in ws[1]]

# Iterate rows (skip header)
for row in ws.iter_rows(min_row=2, values_only=True):
    print(row)

# Read a specific cell
value = ws.cell(row=2, column=3).value
```

---

## Constraints and Trade-offs

| Concern | Detail |
|---|---|
| Sharing requirement | Sheet must be "Anyone with link" — not suitable for sensitive data |
| Propagation delay | Google sometimes takes a few seconds after `setSharing()` before the export URL works; add a short retry loop if integration tests are flaky |
| Stale data | The export reflects the sheet's current state; if GAS writes asynchronously, poll or wait before downloading |
| Format fidelity | Formulas are exported as their evaluated values; chart objects are not exported |
| File accumulation | Each test run creates a new sheet; clean up the output folder periodically or add a GAS cleanup endpoint |
