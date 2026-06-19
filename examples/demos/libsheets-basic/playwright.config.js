'use strict';

/**
 * examples/demos/libsheets-basic/playwright.config.js
 *
 * Minimal Playwright config for the Tier 3 smoke spec (smoke.spec.js). Adapted
 * from best-practices/gas-playwright-testing/playwright.config.example.js, with
 * two deliberate differences for THIS target:
 *
 *  - HEADED, not headless. The target is the live Google Sheets EDITOR (a bound
 *    Sheet), not a doGet web-app iframe. The editor needs a real, headed Chrome;
 *    the example config's headless default does not drive it reliably.
 *  - URL comes from SHEET_URL (the bound Sheet's editor URL), not a clasp
 *    @HEAD deployment — Tier 3 drives the editor UI, not the /exec endpoint.
 *
 * This config is SCOPED to this one demo (testDir is this folder) so it never
 * sweeps up the Tier 1 `node --test` suites elsewhere in the repo. It is a
 * periodic / manual gate; there is no CI wiring for it on purpose.
 *
 * RUN: see the header of smoke.spec.js.
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',

  timeout: 120_000,        // Sheets editor cold-start + onOpen server round-trip
  expect: { timeout: 10_000 },

  fullyParallel: false,    // GAS rate-limits; the bound Sheet is shared state
  workers: 1,              // one worker prevents quota exhaustion
  retries: 1,              // one retry absorbs a transient GAS cold-start blip
  maxFailures: 1,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Captured once via authenticate.js; refresh when runs redirect to sign-in.
    storageState: path.join(__dirname, '.auth/user.json'),
    headless: false,       // the live Sheets editor needs a headed browser
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
