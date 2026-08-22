'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settingsId, anchorMatch, soleActiveDeployment, chain, standardChain, resolveDeploymentId } = require('../lib/resolvers.js');

const TWO = '- AKfycA @10 - TEST-WEB-APP v1.0\n- AKfycB @20 - PROD-WEB-APP v1.0\n- AKfycHEAD @HEAD';
const ONE = '- AKfycSOLE @7 - v0.1.6 RCV\n- AKfycHEAD @HEAD';
const NONE = '- AKfycHEAD @HEAD';

const run = (resolver, listOutput, settings = {}, target = { deploymentIdKey: 'testDeploymentId' }) =>
  resolveDeploymentId(resolver, { listOutput, settings, target, targetKey: 'test' });

test('anchorMatch picks the deployment whose description carries the anchor', () => {
  assert.equal(run(anchorMatch('TEST-WEB-APP'), TWO), 'AKfycA');
  assert.equal(run(anchorMatch('PROD-WEB-APP'), TWO), 'AKfycB');
});

test('anchorMatch errors on no match, and never creates a deployment', () => {
  assert.throws(() => run(anchorMatch('NOPE'), TWO), /no deployment description contains "NOPE"/);
  assert.throws(() => run(anchorMatch('NOPE'), TWO), /never creates deployments/);
});

test('anchorMatch errors on multi-match rather than guessing', () => {
  const dupes = '- AKfycA @1 - TEST-WEB-APP a\n- AKfycB @2 - TEST-WEB-APP b';
  assert.throws(() => run(anchorMatch('TEST-WEB-APP'), dupes), /matches 2 deployments/);
});

test('soleActiveDeployment returns the only non-@HEAD deployment', () => {
  assert.equal(run(soleActiveDeployment(), ONE), 'AKfycSOLE');
});

test('soleActiveDeployment errors on zero and on multiple', () => {
  assert.throws(() => run(soleActiveDeployment(), NONE), /no active \(non-@HEAD\) deployment found/);
  assert.throws(() => run(soleActiveDeployment(), TWO), /found 2/);
  // The multi-deployment message must say what to do about it, not just refuse.
  assert.throws(() => run(soleActiveDeployment(), TWO), /switch this target to anchorMatch\(\) or settingsId\(\)/);
});

test('settingsId returns the configured ID when it is live', () => {
  assert.equal(run(settingsId(), TWO, { testDeploymentId: 'AKfycB' }), 'AKfycB');
});

test('settingsId refuses a stale configured ID — the whole reason a stored value was distrusted', () => {
  assert.throws(
    () => run(settingsId(), TWO, { testDeploymentId: 'AKfycGONE' }),
    /is not among this script project's live deployments/
  );
});

test('settingsId errors when unset or still a placeholder', () => {
  assert.throws(() => run(settingsId(), TWO, {}), /is not set in local.settings.json/);
  assert.throws(() => run(settingsId(), TWO, { testDeploymentId: '<fill me in>' }), /is not set in local.settings.json/);
});

test('chain: deterministic first, then anchor, then sole', () => {
  // configured + live  -> settings wins
  assert.equal(run(standardChain('TEST-WEB-APP'), TWO, { testDeploymentId: 'AKfycB' }), 'AKfycB');
  // configured but stale -> falls through to the anchor
  assert.equal(run(standardChain('TEST-WEB-APP'), TWO, { testDeploymentId: 'STALE' }), 'AKfycA');
  // nothing configured, no anchor, one deployment -> sole
  assert.equal(run(standardChain(), ONE, {}), 'AKfycSOLE');
});

test('chain reports every attempt when all strategies fail', () => {
  try {
    run(standardChain('NOPE'), TWO, { testDeploymentId: 'STALE' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /settingsId:/);
    assert.match(err.message, /anchorMatch:/);
    assert.match(err.message, /soleActiveDeployment:/);
    // and not doubled up
    assert.doesNotMatch(err.message, /settingsId: settingsId:/);
  }
});

test('chain requires at least one resolver', () => {
  assert.throws(() => chain(), /at least one resolver/);
});
