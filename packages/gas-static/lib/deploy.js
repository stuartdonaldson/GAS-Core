'use strict';

const path = require('path');

/**
 * The gas-deploy integration: the three-hook chain and the summary row every consumer that
 * chains this package off a deploy would otherwise hand-copy.
 *
 * PracticeMix wrote all of this by hand (34 lines in its manage-deployments.js) and, in doing so,
 * dropped the summary row — the static URL was logged mid-deploy by the verify hook and then
 * absent from the end-of-deploy summary block, which is the part a reader actually keeps. That is
 * the failure this module exists to prevent: the pipeline that knows `liveUrl` is the one that
 * should be handing gas-deploy the row, not each consumer separately.
 *
 * Ownership boundary: gas-deploy stays ignorant of static hosting. It offers two generic seams
 * (`postDeploy`, `extraRows`); gas-static supplies what goes in them.
 *
 *   postDeploy: staticPipeline.deployHooks(),
 *   extraRows:  staticPipeline.summaryRows(),
 */

/**
 * All three hooks are `required: true`, overriding gas-deploy's warn-and-continue default. That
 * default is right for a hook whose failure leaves working code live; it is wrong here. A deploy
 * that pushed a new backend but left the CDN serving the previous page has shipped two halves
 * that disagree, and reporting success sends the next reader looking for the bug in the code.
 *
 * Order is not arbitrary: `build` asserts BUILD_INFO agrees with the env before writing anything,
 * `publish` is scoped to this app's own directory in the shared host repo, and
 * `assertPublishedBuild` is the only step that can tell a published page from a propagated one.
 *
 * `chained: true` on the publish suppresses the cross-repo-push confirmation — invoking the
 * deploy is itself the confirmation.
 *
 * @param {object} pipeline  the runStatic() instance (build/publish/assertPublishedBuild)
 * @param {object} config    the same instance's config, for `root` and `liveUrl`
 * @param {object} [options]
 * @param {(ctx) => string} [options.envFor]  deploy targetKey -> static env key. Default: the
 *   targetKey verbatim, which is why envs should be keyed by target key.
 * @param {number} [options.timeoutSec]  passed to assertPublishedBuild. Default 300: a CDN
 *   rebuild after push is the slow case, and a first publish to a new directory is slower still.
 * @param {number} [options.intervalSec]
 * @param {object} [options.state]  where hook results are recorded for summaryRows().
 */
function deployHooks(pipeline, config, options = {}) {
  const {
    envFor = (ctx) => ctx.targetKey,
    timeoutSec = 300,
    intervalSec,
    state = {},
  } = options;

  const pollOptions = { timeoutSec, ...(intervalSec ? { intervalSec } : {}) };

  return [
    {
      name: 'static build',
      required: true,
      run: (ctx) => {
        const env = envFor(ctx);
        const log = ctx.log || console.log;
        state.env = env;
        state.built = pipeline.build(env);
        log(`   → ${path.relative(config.root, state.built.outDir)} (v${state.built.version})`);
      },
    },
    {
      name: 'static publish',
      required: true,
      run: (ctx) => {
        const env = envFor(ctx);
        const log = ctx.log || console.log;
        return Promise.resolve(pipeline.publish(env, {
          chained: true,
          log: (m) => log(`   ${m}`),
          warn: (m) => console.warn(`   ⚠️  ${m}`),
        })).then((result) => { state.published = result; return result; });
      },
    },
    {
      name: 'static verify (assertPublishedBuild)',
      required: true,
      run: async (ctx) => {
        const env = envFor(ctx);
        const log = ctx.log || console.log;
        const result = await pipeline.assertPublishedBuild(env, ctx.version, {
          ...pollOptions,
          log: (m) => log(`   ${m}`),
        });
        state.verified = result;
        log(`   ✅ ${config.liveUrl(env)} serving v${result.version} (${result.env}) → ${result.webappUrl}`);
      },
    },
  ];
}

/**
 * The `extraRows` function gas-deploy calls when it builds the summary — including on the
 * verification-failure path, which is exactly when knowing which page is live matters most.
 *
 * Returns a `(ctx) => rows` function, matching gas-deploy's `extraRows` contract. When the hooks
 * from `deployHooks()` share `state`, a publish that was skipped for a missing repo path reports
 * that instead of a URL nobody just republished — a URL printed as if it were fresh is worse than
 * no row.
 */
function summaryRows(config, options = {}) {
  const { envFor = (ctx) => ctx.targetKey, label = 'Static page', state = {} } = options;

  return (ctx) => {
    const env = envFor(ctx);
    if (!config.liveUrl) return [{ label, missing: '(liveUrl not configured)' }];
    const url = config.liveUrl(env);

    const skipped = state.published && state.published.skipped;
    if (skipped && state.published.reason === 'no-repo-path') {
      const key = (config.envs && config.envs[env] && config.envs[env].repoKey) || 'the repo path';
      return [{ label, value: `${url}  (not republished — ${key} not set in local.settings.json)` }];
    }
    return [{ label, value: url }];
  };
}

module.exports = { deployHooks, summaryRows };
