'use strict';

/**
 * examples/demos/libsheets-basic/smoke.spec.js
 *
 * Tier 3 (UI-level) Playwright SMOKE spec for the `libsheets-basic` demo
 * (docs/test-harness-design.md §4.5 / phasing step 8). It reuses the patterns
 * in best-practices/gas-playwright-testing — auth via Playwright `storageState`,
 * condition-based waits over fixed sleeps, one worker (GAS rate-limits), and a
 * non-headless run because the Google Sheets editor needs a real browser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS TIER ADDS OVER TIER 2.
 * ─────────────────────────────────────────────────────────────────────────
 * Tier 2 (acceptance.test.js) drives the demo via its `doGet()` HTTP route — a
 * call-site that never exercises the editor chrome. Tier 3 drives the SAME demo
 * the way a human does: it opens the BOUND Google Sheet, waits for the harness
 * `onOpen()` menu to render ("Demos" → "LibSheets: Sheet Management Demo"),
 * clicks the menu item, and asserts the demo executed by checking its visible
 * side effect — the sheet tabs the demo creates ("Demo Sheet",
 * "Demo Sheet asheaders", "Demo Sheet asnames"). Only Tier 3 can catch
 * menu-binding regressions, an `onOpen` that throws, an unauthorized-scope
 * prompt, or a demo whose result never reaches the editor UI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS A PERIODIC / MANUAL GATE — NOT A DEFAULT PR GATE.
 * ─────────────────────────────────────────────────────────────────────────
 * Browser automation against the live Sheets editor (inside Google's nested
 * iframes, subject to GAS cold-start and editor-version drift) is the slowest
 * and most brittle tier (docs/test-harness-design.md §4.5, "not a default
 * gate"). Run it before a UI-heavy release or on a periodic smoke schedule —
 * NOT on every PR. The Tier 1 (`node --test`) and Tier 2 (`doGet`) gates remain
 * the per-PR / per-tag bars.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PREREQUISITES (all manual — see RUN below).
 * ─────────────────────────────────────────────────────────────────────────
 *  1. The libsheets-basic demo is pushed to its bound test Sheet
 *     (`bash scripts/push-demo.sh libsheets-basic`) and the editor reloaded so
 *     the harness `onOpen()` menu is current.
 *  2. A Google session is captured to `.auth/user.json` (one-time, interactive)
 *     for the account that owns / can edit that bound Sheet.
 *  3. SHEET_URL points at the bound Sheet's editor URL
 *     (`https://docs.google.com/spreadsheets/d/<id>/edit`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RUN.
 * ─────────────────────────────────────────────────────────────────────────
 *   # one-time: capture a Google session (headed; sign in when the window opens)
 *   node examples/demos/libsheets-basic/authenticate.js
 *
 *   # run the smoke spec (headed — the Sheets editor needs a real browser)
 *   SHEET_URL='https://docs.google.com/spreadsheets/d/<id>/edit' \
 *     npx playwright test --config examples/demos/libsheets-basic/playwright.config.js
 *
 * If SHEET_URL is unset the spec SKIPS (so an `npx playwright test` sweep with
 * no live infra is a no-op, never a failure) — mirroring how the Tier 2
 * acceptance suite skips its LIVE mode without HARNESS_EXEC_URL.
 */

const { test, expect } = require('@playwright/test');

const SHEET_URL = process.env.SHEET_URL;

const MENU_NAME = 'Demos';
const DEMO_ITEM = 'LibSheets: Sheet Management Demo';

// Visible side effect of libSheets_sheetManagementDemo(): the sheet tabs it
// creates. Asserting on these proves the menu click actually ran the demo,
// not merely that the menu item exists (libs/LibSheets/libSheetsDemo.js).
const EXPECTED_TABS = ['Demo Sheet', 'Demo Sheet asheaders', 'Demo Sheet asnames'];

test.describe('libsheets-basic — Tier 3 UI smoke (deployed bound Sheet)', () => {
  test.skip(!SHEET_URL, 'Set SHEET_URL to the bound Sheet editor URL to run the Tier 3 smoke spec.');

  // GAS editor is slow to load + onOpen runs on the server; give it room.
  test.setTimeout(120_000);

  test('LibSheets: menu click executes the Sheet Management demo', async ({ page }) => {
    // 1. Open the bound Sheet editor (NOT a doGet iframe — the real editor).
    await page.goto(SHEET_URL, { waitUntil: 'domcontentloaded' });

    // If auth lapsed, Google bounces us to a sign-in page instead of the editor.
    if (/accounts\.google\.com/.test(page.url())) {
      throw new Error(
        'Redirected to Google sign-in — the captured session in .auth/user.json ' +
        'has expired. Re-run: node examples/demos/libsheets-basic/authenticate.js'
      );
    }

    // 2. Wait for the editor menubar, then the harness onOpen() "Demos" menu.
    //    onOpen runs server-side on load, so the menu can lag the menubar by a
    //    few seconds on a cold start — wait on the menu item, not a fixed sleep.
    await page.locator('#docs-menubar').waitFor({ state: 'visible', timeout: 60_000 });

    const demosMenu = page.getByRole('menuitem', { name: MENU_NAME });
    await expect(demosMenu, `harness onOpen() "${MENU_NAME}" menu never appeared`)
      .toBeVisible({ timeout: 60_000 });

    // 3. Open the menu and click the demo item.
    await demosMenu.click();
    const demoItem = page.getByText(DEMO_ITEM, { exact: true });
    await expect(demoItem, `menu item "${DEMO_ITEM}" not found under "${MENU_NAME}"`)
      .toBeVisible({ timeout: 10_000 });
    await demoItem.click();

    // 4. Assert the demo executed by its visible side effect: the sheet tabs it
    //    creates. The demo flushes before returning (gas-acceptance-testing),
    //    so the tabs appear once the server round-trip completes — poll the tab
    //    strip rather than sleeping a fixed interval.
    for (const tab of EXPECTED_TABS) {
      const tabEl = page.getByRole('tab', { name: new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      await expect(tabEl, `demo did not create the "${tab}" tab — menu click may not have run the demo`)
        .toBeVisible({ timeout: 30_000 });
    }
  });
});
