'use strict';

/**
 * examples/demos/libsheets-basic/authenticate.js
 *
 * One-time interactive Google sign-in capture for the Tier 3 smoke spec
 * (smoke.spec.js). Adapted from best-practices/gas-playwright-testing
 * (§"Authentication setup"). Opens a headed Chrome, lets you sign in to the
 * Google account that can edit the bound test Sheet, then saves the session to
 * `.auth/user.json` for Playwright to replay via `storageState`.
 *
 * RUN:  node examples/demos/libsheets-basic/authenticate.js
 *
 * Re-run when a smoke run reports a redirect to accounts.google.com (the
 * captured session typically lasts a few days). `.auth/user.json` contains a
 * live Google session — it is git-ignored and MUST NOT be committed.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const AUTH_DIR = path.join(__dirname, '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');

// Land on the bound Sheet if given (so the saved session is already scoped to
// it); otherwise just the Google account chooser.
const LANDING_URL = process.env.SHEET_URL || 'https://accounts.google.com';

(async () => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LANDING_URL);

  console.log('\n=== Tier 3 auth capture ===');
  console.log('A browser window has opened. Sign in to the Google account that');
  console.log('can edit the bound libsheets-basic test Sheet.');
  console.log('When you can see the Sheet (or your signed-in Google home),');
  console.log('return here and press Enter to save the session.\n');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  await context.storageState({ path: AUTH_FILE });
  console.log(`Saved Google session to ${AUTH_FILE}`);

  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error('Auth capture failed:', err);
  process.exit(1);
});
