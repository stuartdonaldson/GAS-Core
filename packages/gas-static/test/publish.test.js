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

// --- S4: publish safety (ownership manifest + automatic rebase) -------------------------------

const MANIFEST_ = `# Publishers

\`\`\`json
{
  "pub/app-sit": { "project": "DemoApp", "env": "test", "url": "https://example.github.io/Static/pub/app-sit/" },
  "pub/other": { "project": "OtherApp", "env": "prod", "url": "https://example.github.io/Static/pub/other/" }
}
\`\`\`
`;

function withManifest_(repoRoot, body = MANIFEST_) {
  fs.writeFileSync(path.join(repoRoot, 'PUBLISHERS.md'), body);
  return repoRoot;
}

function seedNeighbour_(repoRoot) {
  fs.mkdirSync(path.join(repoRoot, 'pub', 'other'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'pub', 'other', 'index.html'), '<div>someone else</div>');
}

function projectWithManifest_({ dest = 'pub/app-sit', projectName = 'DemoApp' } = {}) {
  const { root, repoRoot } = makeProject_({ repoPath: null, initGitRepo: true });
  fs.writeFileSync(path.join(root, 'local.settings.json'), JSON.stringify({ staticRepoPath: repoRoot }));
  withManifest_(repoRoot);
  seedNeighbour_(repoRoot);
  const config = baseConfig_(root);
  config.projectName = projectName;
  config.envs.sit.dest = dest;
  return { root, repoRoot, config };
}

function gitExec_(calls, { statusDirty = true, failOn = null } = {}) {
  return (cmd, args) => {
    calls.push(args.join(' '));
    if (failOn && args[0] === failOn) throw new Error(`fatal: simulated ${failOn} failure`);
    if (args[0] === 'status') return Buffer.from(statusDirty ? ' M x\n' : '');
    if (args[0] === 'rev-parse') return Buffer.from('origin/main\n');
    return Buffer.from('');
  };
}

test('a dest not registered in PUBLISHERS.md is refused before anything is deleted', async () => {
  const { repoRoot, config } = projectWithManifest_({ dest: 'pub' });
  const calls = [];

  await assert.rejects(() => publishEnv(config, 'sit', { yes: true, exec: gitExec_(calls) }), /not registered/);

  assert.equal(
    fs.readFileSync(path.join(repoRoot, 'pub', 'other', 'index.html'), 'utf8'),
    '<div>someone else</div>',
    'rm -rf must be unreachable before validation passes'
  );
  assert.deepEqual(calls, [], 'no git command may run for a refused dest');
});

test("a dest registered to another project is refused, naming its owner", async () => {
  const { repoRoot, config } = projectWithManifest_({ dest: 'pub/other' });

  await assert.rejects(
    () => publishEnv(config, 'sit', { yes: true, exec: gitExec_([]) }),
    (err) => /pub\/other/.test(err.message) && /OtherApp/.test(err.message)
  );
  assert.equal(fs.readFileSync(path.join(repoRoot, 'pub', 'other', 'index.html'), 'utf8'), '<div>someone else</div>');
});

test('the structural backstop refuses an escaping dest even with no manifest present', async () => {
  const { root, repoRoot } = makeProject_({ repoPath: null, initGitRepo: true });
  fs.writeFileSync(path.join(root, 'local.settings.json'), JSON.stringify({ staticRepoPath: repoRoot }));
  const config = baseConfig_(root);
  config.projectName = 'DemoApp';
  config.envs.sit.dest = '../escape';

  await assert.rejects(() => publishEnv(config, 'sit', { yes: true, exec: gitExec_([]), warn: () => {} }), /'\.\.'/);
});

test('a registered publish fetches and rebases immediately before the commit', async () => {
  const { config } = projectWithManifest_();
  const calls = [];

  const result = await publishEnv(config, 'sit', { yes: true, exec: gitExec_(calls) });

  assert.equal(result.published, true);
  const i = (needle) => calls.findIndex((c) => c.startsWith(needle));
  assert.ok(i('fetch') >= 0, 'git fetch must run');
  assert.ok(i('rev-parse') >= 0, 'the tracking branch must be asserted');
  assert.ok(i('pull --rebase') >= 0, 'git pull --rebase must run');
  assert.ok(i('pull --rebase') < i('commit'), 'the rebase must run before the commit');
  assert.ok(i('commit') < i('push'));
});

test('a checkout with no tracking branch is refused before the commit', async () => {
  const { config } = projectWithManifest_();
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'status') return Buffer.from(' M x\n');
    if (args[0] === 'rev-parse') throw new Error('fatal: no upstream configured');
    return Buffer.from('');
  };

  await assert.rejects(() => publishEnv(config, 'sit', { yes: true, exec }), /tracking branch/);
  assert.ok(!calls.some((c) => c.startsWith('commit')), 'nothing may be committed without a tracking branch');
});

test('a failed push reports that the commit exists locally and how to finish it', async () => {
  const { config } = projectWithManifest_();
  const calls = [];

  await assert.rejects(
    () => publishEnv(config, 'sit', { yes: true, exec: gitExec_(calls, { failOn: 'push' }) }),
    (err) =>
      /committed locally/.test(err.message) &&
      /git pull --rebase/.test(err.message) &&
      /git push/.test(err.message)
  );
});
