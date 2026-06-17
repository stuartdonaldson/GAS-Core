# Best Practice: GAS Server-Side Logging via Google Drive

## Overview

Google Apps Script execution logs are ephemeral — they are only available in the Apps Script editor and cannot be read programmatically from outside the GAS environment. This pattern bridges that gap by writing structured log files to a Google Drive folder that is simultaneously accessible to development tooling (e.g. Playwright tests) via Google Drive for Desktop's locally-mapped filesystem path.

**Use when:** You need automated tests or external tooling to verify server-side GAS behaviour (not just UI state).

**Provenance:** Extracted from [AudioTrackCombiner](../../../../c-dev/AudioTrackCombiner). Reference files in that project:
- `src/GasLogger.js` — the original server-side logger
- `tests/test-utils.js` — `waitForGasLog`, `clearGasLogs`, `countGasLogEntries`
- `tests/9-audit.spec.js` — example audit test using `countGasLogEntries`
- `local.settings.example.json` — config template

---

## Problem

GAS execution logs (`Logger.log`) are only visible inside the Apps Script editor and are discarded after the execution completes. There is no supported way for external code — a test runner, a CI job, or a local script — to read them. This makes it impossible to assert on server-side state (e.g. which Drive folder was accessed, how many times `doGet` was called, what error was caught) using standard test tooling.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Google Apps Script project** | The GAS project must have the `DriveApp` service enabled (V8 runtime) |
| **Google Drive scope** | `appsscript.json` must include `https://www.googleapis.com/auth/drive` or `https://www.googleapis.com/auth/drive.file` |
| **Google Drive for Desktop** | Must be installed and signed in on the development machine; maps the Drive folder to a local filesystem path |
| **Node.js** | v16+ recommended; used by the test-side polling helpers |
| **clasp** | Only needed if you are also using the deployment pattern; not required for logging alone |

No npm packages are required for the GAS side. The test-side helpers (`gas-log-helpers.js`) use only Node.js built-ins (`fs`, `path`).

---

## Architecture

```
GAS execution                    Google Drive                  Dev host (local)
─────────────────────            ─────────────────────         ──────────────────────
doGet / doPost called            ATC-Dev/ (Drive folder)       /path/to/drive/ATC-Dev/
  │                               │                              │
  ├─ GasLogger.log('tag', data)   │                              │
  ├─ GasLogger.log('tag', data)   │                              │
  └─ GasLogger.flush() ──────────►│ creates timestamp-uuid.log   │
                                  │ (NDJSON, one entry/line)     ├─ waitForGasLog(fn)
                                  │                              │   polls directory
                                  │                              │   parses each .log
                                  │                              └─ asserts on entries
```

**Key facts:**
- The Drive folder is shared and accessible via Drive for Desktop on the dev machine
- Each `flush()` writes one NDJSON file (timestamped + UUID filename) — atomic, no partial reads
- Tests poll the directory (no push/notification); files appear within 1–3 seconds of GAS execution
- The folder ID is stored as a GAS Script Property (`GAS_LOGGER_FOLDER_ID`) and as `gasLogDir` in local dev settings

---

## Instance Correlation (Recommended)

Timestamp-only filtering is fragile when multiple cloud executions overlap. Use explicit correlation fields in every log entry.

Minimum fields:
- `sessionId` — developer/test session identifier (shared manually between tooling and GAS config)
- `runId` — per-test-run identifier
- `execId` — per GAS execution identifier (new UUID at `doGet`/`doPost` start)

Example entry shape:

```json
{
  "ts": "2026-05-05T10:00:00.000Z",
  "tag": "doGet",
  "data": {
    "sessionId": "dev-aq2",
    "runId": "20260505T1000Z-9f1c",
    "execId": "7c9f...",
    "route": "audit"
  }
}
```

Test matching should require at least `sessionId` + `runId` (not timestamp only).

---

## Flush Strategy (Recommended)

Drive writes are relatively slow in GAS. Avoid flush-on-every-log and avoid huge end-of-request buffers.

Use a bounded batch policy:
- Flush on request completion (`finally` block)
- Flush when buffered entries reach a threshold (for example 25)
- Flush on high-severity/error events

This keeps writes low while reducing lost context if execution stops early.

---

## Visibility Latency and Test Polling

Local Drive visibility is eventually consistent. Treat file appearance as delayed.

Guidance:
- Poll with backoff and an overall timeout (15–30s for slower environments)
- Ignore files older than test start
- Match on correlation fields (`sessionId`, `runId`) before asserting content

---

## How It Works — Annotated Example

### Server side (GAS)

```javascript
// In Code.js (or any GAS server file)
function doGet(e) {
  GasLogger.log('doGet', { ts: new Date().toISOString() });
  // ... do work ...
  GasLogger.flush();   // Always call flush() in both success and catch paths
  return html;
}
```

Each `.log` call accumulates an entry: `{ ts, tag, data }`. Each `.flush()` writes one file:

```
{"ts":"2026-05-04T12:00:00.000Z","tag":"doGet","data":{"ts":"2026-05-04T12:00:00.000Z"}}
{"ts":"2026-05-04T12:00:00.001Z","tag":"withRetry","data":{"attempt":1}}
```

### Test side (Node.js / Playwright)

```javascript
const { waitForGasLog, clearGasLogs } = require('./test-utils');

test('server processed the request', async ({ page }) => {
  clearGasLogs();                         // remove previous run's files
  await page.goto('');                    // triggers doGet on GAS server

  const entry = await waitForGasLog(     // polls GAS_LOG_DIR until match or timeout
    e => e.tag === 'doGet',
    15000                                // 15 second timeout
  );
  expect(entry.data.ts).toBeTruthy();
});
```

### Audit test example

```javascript
// Count server-side page loads across entire test suite run
for (const fname of fs.readdirSync(GAS_LOG_DIR)) {
  const content = fs.readFileSync(path.join(GAS_LOG_DIR, fname), 'utf8');
  for (const line of content.split('\n')) {
    const obj = JSON.parse(line.trim());
    if (obj.tag === 'doGet') doGetCount++;
  }
}
expect(doGetCount).toBeLessThanOrEqual(THRESHOLD);
```

---

## One-Time Setup

### 1. Create the Drive folder

Create a folder in Google Drive (e.g. `MyProject-Dev`). Copy the folder ID from the URL:
```
https://drive.google.com/drive/folders/<FOLDER_ID>
```

### 2. Configure GAS Script Property

In the Apps Script editor:  
**Project Settings → Script Properties → Add property**

| Property | Value |
|---|---|
| `GAS_LOGGER_FOLDER_ID` | `<the Drive folder ID>` |

### 3. Configure local dev settings

Copy `local.settings.example.json` → `local.settings.json` (gitignored) and fill in:

```json
{
  "gasLogDir": "/path/to/Google Drive/My Drive/MyProject-Dev"
}
```

The path is wherever Google Drive for Desktop mounts the folder locally.

### 4. Include GasLogger in your GAS project

Copy `GasLogger.js` into `src/` and run `setupGasLogger()` once from the GAS editor to verify the Drive write works.

---

## Enable / Disable

```javascript
GasLogger.disable();  // log() still calls Logger.log() but skips Drive writes
GasLogger.enable();
```

Disabling is useful in production deployments where Drive writes are unnecessary.

---

## Reusable Files

| File | Purpose |
|---|---|
| `GasLogger.js` | Drop-in GAS server logging module |
| `test-utils.js` | `waitForGasLog`, `clearGasLogs` helper functions |
| `local.settings.example.json` | Template for local developer settings |

---

## Constraints and Trade-offs

| Concern | Detail |
|---|---|
| Latency | Drive sync introduces 1–5 second lag; use `waitForGasLog` with adequate timeout |
| Multi-instance isolation | Do not rely on timestamp alone; include and match `sessionId` + `runId` (and ideally `execId`) |
| Test isolation | Call `clearGasLogs()` before each test or test group, and filter by correlation fields |
| Flush policy | Prefer bounded buffering (size/error/end-of-request) over frequent single-entry flushes |
| Drive quota | Each flush creates one file; clean up periodically or add TTL pruning |
| Production | Disable GasLogger in PROD deployments to avoid Drive writes on real user traffic |
| Auth | The GAS script must have Drive scope (`DriveApp`) in `appsscript.json` |
| Drive for Desktop | Required on the dev machine; not suitable for CI without Drive access |

---

## Alternative Pattern: Shared File ID + HTTP Read

Alternative: both GAS and tooling share a single Drive file ID. GAS appends NDJSON, tooling retrieves the file via HTTP (for example `curl` to an export/download URL with appropriate access).

When this helps:
- Tooling cannot rely on local Drive-for-Desktop mapping
- You want a single known artifact instead of many timestamped files

New risks to manage:
- Concurrent append contention across multiple executions
- Read/write race windows (tool reads while GAS writes)
- Larger single-file growth and retention management
- Access control complexity if using link-based sharing

If you choose this pattern, keep the same correlation fields (`sessionId`, `runId`, `execId`) and consider periodic file rotation (for example one file per run) to reduce contention.
