'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { publishEnv } = require('../lib/publish.js');

function makeProject_({ withSettings = true, repoPath = null, initGitRepo = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-pub-'));
  fs.mkdirSync(path.join(root, 'static-pages', 'dist', 'sit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'static-pages', 'dist', 'sit', 'index.html'), '<div>built</div>');
  fs.writeFileSync(path.join(root, 'static-pages', 'dist', 'sit', 'version.json'), '{"version":"1.0.0"}');

  const settings = {};
  if (repoPath) settings.staticRepoPath = repoPath;
  if (withSettings) fs.writeFileSync(path.join(root, 'local.settings.json'), JSON.stringify(settings));

  let repoRoot = null;
  if (initGitRepo) {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-repo-'));
    fs.mkdirSync(path.join(repoRoot, '.git'));
  }
  return { root, repoRoot };
}

function baseConfig_(root, repoRoot) {
  return {
    root,
    distDir: 'static-pages/dist',
    envs: {
      sit: { deployTarget: 'test', repoKey: 'staticRepoPath', dest: 'pub/app-sit', label: 'SIT' },
    },
  };
}

test('missing repo path warns and returns skipped, not thrown', async () => {
  const { root } = makeProject_({ withSettings: true, repoPath: null });
  const config = baseConfig_(root);
  const warnings = [];

  const result = await publishEnv(config, 'sit', { warn: (m) => warnings.push(m) });

  assert.deepEqual(result, { skipped: true, reason: 'no-repo-path' });
  assert.ok(warnings[0].includes('staticRepoPath is not set'));
});

test('non-git repo path throws', async () => {
  const bogusRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-nogit-'));
  const { root } = makeProject_({ repoPath: bogusRepo });
  const config = baseConfig_(root);

  await assert.rejects(() => publishEnv(config, 'sit'), /does not look like a git checkout/);
});

test('git add/status are scoped to dest, not an unscoped add', async () => {
  const { root, repoRoot } = makeProject_({ repoPath: null, initGitRepo: true });
  fs.writeFileSync(path.join(root, 'local.settings.json'), JSON.stringify({ staticRepoPath: repoRoot }));
  const config = baseConfig_(root);

  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === 'status') return Buffer.from(' M pub/app-sit/index.html\n');
    return Buffer.from('');
  };

  const result = await publishEnv(config, 'sit', { yes: true, exec });

  assert.equal(result.published, true);
  const statusCall = calls.find((c) => c.args[0] === 'status');
  assert.deepEqual(statusCall.args, ['status', '--porcelain', '--', 'pub/app-sit']);
  const addCall = calls.find((c) => c.args[0] === 'add');
  assert.deepEqual(addCall.args, ['add', 'pub/app-sit'], 'git add must be scoped to this env dest only');
  assert.ok(calls.some((c) => c.args[0] === 'commit'));
  assert.ok(calls.some((c) => c.args[0] === 'push'));
  assert.equal(fs.readFileSync(path.join(repoRoot, 'pub', 'app-sit', 'index.html'), 'utf8'), '<div>built</div>');
});

test('an already-clean dest is skipped without commit/push', async () => {
  const { root, repoRoot } = makeProject_({ repoPath: null, initGitRepo: true });
  fs.writeFileSync(path.join(root, 'local.settings.json'), JSON.stringify({ staticRepoPath: repoRoot }));
  const config = baseConfig_(root);

  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'status') return Buffer.from('');
    return Buffer.from('');
  };

  const result = await publishEnv(config, 'sit', { yes: true, exec });

  assert.deepEqual(result, { skipped: true, reason: 'up-to-date' });
  assert.ok(!calls.includes('commit'));
  assert.ok(!calls.includes('push'));
});

test('an interactive cross-repo push is skipped when the user declines', async () => {
  const { root, repoRoot } = makeProject_({ repoPath: null, initGitRepo: true });
  fs.writeFileSync(path.join(root, 'local.settings.json'), JSON.stringify({ staticRepoPath: repoRoot }));
  const config = baseConfig_(root);

  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'status') return Buffer.from(' M pub/app-sit/index.html\n');
    return Buffer.from('');
  };

  const result = await publishEnv(config, 'sit', { exec, confirmFn: async () => false });

  assert.deepEqual(result, { skipped: true, reason: 'cancelled' });
  assert.ok(!calls.includes('add'));
});
