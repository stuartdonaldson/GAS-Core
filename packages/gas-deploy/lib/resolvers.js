'use strict';

/**
 * Deployment-ID resolution.
 *
 * A survey of the seven pre-package copies found three different, mutually exclusive answers to
 * "which deployment do I update?":
 *
 *   | source                          | used by                          | deterministic | stale?  |
 *   |---------------------------------|----------------------------------|---------------|---------|
 *   | local.settings.json key         | F3Go30/RCV callWebapp.js (read)  | most          | yes     |
 *   | description contains an anchor  | all 5 lineage-A copies           | yes           | never   |
 *   | the sole non-@HEAD deployment   | F3Go30/RCV manage-deployments.js | only if 1     | never   |
 *
 * None of them fell back to another. That is the drift, not the strategies themselves — each is
 * right for a different project, and a project can legitimately move between them (a second
 * deployment gets created and `soleActive` stops working overnight).
 *
 * So the package resolves through an ordered `chain`, and the recommended default order is
 * settings → anchor → sole:
 *
 *   - **Configured ID first** because it is the most deterministic source: no guessing, no
 *     dependence on description discipline, and it still works when a project has many
 *     deployments.
 *   - **But always validated against the live list.** The reason the older code avoided a stored
 *     ID (§3.3: "never a stored value that can go stale") is real — a recreated deployment
 *     leaves a dead ID behind and you deploy into a URL nobody is using. `settingsId` therefore
 *     confirms the configured ID actually appears in `clasp deployments` and refuses it if not,
 *     which is what makes "deterministic" and "never stale" compatible instead of opposed.
 *   - **Anchor next** because a description substring survives a deployment being recreated,
 *     and it is the only strategy that distinguishes TEST from PROD when both live in one
 *     script project (lineage A, and any project that grows a second environment).
 *   - **Sole-active last** as the zero-configuration case: correct exactly when there is one
 *     named deployment, and it says so loudly when there is not.
 *
 * Every resolver receives the same context and returns a deployment id, or throws with a message
 * that says what to do about it. `chain` treats a throw as "try the next one" and reports all of
 * them if everything fails.
 */

const { parseDeployments } = require('./clasp.js');

/**
 * Context passed to every resolver:
 *   { deployments, settings, target, targetKey }
 * `deployments` is the already-parsed live list, fetched once per resolve so a chain of three
 * strategies still costs exactly one `clasp deployments` call.
 */

/**
 * Most deterministic: the ID recorded in local.settings.json, validated against the live list.
 * An ID that is configured but absent from the project is a hard error inside this resolver —
 * it means the deployment was deleted or recreated, and silently falling through to a *different*
 * deployment would hide that. The chain still moves on, but the reason is reported.
 */
function settingsId({ key } = {}) {
  const resolver = ({ deployments, settings, target }) => {
    const settingsKey = key || (target && target.deploymentIdKey);
    if (!settingsKey) throw new Error('settingsId: no deploymentIdKey configured for this target');

    const configured = settings[settingsKey];
    if (!configured || String(configured).startsWith('<')) {
      throw new Error(`settingsId: ${settingsKey} is not set in local.settings.json`);
    }
    if (!deployments.some(d => d.id === configured)) {
      throw new Error(
        `settingsId: ${settingsKey}=${configured} is not among this script project's live deployments — ` +
        'it was deleted or recreated. Remove the stale value, or re-run a deploy to re-record it.'
      );
    }
    return configured;
  };
  resolver.resolverName = 'settingsId';
  return resolver;
}

/**
 * Lineage A: the deployment whose description contains a stable anchor (e.g. "TEST-WEB-APP").
 * This is what lets one script project hold several deployments — the case RECOMMENDATION.md's
 * `soleActiveDeployment` cannot express at all.
 */
function anchorMatch(anchor) {
  if (!anchor) throw new Error('anchorMatch requires an anchor string');
  const resolver = ({ deployments }) => {
    const matches = deployments.filter(d => d.description && d.description.includes(anchor));
    if (matches.length === 0) {
      throw new Error(
        `anchorMatch: no deployment description contains "${anchor}". Create it once in the Apps ` +
        'Script editor as a Web App with that anchor in its description. This package never ' +
        'creates deployments — a new URL must always be a deliberate human decision.'
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `anchorMatch: "${anchor}" matches ${matches.length} deployments, so the target is ambiguous:\n` +
        matches.map(d => '  ' + d.raw).join('\n')
      );
    }
    return matches[0].id;
  };
  resolver.resolverName = `anchorMatch(${anchor})`;
  return resolver;
}

/**
 * Lineage B: exactly one active named deployment per script project. Zero configuration, and
 * correct until the day someone adds a second deployment — at which point it refuses rather
 * than guessing.
 */
function soleActiveDeployment() {
  const resolver = ({ deployments }) => {
    if (deployments.length === 0) {
      throw new Error(
        'soleActiveDeployment: no active (non-@HEAD) deployment found — create a Web app ' +
        'deployment via the script editor first. This package never creates deployments.'
      );
    }
    if (deployments.length > 1) {
      throw new Error(
        `soleActiveDeployment: expected exactly one active deployment, found ${deployments.length}:\n` +
        deployments.map(d => '  ' + d.raw).join('\n') +
        '\nThis project now has multiple deployments — switch this target to anchorMatch() or settingsId().'
      );
    }
    if (!deployments[0].id) {
      throw new Error(`soleActiveDeployment: could not parse a deployment ID from: ${deployments[0].raw}`);
    }
    return deployments[0].id;
  };
  resolver.resolverName = 'soleActiveDeployment';
  return resolver;
}

/**
 * Tries each resolver in order, first success wins. A resolver that throws is treated as "not
 * applicable here" — but every reason is collected, so a total failure explains all three
 * attempts instead of only the last.
 */
function chain(...resolvers) {
  const list = resolvers.flat();
  if (list.length === 0) throw new Error('chain requires at least one resolver');
  const resolver = (ctx) => {
    const reasons = [];
    for (const r of list) {
      try {
        const id = r(ctx);
        if (id) return id;
        reasons.push(`${r.resolverName || 'resolver'}: returned nothing`);
      } catch (err) {
        // Resolvers already prefix their own name so they read well standalone; don't repeat it.
        const name = r.resolverName || 'resolver';
        reasons.push(err.message.startsWith(name.split('(')[0]) ? err.message : `${name}: ${err.message}`);
      }
    }
    throw new Error('Could not resolve a deployment ID. Tried:\n' + reasons.map(r => '  - ' + r).join('\n'));
  };
  resolver.resolverName = `chain(${list.map(r => r.resolverName || '?').join(' → ')})`;
  return resolver;
}

/** The recommended default: deterministic first, live-verified, degrading to zero-config. */
function standardChain(anchor) {
  return anchor
    ? chain(settingsId(), anchorMatch(anchor), soleActiveDeployment())
    : chain(settingsId(), soleActiveDeployment());
}

/** Fetches the live list once and runs a resolver against it. */
function resolveDeploymentId(resolver, { listOutput, settings, target, targetKey }) {
  const deployments = parseDeployments(listOutput);
  return resolver({ deployments, settings, target, targetKey });
}

module.exports = {
  settingsId,
  anchorMatch,
  soleActiveDeployment,
  chain,
  standardChain,
  resolveDeploymentId,
};
