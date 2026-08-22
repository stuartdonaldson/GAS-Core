'use strict';

/**
 * The package's structural invariants (RECOMMENDATION.md §3). These are not behaviour tests —
 * they assert that the *shape* of the code cannot regress into the drift the package exists to
 * remove. Each one names the finding it kills.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG_ROOT = path.join(__dirname, '..');
const SOURCES = ['index.js', ...fs.readdirSync(path.join(PKG_ROOT, 'lib')).map(f => path.join('lib', f)),
  ...fs.readdirSync(path.join(PKG_ROOT, 'bin')).map(f => path.join('bin', f))];

function read(rel) { return fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8'); }
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
}

test('#1: no clasp invocation anywhere without an env carrying clasp_config_auth', () => {
  const { deploy } = require('../lib/cli.js');
  const calls = [];
  const fakeExec = (cmd, opts) => { calls.push({ cmd, opts }); return cmd.includes('deployments') ? '- AKfycA @5 - d' : 'Deployed @6.'; };

  // A full deploy against a temp project, with every clasp call captured.
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-inv-'));
  try {
    fs.mkdirSync(path.join(dir, 'script'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', build: 0 }), 'utf8');
    fs.writeFileSync(path.join(dir, 'script/version.js'), "const APP_VERSION = '0';\n", 'utf8');
    fs.writeFileSync(path.join(dir, 'local.settings.json'),
      JSON.stringify({ testScriptId: 'S1', claspAuth: '/tmp/creds.json', testDeploymentId: 'AKfycA' }), 'utf8');

    const { constStamper } = require('../lib/stampers.js');
    return deploy({
      root: dir,
      stamper: constStamper({ file: 'script/version.js' }),
      exec: fakeExec,
      log: () => {}, errorLog: () => {},
      verifyOptions: { postFn: async () => ({ ok: true, version: '1.0.0.1', target: 'TEST' }), sleep: async () => {} },
      targets: { test: { scriptIdKey: 'testScriptId', label: 'TEST', counter: 'build', deploymentIdKey: 'testDeploymentId', sheetIdKey: 'testSheetId' } },
    }, 'test').then(() => {
      const claspCalls = calls.filter(c => c.cmd.startsWith('clasp'));
      assert.ok(claspCalls.length >= 3, 'push, deployments and deploy all ran');
      for (const c of claspCalls) {
        assert.ok(c.opts && c.opts.env && c.opts.env.clasp_config_auth,
          `bare clasp invocation would fall back to ~/.clasprc.json: ${c.cmd}`);
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#5: the package never reads a version back out of a stamped file', () => {
  for (const rel of SOURCES) {
    const src = stripComments(read(rel));
    assert.doesNotMatch(src, /APP_VERSION\s*\\?s\*=\s*\\?'/, `${rel} parses a stamped version back out`);
    assert.doesNotMatch(src, /getVersionFromBuildInfo/, `${rel} reintroduces the source-of-truth inversion`);
    assert.doesNotMatch(src, /BUILD_INFO\s*\.\s*version/, `${rel} reads BUILD_INFO.version back`);
  }
});

test('the package never shells out to npm or pnpm', () => {
  for (const rel of SOURCES) {
    const src = stripComments(read(rel));
    assert.doesNotMatch(src, /['"`]\s*(npm|pnpm|npx)\s/, `${rel} shells out to a package manager`);
  }
});

test('the package never creates a deployment — a new URL is always a human decision', () => {
  for (const rel of SOURCES) {
    const src = stripComments(read(rel));
    // `clasp deploy` WITHOUT --deploymentId creates a new one. Every call must pin an id.
    const matches = src.match(/clasp deploy(?!ments)[^`'"]*/g) || [];
    for (const m of matches) {
      assert.match(m, /--deploymentId/, `${rel}: "${m.trim()}" would create a new deployment`);
    }
  }
});

test('assertDeployedVersion is reached unconditionally by deploy() — no skip flag exists', () => {
  const src = stripComments(read('lib/cli.js'));
  assert.match(src, /await assertDeployedVersion\(/);
  assert.doesNotMatch(src, /skipVerify|noVerify|skip-verify/, 'a skip switch would defeat §3.2');
});

test('printDeploySummary is the final step on BOTH the success and failure paths', () => {
  const src = read('lib/cli.js');
  const deployBody = src.slice(src.indexOf('async function deploy('), src.indexOf('async function summary('));
  assert.equal((deployBody.match(/printDeploySummary\(/g) || []).length, 2,
    'one summary for the verified path, one for the verification-failed path');
});
