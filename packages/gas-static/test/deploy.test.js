'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runStatic } = require('../index.js');

/**
 * A runStatic() instance whose three pipeline steps are stubs, so the gas-deploy integration
 * (hook order, required flags, env mapping, the summary row) is testable with no filesystem, no
 * git checkout and no network.
 */
function pipeline_(overrides = {}) {
  const calls = [];
  const config = {
    root: '/proj/app',
    distDir: 'static-pages/dist',
    envs: { test: { repoKey: 'staticRepoPath', dest: 'pub/app-sit', label: 'TEST' } },
    liveUrl: (env) => `https://example.github.io/Static/pub/${env}/`,
    ...overrides.config,
  };
  const p = runStatic(config);
  p.build = (env) => { calls.push(['build', env]); return { outDir: '/proj/app/static-pages/dist/' + env, version: '1.2.3' }; };
  p.publish = async (env, options) => { calls.push(['publish', env, options]); return overrides.publishResult || { published: true }; };
  p.assertPublishedBuild = async (env, version, options) => {
    calls.push(['assert', env, version, options]);
    return { ok: true, version, env, webappUrl: 'https://script.google.com/macros/s/AK/exec' };
  };
  return { pipeline: p, config, calls };
}

const ctx_ = (over = {}) => ({ targetKey: 'test', version: '1.2.3', log: () => {}, ...over });

test('deployHooks runs build -> publish -> verify, all required, chained publish', async () => {
  const { pipeline, calls } = pipeline_();
  const hooks = pipeline.deployHooks();

  assert.deepEqual(hooks.map(h => h.name),
    ['static build', 'static publish', 'static verify (assertPublishedBuild)']);
  assert.ok(hooks.every(h => h.required === true),
    'every static hook must be required — a stale published page beside a new backend is a failed deploy');

  for (const hook of hooks) await hook.run(ctx_());

  assert.deepEqual(calls.map(c => c[0]), ['build', 'publish', 'assert']);
  assert.deepEqual(calls.map(c => c[1]), ['test', 'test', 'test']);
  assert.equal(calls[1][2].chained, true, 'the deploy is the confirmation for the cross-repo push');
  assert.equal(calls[2][2], '1.2.3');
  assert.equal(calls[2][3].timeoutSec, 300);
});

test('envFor maps a deploy target key onto a differently-named static env', async () => {
  const { pipeline, calls } = pipeline_();
  const hooks = pipeline.deployHooks({ envFor: (ctx) => (ctx.targetKey === 'test' ? 'sit' : 'prod') });

  await hooks[0].run(ctx_());

  assert.deepEqual(calls[0], ['build', 'sit']);
});

test('summaryRows gives gas-deploy the live URL row that used to be dropped', () => {
  const { pipeline } = pipeline_();

  assert.deepEqual(pipeline.summaryRows()(ctx_()),
    [{ label: 'Static page', value: 'https://example.github.io/Static/pub/test/' }]);
});

test('a publish skipped for a missing repo path is reported, not printed as fresh', async () => {
  const { pipeline } = pipeline_({ publishResult: { skipped: true, reason: 'no-repo-path' } });
  const hooks = pipeline.deployHooks();
  const rows = pipeline.summaryRows();

  await hooks[1].run(ctx_());

  assert.match(rows(ctx_())[0].value, /not republished — staticRepoPath not set/);
});

test('no liveUrl configured prints an explanation, never a broken URL', () => {
  const { pipeline } = pipeline_({ config: { liveUrl: undefined } });

  assert.deepEqual(pipeline.summaryRows()(ctx_()),
    [{ label: 'Static page', missing: '(liveUrl not configured)' }]);
});
