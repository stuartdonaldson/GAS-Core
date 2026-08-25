'use strict';

const fs = require('fs');
const path = require('path');
const { stampSource_ } = require('./stamp.js');
const { readBuildInfo_ } = require('./buildInfo.js');

const VERSION_PLACEHOLDER = 'var STATIC_BUILD_VERSION_ = null;';
const WEBAPP_PLACEHOLDER = 'var STATIC_WEBAPP_URL_ = null;';

function envDefFor_(config, envKey) {
  const envDef = config.envs && config.envs[envKey];
  if (!envDef) throw new Error(`gas-static: unknown env '${envKey}'`);
  return envDef;
}

/**
 * Resolves {version, webappUrl} for one env from BUILD_INFO, and asserts env agreement:
 * BUILD_INFO's env field must match the deploy target this env is declared to publish. This is
 * the guard only one of the three pre-package copies had (GActionSheet) — it is what prevents
 * publishing a page pointed at last deploy's URL. Throws before anything is written.
 */
function resolveWebappUrl_(config, envKey) {
  const spec = config.webappUrl;
  if (!spec || spec.from !== 'buildInfo') {
    throw new Error(`gas-static: config.webappUrl.from must be 'buildInfo' (got ${spec && spec.from})`);
  }
  const envDef = envDefFor_(config, envKey);
  const filePath = path.join(config.root, spec.file);
  const buildInfo = readBuildInfo_(filePath);
  const envField = spec.envField || 'env';

  if (buildInfo[envField] !== envDef.deployTarget) {
    throw new Error(
      `gas-static: ${spec.file} is currently stamped for ${envField}="${buildInfo[envField]}", ` +
      `not "${envDef.deployTarget}" (needed for env '${envKey}'). Deploy that target first so ` +
      `${spec.file} reflects the deployment this build is meant to publish.`
    );
  }
  if (!buildInfo.webappUrl) {
    throw new Error(`gas-static: ${spec.file} has no webappUrl stamped yet.`);
  }
  return { webappUrl: buildInfo.webappUrl, version: buildInfo.version };
}

function listStampedPages_(config) {
  if (config.stampedPages) return config.stampedPages;
  const srcRoot = path.join(config.root, config.srcDir);
  return fs.readdirSync(srcRoot).filter((f) => f.endsWith('.html'));
}

function copyRecursive_(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      copyRecursive_(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyOthers_(config, stampedPages, outDir) {
  if (config.copyAssets === false) return;
  const srcRoot = path.join(config.root, config.srcDir);
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (stampedPages.includes(entry.name)) continue;
    copyRecursive_(path.join(srcRoot, entry.name), path.join(outDir, entry.name));
  }
}

/**
 * Builds one env's dist/ output: stamps every page in `stampedPages` (default: every .html at
 * srcDir's root), copies everything else under srcDir verbatim, and writes the version.json
 * companion — the only thing `assertPublishedBuild` reads. No bundler, no framework, no page
 * templating: this owns the pipeline, never the page (README, "What this package deliberately
 * does not do").
 */
function buildEnv(config, envKey) {
  const envDef = envDefFor_(config, envKey);
  // Resolve + assert BEFORE touching the filesystem — env-agreement mismatch must write nothing.
  const { webappUrl, version } = resolveWebappUrl_(config, envKey);

  const ctx = { env: envKey, envDef, version, webappUrl };
  const placeholders = {
    [VERSION_PLACEHOLDER]: `var STATIC_BUILD_VERSION_ = ${JSON.stringify(version)};`,
    [WEBAPP_PLACEHOLDER]: `var STATIC_WEBAPP_URL_ = ${JSON.stringify(webappUrl)};`,
  };
  for (const [token, fn] of Object.entries(config.placeholders || {})) {
    placeholders[token] = String(fn(ctx));
  }

  const srcRoot = path.join(config.root, config.srcDir);
  const outDir = path.join(config.root, config.distDir, envKey);
  const stampedPages = listStampedPages_(config);

  // Stamp into memory first — a missing placeholder in ANY page must still write nothing.
  const stamped = stampedPages.map((pageName) => {
    const src = fs.readFileSync(path.join(srcRoot, pageName), 'utf8');
    const out = stampSource_(src, placeholders, { label: `${config.srcDir}/${pageName}` });
    return { pageName, out };
  });

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const { pageName, out } of stamped) {
    fs.writeFileSync(path.join(outDir, pageName), out, 'utf8');
  }
  copyOthers_(config, stampedPages, outDir);

  const builtAt = new Date().toISOString();
  const versionJson = { version, env: envKey, webappUrl, builtAt };
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(versionJson), 'utf8');

  return { outDir, version, webappUrl, env: envKey, builtAt };
}

module.exports = { buildEnv, resolveWebappUrl_, listStampedPages_ };
