# Best Practice: Playwright Testing for Google Apps Script Web Apps

## Overview

Google Apps Script web apps present two challenges for Playwright:

1. **Nested iframes** — GAS wraps every web app in two iframe layers (`#sandboxFrame` → `#userHtmlFrame`). All DOM selectors must target the inner frame.
2. **Google authentication** — The app is served from `script.google.com` and requires a signed-in Google session. Playwright's `storageState` captures and replays auth cookies.

This pattern establishes a repeatable test setup for any GAS web app.

**Provenance:** Extracted from [AudioTrackCombiner](../../../../c-dev/AudioTrackCombiner). Reference files in that project:
- `playwright.config.js` — full working config with URL resolution
- `tests/auth.setup.js` — global setup: auth validation, URL routing check
- `tests/test-utils.js` — `getUserFrame`, `capturePageDiagnostics`, `logDiagnostics`, `captureIframeStructure`
- `tests/1-foundation.spec.js` — example tests navigating the nested iframe structure
- `tests/2-selection-view.spec.js` — example tests using `waitForFolderLoaded`, `navigateToSubfolder`
- `authenticate.js` — interactive auth capture script

---

## Problem

Standard Playwright test patterns assume a directly accessible URL with a flat DOM. GAS web apps break both assumptions: the app is served inside two nested iframes injected by Google's sandbox infrastructure, and the URL requires an active Google session. Without addressing these, `page.locator()` calls find nothing and `page.goto()` redirects to the Google sign-in page.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js** | v16+ |
| **@playwright/test** | `npm install -D @playwright/test` |
| **clasp** | `npm install -g @google/clasp`; required for test URL resolution from `clasp deployments` |
| **Google account** | A Google account with access to the deployed GAS web app |
| **Google Drive for Desktop** | Only required if also using the GAS server logging pattern |
| **GAS webapp config** | `appsscript.json` must have a `webapp` section; `doGet` must call `setXFrameOptionsMode(ALLOWALL)` |

No additional npm packages are needed beyond `@playwright/test`. The helper file (`playwright-helpers.js`) uses only Playwright built-ins.

---

## Architecture

```
Playwright test runner (Node.js)
  │
  ├─ auth.setup.js ──────────────────► captures Google session → .auth/user.json
  │
  ├─ playwright.config.js ───────────► resolves TEST URL from clasp deployments
  │                                    loads storageState for all tests
  │
  └─ *.spec.js
       │
       ├─ page.goto('')            ← hits GAS /exec or /dev URL
       │
       └─ GAS iframe structure:
            page
            └─ #sandboxFrame          (outer GAS container iframe)
                └─ #userHtmlFrame     (your app HTML)
                    └─ your DOM       ← target selectors here
```

---

## How It Works — Key Patterns

### 1. Navigate through nested iframes

```javascript
const { getUserFrame } = require('./test-utils');

test('element is visible', async ({ page }) => {
  await page.goto('', { waitUntil: 'domcontentloaded' });
  const userFrame = await getUserFrame(page);   // resolves both iframes

  const myElement = userFrame.locator('[data-testid="my-button"]');
  await expect(myElement).toBeVisible();
});
```

`getUserFrame` implementation:
```javascript
async function getUserFrame(page) {
  const sandboxFrame = page.frameLocator('#sandboxFrame');
  const userFrame = sandboxFrame.frameLocator('#userHtmlFrame');
  await userFrame.locator('body').waitFor({ state: 'attached', timeout: 10000 });
  return userFrame;
}
```

### 2. Test URL resolution

Tests use the `@HEAD` deployment (latest `clasp push`) for development, or `TEST-WEB-APP` for a stable integration environment:

```javascript
// playwright.config.js
function getTestUrl() {
  if (process.env.TEST_URL) return process.env.TEST_URL;  // explicit override

  // Use @HEAD: always reflects latest push, no deploy step needed
  const output = execSync('clasp deployments', { encoding: 'utf8', cwd: './src' });
  for (const line of output.split('\n')) {
    if (line.includes('@HEAD')) {
      const match = line.match(/- (AKfyc[A-Za-z0-9_-]+)/);
      if (match) return `https://script.google.com/macros/s/${match[1]}/dev`;
    }
  }
  throw new Error('Could not find @HEAD deployment');
}
```

### 3. Authentication setup (run once)

```javascript
// authenticate.js  — run manually: node authenticate.js
const { chromium } = require('@playwright/test');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://accounts.google.com');
// ... wait for user to complete login interactively ...
await context.storageState({ path: '.auth/user.json' });
await browser.close();
```

Auth is then reused by all tests via `storageState` in `playwright.config.js`. Refresh when tests start redirecting to the Google sign-in page (typically every few days).

### 4. Console log capture for debugging

```javascript
test('my test', async ({ page }) => {
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text() }));

  await page.goto('');
  // ... test steps ...

  // On failure, dump console logs
  if (test.info().status !== 'passed') {
    console.log('Console output:', consoleLogs);
  }
});
```

For systematic diagnostics, use the `capturePageDiagnostics` helper (see `playwright-helpers.js`).

### 5. Screenshots on failure

Configure in `playwright.config.js`:

```javascript
use: {
  screenshot: 'only-on-failure',
  trace: 'on-first-retry',
}
```

Screenshots are saved to `test-results/` and linked in the HTML report (`playwright-report/`).

---

## One-Time Project Setup

### appsscript.json — required for iframe embedding

```json
{
  "webapp": {
    "access": "ANYONE",
    "executeAs": "USER_DEPLOYING"
  },
  "runtimeVersion": "V8"
}
```

`setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)` is also required in `doGet`:

```javascript
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

### playwright.config.js — recommended baseline

```javascript
const { authStatePath } = require('./playwright-helpers');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,   // GAS rate-limits concurrent requests
  workers: 1,             // one worker prevents quota exhaustion
  retries: 1,             // one retry for transient GAS rate-limit errors
  maxFailures: 3,
  globalSetup: './tests/auth.setup.js',
  reporter: 'html',
  use: {
    baseURL: getTestUrl(),
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    storageState: authStatePath(__dirname), // honours PLAYWRIGHT_AUTH_STATE — see "The stale .auth/user.json trap" below
  },
});
```

### package.json scripts

```json
{
  "scripts": {
    "auth":  "node authenticate.js",
    "test":  "npx playwright test",
    "report": "npx playwright show-report"
  }
}
```

---

## Authoring Guidelines

| Guideline | Rationale |
|---|---|
| Use `data-testid` attributes on all interactive elements | Decouples tests from CSS class and structural changes |
| Use `.serial` test groups for navigation flows | GAS state is shared; parallel tests interfere |
| Add `console.log` for key state in tests | Makes HTML report readable without re-running |
| Wrap each test in condition-based waits, not `page.waitForTimeout` | Prevents flakiness from variable GAS cold-start time |
| Call `getUserFrame(page)` at the start of each test | The iframe must be resolved fresh — do not cache across tests |

---

## Reusable Files

| File | Purpose |
|---|---|
| `playwright-helpers.js` | `authStatePath`, `getUserFrame`, `capturePageDiagnostics`, `logDiagnostics` |
| `playwright.config.example.js` | Baseline config with URL resolution and auth |
| `auth.setup.js` | Global setup: validates auth freshness, resolves test URL |

**Not yet here:** PracticeMix's `tools/measure-first-paint.js` (5 cold CDP contexts per front end,
counting bytes over `Network.loadingFinished` because the `HtmlService` top document reports no
paint entry at all) is a genuinely reusable first-paint harness, but it's staying project-local until
a second static front end exists to prove the extraction is worth it — see PLAN2 §3 F14/F7 and
`packages/gas-static/README.md` §Provenance. Elevate it at that conversion, not before.

---

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Redirect to `script.google.com/home` | Auth expired | Re-run `node authenticate.js` |
| `#sandboxFrame` not found | `setXFrameOptionsMode` not set | Add `ALLOWALL` in `doGet` |
| Tests pass locally, fail in CI | CI has no Drive for Desktop | Mock GasLogger or skip Drive-dependent assertions in CI |
| Flaky timeouts | GAS cold start (first request after idle) | Increase `timeout` in `playwright.config.js`, or add a warm-up step |

### The stale `.auth/user.json` trap

A hardcoded `'.auth/user.json'` (or any storageState path that doesn't honour
`PLAYWRIGHT_AUTH_STATE`) is a trap: once that session file is stale, **every** route —
including a `cmd=version`-style ping, not just the app's real pages — comes back as a
Google sign-in page. There's no `#userHtmlFrame` for `getUserFrame()` to find, so it
just times out. The failure presents as a **~30 second `beforeAll`/setup timeout that
looks nothing like an authentication problem** — nothing in the failure output mentions
auth, and it's easy to spend a diagnostic session chasing an app bug that isn't there.

Use `authStatePath()` from `playwright-helpers.js` everywhere a storageState path is
needed (`playwright.config.js`'s `use.storageState`, any custom `auth.setup.js`) instead
of a literal path — it resolves `PLAYWRIGHT_AUTH_STATE` the same way in every place that
needs it, honouring a CI environment that points the session file outside the repo.
`getUserFrame()`'s timeout error names this file and the fix directly, so the symptom is
diagnosable from the error message alone rather than requiring this table.

### Scope a `doGet` counter assertion during a dual (static + `HtmlService`) run

If a project runs a static front end and the legacy `HtmlService` page side by side
(e.g. during a migration's parity-testing window — see
`best-practices/gas-static-frontend/README.md`), a server-side `doGet` hit-counter
assertion counts **both** front ends' page loads unless it's scoped to one. An
assertion written before the second front end existed will pass for the wrong reason,
or fail confusingly when both are hit in the same run — scope it (by a query param, a
referrer check, or splitting the counter) before trusting its number.

---

## Triggering Google Docs' link-preview bubble on canvas-rendered links

This pattern applies to **Docs Editor add-ons** (not the web-app iframe sandwich above):
links/chips that an add-on inserts into a Google Doc — e.g. a hyperlinked `AI-N:` token,
a smart chip — are rendered entirely onto a `<canvas>` element
(`.kix-canvas-tile-content`). There is no DOM `<a>`, `<img>`, or chip element to
`locator()` or `.hover()`; selectors like `.kix-canvas-tile-content a` can never match.

**Goal:** confirm a link/chip exists and read its URL (e.g. to assert a `globalId` query
param) without OCR or screenshot diffing.

**Solution — Ctrl+F to place the cursor on the link, no mouse needed:**

```javascript
const DOCS_LINK_BUBBLE_PROBE_JS = `() => {
  const bubble = document.querySelector('#docs-link-bubble.appsElementsLinkPreview');
  if (!bubble) return null;
  const anchor = bubble.querySelector('a[href*="globalId"], [data-url*="globalId"]');
  return {
    cls: bubble.className,
    href: anchor ? anchor.href || null : null,
    dataUrl: anchor ? anchor.getAttribute('data-url') : null
  };
}`;

await page.locator('.kix-appview-editor').click();   // focus the editor
await page.keyboard.press('Control+f');
await page.waitForTimeout(500);
await page.keyboard.type('AI-1:');                    // the link's visible text
await page.waitForTimeout(1000);
await page.keyboard.press('Enter');                   // jump cursor to the match
await page.waitForTimeout(1000);
await page.keyboard.press('Escape');                  // close find bar — cursor now ON the link
await page.waitForTimeout(1000);

const bubble = await page.evaluate(DOCS_LINK_BUBBLE_PROBE_JS);
// bubble.href / bubble.dataUrl now carries the link's full URL, e.g.
// "https://.../action?c=view&globalId=<docId>%2FAI-1"
```

**Why this works:** Google Docs renders `#docs-link-bubble.appsElementsLinkPreview`
(a real DOM element, lazily created on first interaction) whenever the text cursor is
placed ON a link — the same trigger as a human clicking the link once. `Ctrl+F` →
type the link's text → `Enter` moves the cursor to the match; `Escape` closes the find
bar while leaving the cursor on the link, which pops the bubble within ~1s. No
`page.mouse.hover()`, dwell loop, or pixel-coordinate math is required — the whole
sequence is keyboard + `page.evaluate`.

**Distinct from an add-on's own `onLinkPreview` card** (the `CardService` iframe a GAS
add-on renders via `onLinkPreview`): that trigger appears to require a **real human
mouse hover** — `page.mouse.move()` / `.hover({force:true})` does not fire it even with
a dwell/re-arm loop. If you need to test that surface, fall back to a headed,
human-in-the-loop test that polls server-side logs for the `onLinkPreview` call (the
DOM card render can lag the server round trip significantly).

Source: GActionSheet `tests/playwright/probe.test.js` (`chipHover`), GTaskSheet-39jk.
