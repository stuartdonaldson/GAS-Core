'use strict';

/**
 * The two-file declared-config split — adr/0002 as narrowed by adr/0004.
 *
 * Project truth (the same for every developer: a target's scriptId, its sheetId) lives in a
 * COMMITTED `gas-project.json`, keyed structurally by target key. Machine truth and secrets
 * (clasp auth, admin secrets, the deployment-ID cache) stay in the gitignored
 * `local.settings.json`. The `*Key` indirection into local.settings.json remains supported as a
 * legacy override so an unmigrated project is untouched.
 *
 * The failure this exists to remove is named in ADR-0002 §Context: project constants re-entered on
 * every machine, never reviewed, drifting silently between developers. So the tests below assert
 * two things beyond plain lookup — that a migrated project keeps working when local.settings.json
 * does NOT carry the constant at all, and that the two files disagreeing is surfaced rather than
 * silently resolved. ADR-0002 §Consequences requires the other direction too: an env declared in
 * gas-project.json with no matching secret in local.settings.json must fail loudly and BY NAME,
 * or the split has traded silent drift for silent absence.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deploy, summary } = require('../lib/cli.js');
const { constStamper } = require('../lib/stampers.js');

const DEPLOY_ID = 'AKfycbzVloY3';

/**
 * A project tree with the pieces every case here varies: `settings` is written verbatim as
 * local.settings.json, `project` (when supplied) as gas-project.json. Same mkdtemp shape as the
 * other test files in this package — each builds its own, which is the convention here.
 */
async function withProject({ settings, project, projectRaw }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-deploy-projcfg-'));
  try {
    fs.mkdirSync(path.join(dir, 'script'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.1.6', build: 4 }), 'utf8');
    fs.writeFileSync(path.join(dir, 'script/version.js'),
      "const APP_VERSION = 'old';\nconst APP_VERSION_DATE = 'old';\nconst APP_DEPLOY_TARGET = 'old';\n", 'utf8');
    fs.writeFileSync(path.join(dir, 'local.settings.json'), JSON.stringify(settings), 'utf8');
    if (projectRaw !== undefined) {
      fs.writeFileSync(path.join(dir, 'gas-project.json'), projectRaw, 'utf8');
    } else if (project) {
      fs.writeFileSync(path.join(dir, 'gas-project.json'), JSON.stringify(project), 'utf8');
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fakeExec() {
  return (cmd) => {
    if (cmd.includes('deployments')) return `- ${DEPLOY_ID} @460 - v0.1.6.4 RCV\n`;
    return 'Deployed @461.';
  };
}

function baseConfig(dir, overrides = {}) {
  const logs = [];
  return {
    config: {
      root: dir,
      log: (m) => logs.push(String(m)),
      errorLog: (m) => logs.push(String(m)),
      exec: fakeExec(),
      stamper: constStamper({ file: 'script/version.js' }),
      verifyOptions: {
        postFn: async () => ({ ok: true, version: '0.1.6.5', target: 'SIT' }),
        sleep: async () => {},
      },
      targets: {
        sit: { scriptIdKey: 'sitScriptId', sheetIdKey: 'sitSheetId', label: 'SIT', counter: 'build' },
      },
      ...overrides,
    },
    logs,
  };
}

// ── The migrated shape ────────────────────────────────────────────────────────

test('a migrated project deploys with the scriptId in gas-project.json and NOT in local.settings.json', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json' },
    project: { envs: { sit: { scriptId: 'S-FROM-PROJECT', sheetId: 'SHEET-1' } } },
  }, async (dir) => {
    const { config, logs } = baseConfig(dir);
    const result = await deploy(config, 'sit');
    assert.equal(result.ok, true);
    // The constant is never re-entered per machine: local.settings.json has no sitScriptId at all.
    assert.ok(logs.some((l) => l.includes('S-FROM-PROJE')),
      `expected the project-declared scriptId in the log, got:\n${logs.join('\n')}`);
  });
});

test('sheetId resolves from gas-project.json and reaches the deploy summary', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json' },
    project: { envs: { sit: { scriptId: 'S1', sheetId: 'SHEET-FROM-PROJECT' } } },
  }, async (dir) => {
    const { config, logs } = baseConfig(dir);
    await deploy(config, 'sit');
    assert.ok(logs.some((l) => l.includes('SHEET-FROM-PROJECT')),
      `expected the project-declared sheetId in the summary, got:\n${logs.join('\n')}`);
  });
});

// ── Back-compat: an unmigrated project must be untouched ──────────────────────

test('with no gas-project.json, the legacy *Key indirection into local.settings.json still resolves', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json', sitScriptId: 'S-FROM-SETTINGS', sitSheetId: 'SHEET-LEGACY' },
  }, async (dir) => {
    const { config, logs } = baseConfig(dir);
    const result = await deploy(config, 'sit');
    assert.equal(result.ok, true);
    assert.ok(logs.some((l) => l.includes('S-FROM-SETT')), 'legacy scriptId should still resolve');
    assert.ok(logs.some((l) => l.includes('SHEET-LEGACY')), 'legacy sheetId should still resolve');
  });
});

test('gas-project.json that declares the env but not the fact falls back to the legacy key', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json', sitSheetId: 'SHEET-LEGACY' },
    project: { envs: { sit: { scriptId: 'S1' } } },
  }, async (dir) => {
    const { config, logs } = baseConfig(dir);
    await deploy(config, 'sit');
    assert.ok(logs.some((l) => l.includes('SHEET-LEGACY')),
      'a fact absent from gas-project.json must still resolve from local.settings.json');
  });
});

// ── The two files disagreeing ─────────────────────────────────────────────────

test('project truth wins over a stale local.settings.json copy, and the drift is reported by name', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json', sitScriptId: 'S-STALE' },
    project: { envs: { sit: { scriptId: 'S-CANONICAL' } } },
  }, async (dir) => {
    const { config, logs } = baseConfig(dir);
    await deploy(config, 'sit');
    assert.ok(logs.some((l) => l.includes('S-CANONICAL')), 'gas-project.json is authoritative for project truth');
    const drift = logs.find((l) => l.includes('sitScriptId') && l.includes('gas-project.json'));
    assert.ok(drift, `expected a drift warning naming both sources, got:\n${logs.join('\n')}`);
  });
});

// ── Silent absence — ADR-0002 §Consequences ───────────────────────────────────

test('an env declared in gas-project.json with no clasp auth in local.settings.json fails by name', async () => {
  await withProject({
    settings: {},
    project: { envs: { nuuc: { scriptId: 'S-NUUC' } } },
  }, async (dir) => {
    const { config } = baseConfig(dir, {
      targets: { nuuc: { scriptIdKey: 'nuucScriptId', label: 'NUUC', counter: 'version', authKey: 'nuucAuth' } },
    });
    await assert.rejects(() => deploy(config, 'nuuc'), (err) => {
      assert.match(err.message, /nuucAuth/, 'must name the missing key');
      assert.match(err.message, /gas-project\.json/, 'must say the env is declared in the committed half');
      assert.match(err.message, /local\.settings\.json/, 'must say where the secret belongs');
      return true;
    });
  });
});

test('a target with no entry in a gas-project.json that has an envs block fails, listing what is declared', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json' },
    project: { envs: { prod: { scriptId: 'S-PROD' } } },
  }, async (dir) => {
    const { config } = baseConfig(dir);
    await assert.rejects(() => deploy(config, 'sit'), (err) => {
      assert.match(err.message, /gas-project\.json/);
      assert.match(err.message, /\bsit\b/, 'must name the target that is missing');
      assert.match(err.message, /prod/, 'must list the envs that ARE declared');
      return true;
    });
  });
});

test('a scriptId in neither file names both files, not just local.settings.json', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json' },
    project: { envs: { sit: { sheetId: 'SHEET-1' } } },
  }, async (dir) => {
    const { config } = baseConfig(dir);
    await assert.rejects(() => deploy(config, 'sit'), (err) => {
      assert.match(err.message, /sitScriptId/);
      assert.match(err.message, /gas-project\.json/);
      return true;
    });
  });
});

// ── Malformed input ───────────────────────────────────────────────────────────

test('a malformed gas-project.json is a named config error, not a JSON parse crash', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json', sitScriptId: 'S1' },
    projectRaw: '{ "envs": { "sit": ',
  }, async (dir) => {
    const { config } = baseConfig(dir);
    await assert.rejects(() => deploy(config, 'sit'), (err) => {
      assert.match(err.message, /gas-project\.json/);
      assert.doesNotMatch(err.message, /^Unexpected end of JSON/, 'the raw parser error is not a usable message');
      return true;
    });
  });
});

// ── Read-only path ────────────────────────────────────────────────────────────

test('--summary resolves project truth the same way the deploy path does', async () => {
  await withProject({
    settings: { claspAuth: '/tmp/creds.json' },
    project: { envs: { sit: { scriptId: 'S-FROM-PROJECT', sheetId: 'SHEET-FROM-PROJECT' } } },
  }, async (dir) => {
    const { config, logs } = baseConfig(dir, {
      verifyOptions: { postFn: async () => null, sleep: async () => {} },
    });
    await summary(config, 'sit');
    assert.ok(logs.some((l) => l.includes('SHEET-FROM-PROJECT')),
      `summary must read the same source as deploy, got:\n${logs.join('\n')}`);
  });
});
