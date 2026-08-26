#!/usr/bin/env node
'use strict';

/**
 * Measures first paint on both front ends — the HtmlService web app and the static page that
 * replaced it — so a project migrating to this pattern has its own before/after number rather than
 * someone else's.
 *
 * Elevated to best-practices/ from PracticeMix's tools/measure-first-paint.js, where it produced
 * the number that justified that migration (PLAN2 F14). It was deliberately NOT elevated at that
 * time: one project's copy is a script, and generalising on a single use invents requirements. It
 * moved here at the second conversion (RankChoiceVoting, bead GAS-Core-d7i), which is when the
 * project-specific parts became visible — the ready selector and the two URLs, now arguments.
 *
 * Deliberately a one-purpose measurement tool, not a benchmark harness: it loads each front end in
 * a cold context and reports what a user on a phone actually waits for.
 *
 *   node measure-first-paint.js --webapp https://…/exec --static https://…/ --ready '[data-testid="selection-page"]'
 *   node measure-first-paint.js --webapp "$TEST_URL" --static https://…/ --ready '#ballot' --runs 5
 *
 * Three numbers per front end, per run:
 *   fcp      first-contentful-paint of the *top-level document* (PerformanceObserver)
 *   appPaint navigationStart → the app's own ready element being visible. On the HtmlService page
 *            that element lives two iframes down, so `fcp` there is Google's sandbox shell
 *            painting, not the app; appPaint is the only metric comparable across both.
 *   bytes    encoded transfer size of every response the page pulled, document included.
 *
 * REQUIREMENTS
 *   @playwright/test in the calling project, and a browser installed (`npx playwright install
 *   chromium`). The webapp URL usually needs a signed-in Google session — point
 *   PLAYWRIGHT_AUTH_STATE at a saved storageState file, or run the webapp side against a
 *   deployment set to ANYONE_ANONYMOUS. The static page deliberately gets no session at all:
 *   needing one is part of what the pattern removes.
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? fallback : process.argv[i + 1];
}

function authStatePath() {
  return path.resolve(process.cwd(), process.env.PLAYWRIGHT_AUTH_STATE || '.auth/user.json');
}

async function measure(browser, { url, authed, label, ready }) {
  const context = await browser.newContext(
    authed && fs.existsSync(authStatePath()) ? { storageState: authStatePath() } : {}
  );
  const page = await context.newPage();

  // CDP, not response headers: the HtmlService payload arrives inside two nested cross-origin
  // iframes, where `content-length` is absent and resource-timing entries report 0. Network
  // domain events count the bytes that actually crossed the wire, whatever frame asked for them.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });

  const started = Date.now();
  await page.goto(url, { waitUntil: 'commit' });

  // The ready element must be markup, not data — something visible as soon as the app's own HTML
  // and CSS have arrived, which is exactly the cost this pattern sets out to remove. Picking an
  // element that waits on a server round trip measures the backend instead of the front end.
  //
  // Which frame it lands in is not known at navigation time (the sandbox iframe is not attached
  // yet on the HtmlService page), so wait for whichever appears; a loser must never settle the race.
  const never = () => new Promise(() => {});
  const direct = page.locator(ready);
  const nested = page.frameLocator('#sandboxFrame').frameLocator('#userHtmlFrame').locator(ready);
  await Promise.race([
    direct.waitFor({ state: 'visible', timeout: 60000 }).catch(never),
    nested.waitFor({ state: 'visible', timeout: 60000 }).catch(never),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: never painted within 60s`)), 60000)),
  ]);
  const appPaint = Date.now() - started;

  // Awaited, not sampled: `appPaint` can land *before* the compositor records a paint entry
  // (Playwright calls an element visible once it has a box), so reading the buffer at that instant
  // reports null on a page that is about to paint in another 200 ms.
  const fcp = await page.evaluate(() => new Promise((resolve) => {
    const found = (list) => list.find((x) => x.name === 'first-contentful-paint');
    const already = found(performance.getEntriesByType('paint'));
    if (already) return resolve(Math.round(already.startTime));
    new PerformanceObserver((list, obs) => {
      const e = found(list.getEntries());
      if (e) { obs.disconnect(); resolve(Math.round(e.startTime)); }
    }).observe({ type: 'paint', buffered: true });
    setTimeout(() => resolve(null), 10000);
  }));

  await context.close();
  return { label, fcp, appPaint, bytes };
}

async function main() {
  const runs = Number(arg('runs', 5));
  const staticUrl = arg('static');
  const webappUrl = arg('webapp', process.env.TEST_URL);
  const ready = arg('ready');
  if (!staticUrl) throw new Error('Pass --static <published page URL>.');
  if (!webappUrl) throw new Error('Pass --webapp <HtmlService /exec URL> or set TEST_URL.');
  if (!ready) throw new Error("Pass --ready <selector> — the app's own first-paint element, e.g. '[data-testid=\"selection-page\"]'.");

  const browser = await chromium.launch();
  const targets = [
    { label: 'HtmlService', url: webappUrl, authed: true, ready },
    { label: 'static', url: staticUrl, authed: false, ready },
  ];
  const results = {};

  for (const t of targets) {
    results[t.label] = [];
    for (let i = 0; i < runs; i++) {
      const r = await measure(browser, t);
      results[t.label].push(r);
      console.log(`${t.label} run ${i + 1}: appPaint=${r.appPaint}ms fcp=${r.fcp}ms bytes=${r.bytes}`);
    }
  }
  await browser.close();

  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log('\n| front end | appPaint median | fcp median | transferred (median) |');
  console.log('|---|---|---|---|');
  for (const label of Object.keys(results)) {
    const rs = results[label];
    // The HtmlService top document reports no paint entry at all: the visible pixels are composited
    // by a cross-origin iframe whose timeline the top frame cannot read. That absence is the reason
    // appPaint — not fcp — is the number the two front ends can be compared on.
    const fcps = rs.map((r) => r.fcp).filter((v) => v != null);
    const fcp = fcps.length ? `${median(fcps)} ms` : 'n/a (cross-origin iframe)';
    console.log(`| ${label} | ${median(rs.map((r) => r.appPaint))} ms | ${fcp} | ${median(rs.map((r) => r.bytes))} B |`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
