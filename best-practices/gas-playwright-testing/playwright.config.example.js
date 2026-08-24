/**
 * playwright.config.example.js — baseline Playwright config for GAS web apps.
 *
 * Copy to playwright.config.js in your project root and adapt as needed.
 * Requires: @playwright/test, clasp (for URL resolution)
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const { execSync } = require('child_process');
const { authStatePath } = require('./playwright-helpers');

/**
 * Resolve the test URL.
 *
 * Priority:
 *   1. TEST_URL environment variable (explicit override)
 *   2. @HEAD deployment from clasp (latest pushed code, no deploy step needed)
 *
 * To use a stable TEST deployment instead of @HEAD, change the line.includes
 * check from '@HEAD' to your deployment description anchor (e.g. 'TEST-WEB-APP')
 * and change the URL suffix from '/dev' to '/exec'.
 */
function getTestUrl() {
  if (process.env.TEST_URL) return process.env.TEST_URL;

  try {
    const output = execSync('clasp deployments', {
      encoding: 'utf8',
      cwd: path.join(__dirname, 'src'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of output.split('\n')) {
      if (line.includes('@HEAD')) {
        const match = line.match(/- (AKfyc[A-Za-z0-9_-]+)/);
        if (match) {
          return `https://script.google.com/macros/s/${match[1]}/dev`;
        }
      }
    }
  } catch (_) {}

  throw new Error(
    'Could not find @HEAD deployment.\n' +
    'Ensure clasp is installed and authenticated, or set TEST_URL explicitly.'
  );
}

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,   // GAS rate-limits concurrent requests
  workers: 1,             // one worker prevents quota exhaustion
  retries: 1,             // one retry handles transient GAS rate-limit errors
  maxFailures: 3,

  globalSetup: path.join(__dirname, 'tests/auth.setup.js'),
  reporter: 'html',

  use: {
    baseURL: getTestUrl(),
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Use authStatePath(), not a hardcoded '.auth/user.json' literal — it honours
    // PLAYWRIGHT_AUTH_STATE, which a CI environment may point outside the repo.
    // See playwright-helpers.js's authStatePath()/getUserFrame() docs for the trap
    // a stale session file falls into (a ~30s beforeAll timeout that looks nothing
    // like an auth problem).
    storageState: authStatePath(__dirname),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
