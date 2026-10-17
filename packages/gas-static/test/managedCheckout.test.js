'use strict';
// GAS-Core-bsi: the managed host checkout. The publish path rm -rf's a directory, so these extend the
// ADR-0003 guard tests (folder ownership, refuse-unauthorised-publish) over the managed path.
//
// No network: the "remote" is a bare repository in a temp directory and the clone URL is its path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { publishEnv } = require('../lib/publish.js');
const {
  ensureManagedCheckout_, managedRepoRoot_, defaultCacheRoot_, ManagedCheckoutError,
} = require('../lib/managedCheckout.js');

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
};

function git_(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' });
}
/** A real-git runner (quiet, hermetic identity) for publishEnv's `exec` option. */
function realExec_(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { ...opts, env: GIT_ENV, stdio: 'pipe' });
}

const MANIFEST = `# Publishers

\`\`\`json
{
  "pub/app-sit": { "project": "DemoApp", "env": "test", "url": "https://example.github.io/Static/pub/app-sit/" },
  "pub/other": { "project": "OtherApp", "env": "prod", "url": "https://example.github.io/Static/pub/other/" }
}
\`\`\`
`;

/** A bare "remote" seeded with PUBLISHERS.md and a neighbour project's folder. Returns helpers. */
function makeRemote_() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-mc-'));
  const bare = path.join(base, 'remote.git');
  git_(base, 'init', '--bare', '-b', 'main', bare);
  const seed = path.join(base, 'seed');
  git_(base, 'clone', bare, seed);
  fs.writeFileSync(path.join(seed, 'PUBLISHERS.md'), MANIFEST);
  fs.mkdirSync(path.join(seed, 'pub', 'other'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'pub', 'other', 'index.html'), '<div>someone else</div>');
  git_(seed, 'add', '-A');
  git_(seed, 'commit', '-m', 'seed');
  git_(seed, 'push', 'origin', 'HEAD:main');
  return {
    base, bare, seed, cacheRoot: path.join(base, 'cache'),
    /** Another project (or a human) pushes to the shared host. */
    pushFromElsewhere(file, content, message = 'elsewhere') {
      git_(seed, 'pull', '--rebase', 'origin', 'main');
      fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
      fs.writeFileSync(path.join(seed, file), content);
      git_(seed, 'add', '-A');
      git_(seed, 'commit', '-m', message);
      git_(seed, 'push', 'origin', 'HEAD:main');
    },
    /** What the remote actually holds at main, as a path -> content map of one folder. */
    remoteFile(file) {
      try { return git_(bare, 'show', `main:${file}`); } catch (e) { return null; }
    },
  };
}

function makeProject_(remote, { dest = 'pub/app-sit', settings = {}, projectName = 'DemoApp' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-mcproj-'));
  fs.mkdirSync(path.join(root, 'dist', 'sit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'sit', 'index.html'), '<div>built</div>');
  fs.writeFileSync(path.join(root, 'local.settings.json'), JSON.stringify(settings));
  const config = {
    root,
    distDir: 'dist',
    projectName,
    envs: {
      sit: {
        deployTarget: 'TEST', repoKey: 'staticRepoPath', dest, label: 'SIT',
        repo: 'demo-org/Static', cloneUrl: remote.bare,
      },
    },
  };
  return { root, config, options: { yes: true, exec: realExec_, cacheRoot: remote.cacheRoot, warn: () => {} } };
}

const repoRootFor_ = (remote) => managedRepoRoot_(remote.cacheRoot, 'demo-org/Static');

// ---------------------------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------------------------

test('managedRepoRoot_ maps owner/name to one directory directly under the cache root', () => {
  assert.equal(managedRepoRoot_('/c', 'f3go30/static-pages'), path.resolve('/c', 'f3go30__static-pages'));
});

test('managedRepoRoot_ refuses slugs that could leave the cache root, before any git runs', () => {
  for (const bad of ['', 'nope', '../x', 'a/../b', 'a/b/c', '/abs/x', 'a/..', '../..', 'o/.', undefined, 42]) {
    assert.throws(() => managedRepoRoot_('/c', bad), (e) => e instanceof ManagedCheckoutError && e.code === 'INVALID_REPO', String(bad));
  }
});

test('defaultCacheRoot_ honours GAS_STATIC_CACHE, then XDG_CACHE_HOME, then ~/.cache/gas-static', () => {
  assert.equal(defaultCacheRoot_({ GAS_STATIC_CACHE: '/x' }), '/x');
  assert.equal(defaultCacheRoot_({ XDG_CACHE_HOME: '/xdg' }), path.join('/xdg', 'gas-static'));
  assert.equal(defaultCacheRoot_({}), path.join(os.homedir(), '.cache', 'gas-static'));
});

// ---------------------------------------------------------------------------------------------
// git command shape, no git actually run
// ---------------------------------------------------------------------------------------------

test('an absent checkout is cloned blobless + sparse from the slug-derived https URL, then sparse-set to dest', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-mcmock-'));
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (args[0] === 'clone') fs.mkdirSync(path.join(args[args.length - 1], '.git'), { recursive: true });
    return Buffer.from('');
  };

  const repoRoot = ensureManagedCheckout_({ exec, cacheRoot, repo: 'f3go30/static-pages', dest: 'ballot/sit' });

  assert.equal(repoRoot, path.join(cacheRoot, 'f3go30__static-pages'));
  assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [
    ['git', 'clone', '--filter=blob:none', '--sparse', 'https://github.com/f3go30/static-pages.git', repoRoot],
    ['git', 'sparse-checkout', 'set', 'ballot/sit'],
  ]);
  assert.equal(calls[1].cwd, repoRoot);
});

test('a failed clone is a named CLONE_FAILED error', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-mcmock-'));
  const exec = () => { throw new Error('fatal: unable to access'); };
  assert.throws(
    () => ensureManagedCheckout_({ exec, cacheRoot, repo: 'o/n', dest: 'pub/x' }),
    (e) => e.name === 'ManagedCheckoutError' && e.code === 'CLONE_FAILED' && /unable to access/.test(e.message)
  );
});

test('an unsafe dest is refused before any git command or directory creation', () => {
  const cacheRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gas-static-mcmock-')), 'cache');
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return Buffer.from(''); };
  for (const dest of ['', '..', '../escape', '/abs', 'C:\\x', 'pub/../..', '.git']) {
    assert.throws(() => ensureManagedCheckout_({ exec, cacheRoot, repo: 'o/n', dest }), /dest/, JSON.stringify(dest));
  }
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(cacheRoot), false, 'nothing may be created for a refused dest');
});

// ---------------------------------------------------------------------------------------------
// real git, local bare remote
// ---------------------------------------------------------------------------------------------

test('absent checkout: clones sparse, publishes into the remote, and never materialises neighbours', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);

  const result = await publishEnv(config, 'sit', options);

  assert.equal(result.published, true);
  const repoRoot = repoRootFor_(remote);
  assert.equal(result.repoRoot, repoRoot);
  assert.equal(remote.remoteFile('pub/app-sit/index.html'), '<div>built</div>');
  assert.equal(remote.remoteFile('pub/other/index.html'), '<div>someone else</div>', "the neighbour's folder is untouched upstream");
  assert.equal(fs.existsSync(path.join(repoRoot, 'pub', 'other')), false, 'sparse: only this project’s folder is on disk');
  assert.equal(git_(repoRoot, 'config', '--get', 'core.sparseCheckout').trim(), 'true');
});

test('existing checkout that is behind is fast-forwarded before publishing', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options); // creates the managed checkout

  remote.pushFromElsewhere('pub/other/page2.html', 'new from another project');
  fs.writeFileSync(path.join(config.root, 'dist', 'sit', 'index.html'), '<div>built v2</div>');
  const result = await publishEnv(config, 'sit', options);

  assert.equal(result.published, true);
  assert.equal(remote.remoteFile('pub/app-sit/index.html'), '<div>built v2</div>');
  assert.equal(remote.remoteFile('pub/other/page2.html'), 'new from another project', 'the other project’s push survives ours');
});

test('a dirty managed checkout is refused with DIRTY and nothing is deleted or overwritten', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options);
  const repoRoot = repoRootFor_(remote);
  const stray = path.join(repoRoot, 'pub', 'app-sit', 'hand-edit.html');
  fs.writeFileSync(stray, 'someone was here');
  fs.writeFileSync(path.join(config.root, 'dist', 'sit', 'index.html'), '<div>built v2</div>');

  await assert.rejects(() => publishEnv(config, 'sit', options), (e) => e.code === 'DIRTY' && /hand-edit/.test(e.message));

  assert.equal(fs.readFileSync(stray, 'utf8'), 'someone was here', 'rm -rf must be unreachable on a dirty checkout');
  assert.equal(remote.remoteFile('pub/app-sit/index.html'), '<div>built</div>');
});

test('a dirty file OUTSIDE dest also refuses (the whole managed checkout must be clean)', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options);
  fs.writeFileSync(path.join(repoRootFor_(remote), 'PUBLISHERS.md'), 'tampered');

  await assert.rejects(() => publishEnv(config, 'sit', options), (e) => e.code === 'DIRTY');
});

test('a diverged managed checkout is refused with DIVERGED and nothing is deleted', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options);
  const repoRoot = repoRootFor_(remote);
  fs.writeFileSync(path.join(repoRoot, 'pub', 'app-sit', 'local-only.html'), 'unpushed');
  git_(repoRoot, 'add', '-A');
  git_(repoRoot, 'commit', '-m', 'local only');
  remote.pushFromElsewhere('pub/other/page3.html', 'upstream moved');

  await assert.rejects(() => publishEnv(config, 'sit', options), (e) => e.code === 'DIVERGED');

  assert.equal(fs.readFileSync(path.join(repoRoot, 'pub', 'app-sit', 'local-only.html'), 'utf8'), 'unpushed');
});

test('a checkout that is only ahead (a previous push failed) is not divergence: the publish delivers it', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options);
  const repoRoot = repoRootFor_(remote);
  fs.writeFileSync(path.join(repoRoot, 'pub', 'app-sit', 'stranded.html'), 'stranded');
  git_(repoRoot, 'add', '-A');
  git_(repoRoot, 'commit', '-m', 'stranded');
  fs.writeFileSync(path.join(config.root, 'dist', 'sit', 'index.html'), '<div>built v2</div>');
  // The next publish replaces dest wholesale, so the stranded file is superseded by the build; the
  // point here is only that ahead-without-behind is accepted.
  const result = await publishEnv(config, 'sit', options);
  assert.equal(result.published, true);
});

test('a checkout whose origin is a different repository is refused with WRONG_ORIGIN', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options);
  const repoRoot = repoRootFor_(remote);
  git_(repoRoot, 'remote', 'set-url', 'origin', path.join(remote.base, 'some-other.git'));

  await assert.rejects(() => publishEnv(config, 'sit', options), (e) => e.code === 'WRONG_ORIGIN');
});

test('a non-empty, non-git directory at the managed path is refused and left untouched', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  const repoRoot = repoRootFor_(remote);
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'precious.txt'), 'keep me');

  await assert.rejects(() => publishEnv(config, 'sit', options), (e) => e.code === 'NOT_A_CHECKOUT');

  assert.equal(fs.readFileSync(path.join(repoRoot, 'precious.txt'), 'utf8'), 'keep me');
});

test('a detached HEAD (no tracking branch) is refused with NO_UPSTREAM', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options);
  const repoRoot = repoRootFor_(remote);
  git_(repoRoot, 'checkout', '--detach');

  await assert.rejects(() => publishEnv(config, 'sit', options), (e) => e.code === 'NO_UPSTREAM');
});

// --- ADR-0003 guards, through the managed path -----------------------------------------------

test('ADR-0003: a dest owned by another project is refused through the managed path; the neighbour survives', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote, { dest: 'pub/other' });

  await assert.rejects(
    () => publishEnv(config, 'sit', options),
    (e) => /pub\/other/.test(e.message) && /OtherApp/.test(e.message)
  );

  const repoRoot = repoRootFor_(remote);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'pub', 'other', 'index.html'), 'utf8'), '<div>someone else</div>');
  assert.equal(remote.remoteFile('pub/other/index.html'), '<div>someone else</div>');
});

test('ADR-0003: an unregistered dest is refused through the managed path', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote, { dest: 'pub/unregistered' });

  await assert.rejects(() => publishEnv(config, 'sit', options), /not registered/);
  assert.equal(remote.remoteFile('pub/unregistered/index.html'), null);
});

test('ADR-0003: a dest of "pub" (a parent of other projects’ folders) is refused through the managed path', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote, { dest: 'pub' });

  await assert.rejects(() => publishEnv(config, 'sit', options), /not registered/);
  assert.equal(remote.remoteFile('pub/other/index.html'), '<div>someone else</div>');
});

test('ADR-0003: an escaping dest is refused before the managed checkout is even cloned', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote, { dest: '../escape' });
  const calls = [];
  const exec = (cmd, args, opts) => { calls.push(args); return realExec_(cmd, args, opts); };

  await assert.rejects(() => publishEnv(config, 'sit', { ...options, exec }), /'\.\.'/);

  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(remote.cacheRoot), false);
});

test('ADR-0003: a declared project name that does not match the manifest is refused through the managed path', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote, { projectName: 'ImpostorApp' });

  await assert.rejects(() => publishEnv(config, 'sit', options), /registered to DemoApp.*ImpostorApp/);
  assert.equal(remote.remoteFile('pub/app-sit/index.html'), null);
});

// --- override / skip / cancel -----------------------------------------------------------------

test('settings[repoKey] is an override: when set, no managed checkout is created or used', async () => {
  const remote = makeRemote_();
  const own = path.join(remote.base, 'own-clone');
  git_(remote.base, 'clone', remote.bare, own);
  const { config, options } = makeProject_(remote, { settings: { staticRepoPath: own } });

  const result = await publishEnv(config, 'sit', options);

  assert.equal(result.repoRoot, own);
  assert.equal(fs.existsSync(remote.cacheRoot), false, 'the cache dir must not be touched when an override is present');
  assert.equal(remote.remoteFile('pub/app-sit/index.html'), '<div>built</div>');
});

test('no override and no repo slug declared: warn and skip, as before', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  delete config.envs.sit.repo;
  delete config.envs.sit.cloneUrl;
  const warnings = [];

  const result = await publishEnv(config, 'sit', { ...options, warn: (m) => warnings.push(m) });

  assert.deepEqual(result, { skipped: true, reason: 'no-repo-path' });
  assert.match(warnings[0], /staticRepoPath is not set/);
  assert.equal(fs.existsSync(remote.cacheRoot), false);
});

test('a declined publish restores the managed checkout so the next publish is not DIRTY', async () => {
  const remote = makeRemote_();
  const { config, options } = makeProject_(remote);
  await publishEnv(config, 'sit', options);
  fs.writeFileSync(path.join(config.root, 'dist', 'sit', 'index.html'), '<div>built v2</div>');
  fs.writeFileSync(path.join(config.root, 'dist', 'sit', 'extra.html'), 'new file');

  const declined = await publishEnv(config, 'sit', { ...options, yes: false, confirmFn: async () => false });
  assert.deepEqual(declined, { skipped: true, reason: 'cancelled' });
  assert.equal(git_(repoRootFor_(remote), 'status', '--porcelain').trim(), '', 'managed checkout must be clean after a decline');

  const result = await publishEnv(config, 'sit', options);
  assert.equal(result.published, true);
  assert.equal(remote.remoteFile('pub/app-sit/extra.html'), 'new file');
});
