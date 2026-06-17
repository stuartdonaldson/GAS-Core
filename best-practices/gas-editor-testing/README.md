# Best Practice: Playwright Testing via the Apps Script Editor

## Overview

This pattern drives the **Apps Script IDE** (`script.google.com/home/projects/{ID}/edit`)
to run a named function, capture its Logger output, and verify side-effects — all without
user interaction after a one-time auth capture.

**This is a different pattern from `gas-playwright-testing`**, which targets deployed
*web-app* URLs and must navigate the `#sandboxFrame → #userHtmlFrame` iframe sandwich.
The editor is a standard SPA; no iframe handling is required.

**When to use this pattern:**
- Running a GAS function end-to-end to verify Drive writes, sheet mutations, or structured logging
- Replacing a manual "open editor → click Run → read log" verification step
- Regression testing for functions that have no web-app entry point

---

## Confirmed ARIA Structure (verified 2026-05-08)

These ARIA names are stable across page loads — prefer them over CSS classes, which Google obfuscates.

| UI element | Playwright locator |
|---|---|
| File list panel | `page.getByRole('listbox', { name: 'Project files' })` |
| Individual file | `.getByRole('option', { name: 'Utilities.gs', exact: true })` |
| Function picker | `page.getByRole('listbox', { name: 'Select function to run' })` |
| Function option | `.getByRole('option', { name: 'testGasLogger', exact: true })` |
| Run button | `page.getByRole('button', { name: 'Run the selected function' })` |
| Open log panel | `page.getByRole('button', { name: 'Open the execution log panel' })` |
| Close log panel | `page.getByRole('button', { name: 'Close execution logs pane' })` |

**Editor ready signal:** wait for `listbox "Select function to run"` to become visible —
this is the earliest reliable indicator that the project has loaded.

---

## Key Differences from Web-App Pattern

| | Web-app (`gas-playwright-testing`) | Editor (`gas-editor-testing`) |
|---|---|---|
| Target URL | `/macros/s/{deploymentId}/exec` | `/home/projects/{scriptId}/edit` |
| iframe handling | Required (`#sandboxFrame → #userHtmlFrame`) | None — flat SPA |
| Headless | Works headless | **`headless: false` required** — editor blocks some interactions |
| Auth | Same storageState pattern | Same storageState pattern |
| Function execution | Via UI form / doGet | Via editor Run button |
| Output capture | DOM assertions on web app | Parse execution log panel text |

---

## Selector Discovery: Use error-context.md

When a selector fails, Playwright writes `error-context.md` to the test-results folder.
This file contains a **full ARIA tree snapshot** of the page at the moment of failure.

This is significantly faster than inspecting screenshots or using browser DevTools:

```
test-results/
  your-test-name/
    error-context.md   ← search this for role names and aria-labels
    test-failed-1.png
    video.webm
```

Search for the element you're trying to reach:
```bash
grep -i "run\|function\|listbox\|picker" test-results/**/error-context.md
```

---

## UI Chrome Leaks into Log Text

When capturing the execution log panel by walking the DOM from the close button,
the following strings leak into the captured text — filter them:

```javascript
const UI_CHROME = new Set(['close', 'Close execution logs', 'Execution log']);

function isUiChrome(line) {
  return UI_CHROME.has(line.trim());
}

logLines.filter(l => l.trim() && !isUiChrome(l));
```

---

## Execution Log Line Format

After `testGasLogger()` runs, the execution log panel shows:

```
4:16:12 PM  Notice  Execution started
4:16:12 PM  Info    [GasLogger] {"ts":"...","tag":"normal.first",...}
4:16:18 PM  Notice  Execution completed
```

Wait for `"Execution completed"` or `"Execution failed"` to appear before capturing.
`"Execution failed"` should be treated as a hard test failure.

---

## Function Already Selected

The editor remembers the last function that was run. On subsequent runs the target
function may already be selected in the picker. `selectFunction` should check
`aria-selected` before clicking to avoid unnecessary interaction:

```javascript
const option = picker.getByRole('option', { name: funcName, exact: true });
const isSelected = await option.getAttribute('aria-selected');
if (isSelected === 'true') return;   // already selected — skip
```

---

## Playwright Config Notes

```javascript
module.exports = defineConfig({
  timeout: 120000,        // editor initialisation is slow
  use: {
    headless: false,      // required — editor blocks interactions in headless mode
    storageState: '.auth/user.json',
    viewport: { width: 1280, height: 900 },
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
```

---

## Reusable Files

| File | Purpose |
|---|---|
| `gas-editor-helpers.js` | `waitForEditorReady`, `navigateToFile`, `selectFunction`, `clickRun`, `waitForExecutionComplete`, `captureExecutionLogText` |

Reference implementation: `F3Go30/tests/playwright/gas-editor-helpers.js`

---

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Selector times out on file name | File is off-screen in scrollable list | Use `click()` directly — Playwright scrolls into view; do not `waitFor({ state: 'visible' })` first |
| Function picker not found | Wrong ARIA name or page not fully loaded | Wait for `listbox "Select function to run"` before navigating files |
| `headless: true` causes silent failures | Editor SPA requires a real viewport | Set `headless: false` in config |
| Log panel text includes "close" / "Execution log" | UI chrome leaks from DOM walk | Apply `isUiChrome()` filter on captured lines |
| Python verifier times out | Drive file not yet synced locally | Increase `TIMEOUT` in the verifier; ensure Google Drive for Desktop is running |
