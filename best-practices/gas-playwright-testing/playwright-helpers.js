/**
 * Playwright helpers for Google Apps Script web apps.
 *
 * Extracted from AudioTrackCombiner/tests/test-utils.js for reuse.
 * Drop this file into your tests/ directory.
 *
 * Usage:
 *   const { getUserFrame, capturePageDiagnostics, logDiagnostics } = require('./playwright-helpers');
 */

/**
 * Resolve the nested iframe structure of a Google Apps Script web app.
 *
 * GAS wraps every web app in two iframes:
 *   page → #sandboxFrame → #userHtmlFrame → your app HTML
 *
 * Call this at the start of each test after page.goto().
 *
 * @param {import('@playwright/test').Page} page
 * @returns {import('@playwright/test').FrameLocator}
 */
async function getUserFrame(page) {
  const sandboxFrame = page.frameLocator('#sandboxFrame');
  const userFrame = sandboxFrame.frameLocator('#userHtmlFrame');
  await userFrame.locator('body').waitFor({ state: 'attached', timeout: 10000 });
  return userFrame;
}

/**
 * Capture a structured snapshot of page state for debugging test failures.
 *
 * Attaches console message listener — call this BEFORE page.goto() if you
 * want to capture console output from the initial page load.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [label]  - Optional label for the diagnostics report
 * @returns {object}  Diagnostics object with url, title, console, testIds, etc.
 */
async function capturePageDiagnostics(page, label = '') {
  const diagnostics = {
    label,
    timestamp: new Date().toISOString(),
    url: page.url(),
    title: await page.title(),
    console: [],
    errors: [],
    sections: 0,
    testIds: [],
    bodyHtmlLength: 0,
    bodyHtml: '',
    hasSelectionPage: false,
    hasWarningBanner: false,
  };

  page.on('console', msg => {
    diagnostics.console.push({ type: msg.type(), text: msg.text() });
  });

  page.on('pageerror', error => {
    diagnostics.errors.push(error.toString());
  });

  diagnostics.sections = await page.locator('section').count();

  diagnostics.testIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]')).map(el => ({
      testid: el.getAttribute('data-testid'),
      tag: el.tagName.toLowerCase(),
      visible: el.offsetParent !== null,
      classes: el.className,
    }))
  );

  diagnostics.bodyHtmlLength = await page.evaluate(() => document.body.innerHTML.length);
  diagnostics.bodyHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));

  return diagnostics;
}

/**
 * Log diagnostics in a human-readable format to the test console.
 *
 * @param {object} diag  - Output from capturePageDiagnostics()
 */
function logDiagnostics(diag) {
  console.log('\n' + '='.repeat(70));
  console.log(`Page Diagnostics${diag.label ? ` — ${diag.label}` : ''}`);
  console.log('='.repeat(70));
  console.log(`Timestamp:  ${diag.timestamp}`);
  console.log(`URL:        ${diag.url}`);
  console.log(`Title:      ${diag.title}`);
  console.log(`Sections:   ${diag.sections}`);
  console.log(`Test IDs:   ${diag.testIds.length}`);
  console.log(`HTML length: ${diag.bodyHtmlLength} chars`);

  if (diag.testIds.length > 0) {
    console.log('\nTest IDs present:');
    diag.testIds.forEach(id => {
      const v = id.visible ? '✓' : '✗';
      console.log(`  ${v} [${id.testid}] <${id.tag}>${id.classes ? ` (${id.classes})` : ''}`);
    });
  } else {
    console.log('\n  WARNING: No elements with data-testid found');
  }

  if (diag.errors.length > 0) {
    console.log('\nPage errors:');
    diag.errors.forEach(err => console.log(`  ERROR: ${err}`));
  }

  if (diag.console.length > 0) {
    console.log('\nConsole messages:');
    diag.console.forEach(msg => {
      const icon = msg.type === 'error' ? 'ERR' : msg.type === 'warning' ? 'WRN' : 'INF';
      console.log(`  [${icon}] ${msg.text}`);
    });
  }

  console.log('\nHTML preview (first 500 chars):');
  console.log(`  ${diag.bodyHtml.substring(0, 500)}`);
  console.log('='.repeat(70) + '\n');
}

/**
 * Inspect the Google Apps Script iframe structure for debugging embedding issues.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {object}
 */
async function captureIframeStructure(page) {
  const iframeCount = await page.evaluate(() => document.querySelectorAll('iframe').length);
  const sandboxFrame = page.locator('#sandboxFrame');
  const sandboxPresent = (await sandboxFrame.count()) > 0;

  let userHtmlPresent = false;
  if (sandboxPresent) {
    const userFrame = page.frameLocator('#sandboxFrame').frameLocator('#userHtmlFrame');
    userHtmlPresent = (await userFrame.locator('body').count()) > 0;
  }

  return { iframeCount, sandboxPresent, userHtmlPresent };
}

module.exports = { getUserFrame, capturePageDiagnostics, logDiagnostics, captureIframeStructure };
