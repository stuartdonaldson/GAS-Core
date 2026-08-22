'use strict';

/**
 * The config surface lineage A forced (RECOMMENDATION.md Stage 3, GActionSheet).
 *
 * Lineage A differs from lineage B in three ways that the Stage 2 API could not express, and all
 * three are about a project's *existing* runtime and tooling reading what the deploy writes:
 *   - `.clasp.json` carries more than scriptId/rootDir (bound container, GCP project, extension
 *     lists) and regenerating it from two keys would break `clasp push`;
 *   - the version file's key names and the extra per-target fields in it are read by the GAS
 *     runtime by name (BUILD_INFO.buildDate / .webappUrl / .env);
 *   - the deployment's own /exec URL is stamped INTO the version file, so the deployment must be
 *     resolved before the stamp, not after the push;
 *   - the deployment ledger predates the package and has downstream readers.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deploy } = require('../lib/cli.js');
const { buildInfoStamper } = require('../lib/stampers.js');

async function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-lineage-a-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.2.2', build: 4 }), 'utf8');
    fs.writeFileSync(path.join(dir, 'src/Version.js'),
      'var BUILD_INFO = {\n  version: "old",\n  buildDate: "old",\n  webappUrl: "",\n  env: "dev"\n};\n\nfunction getWebAppUrl() { return BUILD_INFO.webappUrl; }\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'local.settings.json'),
      JSON.stringify({ scriptId: 'S1', claspAuth: '/tmp/creds.json', projectId: 'gcp-1' }), 'utf8');
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const DEPLOY_ID = 'AKfycbzVloY3';

function fakeExec(calls) {
  return (cmd, opts) => {
    calls.push({ cmd, opts });
    if (cmd.includes('deployments')) {
      return `- AKfycOTHER @HEAD \n- ${DEPLOY_ID} @460 - TEST-WEB-APP v0.2.2.4\n`;
    }
    return 'Deployed @461.';
  };
}

function baseConfig(dir, overrides = {}) {
  return {
    root: dir,
    rootDir: 'src',
    log: () => {},
    errorLog: () => {},
    verifyOptions: {
      postFn: async () => ({ ok: true, version: '0.2.2.5', target: 'TEST' }),
      sleep: async () => {},
    },
    targets: {
      test: { scriptIdKey: 'scriptId', label: 'TEST', emoji: '🧪', counter: 'build', anchor: 'TEST-WEB-APP' },
    },
    ...overrides,
  };
}

test('claspFields carries the rest of .clasp.json, and can never override the target', async () => {
  await withProject(async (dir) => {
    const calls = [];
    await deploy(baseConfig(dir, {
      exec: fakeExec(calls),
      stamper: buildInfoStamper({ file: 'src/Version.js' }),
      claspFields: (ctx) => ({
        projectId: ctx.settings.projectId,
        parentId: 'DOC1',
        scriptExtensions: ['.js', '.gs'],
        scriptId: 'HIJACKED',
        rootDir: 'hijacked',
      }),
    }), 'test');

    const clasp = JSON.parse(fs.readFileSync(path.join(dir, '.clasp.json'), 'utf8'));
    assert.equal(clasp.scriptId, 'S1', 'the target being deployed wins over claspFields');
    assert.equal(clasp.rootDir, 'src');
    assert.equal(clasp.projectId, 'gcp-1');
    assert.equal(clasp.parentId, 'DOC1');
    assert.deepEqual(clasp.scriptExtensions, ['.js', '.gs']);
  });
});

test('resolveBeforeStamp gives the stamper the deployment /exec URL, and still resolves once', async () => {
  await withProject(async (dir) => {
    const calls = [];
    await deploy(baseConfig(dir, {
      exec: fakeExec(calls),
      resolveBeforeStamp: true,
      stamper: buildInfoStamper({
        file: 'src/Version.js',
        fields: { date: 'buildDate', webAppUrl: 'webappUrl' },
        extraFields: ({ targetKey }) => ({ env: targetKey === 'test' ? 'test' : 'production' }),
      }),
    }), 'test');

    const src = fs.readFileSync(path.join(dir, 'src/Version.js'), 'utf8');
    const literal = JSON.parse(src.match(/BUILD_INFO = (\{[\s\S]*?\n\});/)[1]);
    assert.deepEqual(literal, {
      version: '0.2.2.5',
      buildDate: literal.buildDate,
      target: 'TEST',
      webappUrl: `https://script.google.com/macros/s/${DEPLOY_ID}/exec`,
      env: 'test',
    });
    assert.match(src, /function getWebAppUrl/, 'the rest of the version file survives');

    // The stamp happens before the push, so the pushed source carries the URL.
    const order = calls.map(c => c.cmd);
    const listIdx = order.findIndex(c => c.includes('deployments'));
    const pushIdx = order.findIndex(c => c.includes('push'));
    assert.ok(listIdx < pushIdx, 'resolution runs before the push when resolveBeforeStamp is set');
    assert.equal(order.filter(c => c === 'clasp deployments').length, 1,
      'resolving early must not cost a second deployments round trip');
  });
});

test('ledgerEntry / deployMetadata let a project keep its pre-package record schema', async () => {
  await withProject(async (dir) => {
    await deploy(baseConfig(dir, {
      exec: fakeExec([]),
      stamper: buildInfoStamper({ file: 'src/Version.js' }),
      ledgerEntry: ({ targetKey, revision, deploymentId }) => ({
        timestamp: '2026-08-22T00:00:00.000Z',
        target: targetKey,
        deploymentId,
        version: `@${revision}`,
        description: 'TEST-WEB-APP v0.2.2.5',
        url: `https://script.google.com/macros/s/${deploymentId}/exec`,
      }),
      deployMetadata: ({ deploymentId, revision }) => ({ deploymentId, version: `@${revision}`, target: 'TEST' }),
    }), 'test');

    const line = JSON.parse(fs.readFileSync(path.join(dir, 'deployment-ledger/test.jsonl'), 'utf8').trim());
    assert.deepEqual(Object.keys(line), ['timestamp', 'target', 'deploymentId', 'version', 'description', 'url'],
      'no package keys (at/user) are added to a consumer-shaped record');
    assert.equal(line.version, '@461');

    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.deploy-metadata.json'), 'utf8'));
    assert.deepEqual(Object.keys(meta), ['deploymentId', 'version', 'target']);
  });
});

test('the default record shape is unchanged when no shaper is configured', async () => {
  await withProject(async (dir) => {
    await deploy(baseConfig(dir, {
      exec: fakeExec([]),
      stamper: buildInfoStamper({ file: 'src/Version.js' }),
    }), 'test');
    const line = JSON.parse(fs.readFileSync(path.join(dir, 'deployment-ledger/test.jsonl'), 'utf8').trim());
    assert.ok(line.at && line.user, 'the package still stamps its own records');
    assert.equal(line.version, '0.2.2.5');
  });
});

test('buildInfoStamper: extraFields as a function sees the target, fields renames keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-stamp-'));
  try {
    fs.writeFileSync(path.join(dir, 'V.js'), 'var BUILD_INFO = {\n  "version": "0"\n};\n', 'utf8');
    buildInfoStamper({
      file: 'V.js',
      fields: { date: 'buildDate', webAppUrl: 'webappUrl' },
      extraFields: ({ label }) => ({ env: label === 'PRODUCTION' ? 'production' : 'test' }),
    })({ root: dir, label: 'PRODUCTION', version: '1.0.0', now: 'NOW', webAppUrl: 'https://x/exec', log: () => {} });

    const literal = JSON.parse(fs.readFileSync(path.join(dir, 'V.js'), 'utf8').match(/BUILD_INFO = (\{[\s\S]*?\n\});/)[1]);
    assert.deepEqual(literal, {
      version: '1.0.0', buildDate: 'NOW', target: 'PRODUCTION',
      webappUrl: 'https://x/exec', env: 'production',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
