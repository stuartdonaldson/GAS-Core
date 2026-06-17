#!/usr/bin/env node

/**
 * Google Apps Script Deployment Manager
 *
 * Interactive helper around `clasp` for the Audio Track Combiner project.
 * Run from the repo root: `npm run manage-deployments`, or with flags:
 *   node manage-deployments.js --deploy-test     # redeploy TEST in place
 *   node manage-deployments.js --deploy-prod     # redeploy PROD in place
 *   node manage-deployments.js --manage          # list/archive old deployments
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────
 * A web app is published at https://script.google.com/macros/s/<ID>/exec.
 * The <ID> is stable for the lifetime of the deployment. Redeploying to the
 * same ID with `clasp deploy -i <ID>` creates a new immutable numbered
 * version AND repoints the deployment at it — the URL does not change.
 *
 * This script maintains TWO stable, versioned deployments:
 *   TEST  → deployment with description "TEST-WEB-APP"
 *   PROD  → deployment with description "PROD-WEB-APP"
 *
 * IDs are discovered at runtime by searching `clasp deployments` output for
 * the anchor substrings above. There is no config file of deployment IDs.
 * Each deploy uses `-d "<ANCHOR>"` so the description stays exactly equal
 * to the anchor and remains discoverable after the deploy. Version numbers
 * (which clasp advances automatically) are the audit trail.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONE-TIME SETUP
 * ─────────────────────────────────────────────────────────────────────────
 *   1. `src/appsscript.json` must contain a `webapp` section:
 *        "webapp": { "access": "ANYONE", "executeAs": "USER_ACCESSING" }
 *      Without it, `clasp deploy -i` strips web-app configuration and
 *      converts the deployment to a library — the /exec URL will 404.
 *   2. Each of the two deployments (TEST-WEB-APP, PROD-WEB-APP) must be
 *      created once in the Apps Script editor as a Web App, with the
 *      description set to exactly "TEST-WEB-APP" or "PROD-WEB-APP".
 *      This script will not create them automatically — on purpose, to
 *      avoid accidentally spawning a new stable URL.
 */

const { execSync } = require('child_process');
const path = require('path');
const { checkbox, confirm, select } = require('@inquirer/prompts');

const SRC_DIR = path.join(__dirname, 'src');

const TARGETS = {
  test:       { anchor: 'TEST-WEB-APP', label: 'TEST',       emoji: '🧪' },
  production: { anchor: 'PROD-WEB-APP', label: 'PRODUCTION', emoji: '🚀' },
};

async function main() {
  try {
    console.log('🔧 Google Apps Script Deployment Manager\n');

    // All clasp commands run from src/ (where .clasp.json lives).
    process.chdir(SRC_DIR);

    const args = process.argv.slice(2);
    let action = null;
    if (args.includes('--deploy-test'))       action = 'deploy-test';
    else if (args.includes('--deploy-prod'))  action = 'deploy-prod';
    else if (args.includes('--manage'))       action = 'manage';
    else {
      action = await select({
        message: 'What would you like to do?',
        choices: [
          { name: '🚀 Deploy to PRODUCTION (redeploy PROD-WEB-APP in place)', value: 'deploy-prod' },
          { name: '🧪 Deploy to TEST (redeploy TEST-WEB-APP in place)',       value: 'deploy-test' },
          { name: '📦 List / archive deployments',                             value: 'manage' },
          { name: '❌ Exit',                                                   value: 'exit' },
        ],
      });
    }
    if (action === 'exit') return;

    const deployments = await getDeployments();
    const nonInteractive = args.length > 0;

    if (action === 'deploy-test') {
      await deployToTarget('test', deployments, nonInteractive);
    } else if (action === 'deploy-prod') {
      await deployToTarget('production', deployments, nonInteractive);
    } else if (action === 'manage') {
      if (deployments.length === 0) {
        console.log('❌ No deployments found.');
        return;
      }
      displayDeployments(deployments);
      const toArchive = await getUserSelection(deployments);
      if (toArchive.length === 0) { console.log('ℹ️  No deployments selected for archiving.'); return; }
      const confirmed = await confirmArchiving(toArchive);
      if (!confirmed) { console.log('❌ Operation cancelled.'); return; }
      await archiveDeployments(toArchive);
      console.log('\n✅ Deployment management complete!');
    }
  } catch (error) {
    if (error && (error.name === 'ExitPromptError' || error.message === 'User force closed the prompt with 0 null')) {
      console.log('\n❌ Cancelled.');
      return;
    }
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Deploy flow — identical shape for TEST and PROD.
// ─────────────────────────────────────────────────────────────────────────

async function deployToTarget(target, deployments, nonInteractive) {
  const { anchor, label, emoji } = TARGETS[target];

  const match = deployments.find(d => !d.isHead && d.description && d.description.includes(anchor));
  if (!match) {
    console.log(`\n❌ No deployment found with description containing "${anchor}".`);
    console.log(`   Create it once in the Apps Script editor as a Web App with description "${anchor}".`);
    console.log(`   (This script never creates new deployments — new URLs must be deliberate.)`);
    return;
  }

  console.log(`\n🕐 Stamping revision into version.html...`);
  execSync(`node ${path.join(__dirname, 'update-revision.js')}`, { stdio: 'inherit' });

  console.log(`\n${emoji} Deploying to ${label}`);
  console.log(`   Target: ${match.deploymentId}  ${match.version}  "${match.description}"`);
  console.log(`   URL (stays constant): ${webAppUrl(match.deploymentId)}\n`);

  if (!nonInteractive) {
    const proceed = await confirm({
      message: `Push src/ and redeploy ${label} (${match.deploymentId})?`,
      default: true,
    });
    if (!proceed) { console.log('❌ Cancelled.'); return; }
  } else {
    console.log(`🚀 Auto-confirming deployment (non-interactive mode).`);
  }

  console.log('\n📤 Pushing src/ to Apps Script...');
  execSync('clasp push -f', { stdio: 'inherit' });

  console.log(`\n🚀 Creating new version and repointing ${label} deployment...`);
  console.log(`   clasp deploy -i ${match.deploymentId} -d "${anchor}"`);
  execSync(`clasp deploy -i ${match.deploymentId} -d "${anchor}"`, { stdio: 'inherit' });

  console.log(`\n✅ ${label} deploy complete.`);
  console.log(`🔗 ${label} URL:\n   ${webAppUrl(match.deploymentId)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────
// Deployment listing / parsing / archiving.
// ─────────────────────────────────────────────────────────────────────────

async function getDeployments() {
  console.log('📋 Fetching deployments...');
  try {
    const output = execSync('clasp deployments', { encoding: 'utf8' });
    return parseDeployments(output);
  } catch (error) {
    throw new Error(`Failed to get deployments: ${error.message}`);
  }
}

function parseDeployments(output) {
  const lines = output.split('\n').filter(line => line.trim());
  const deployments = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('- ')) continue;

    const content = trimmed.substring(2);
    const parts = content.split(' - ');
    const mainPart = parts[0].trim();
    const description = parts.length > 1 ? parts.slice(1).join(' - ').trim() : '';

    const mainParts = mainPart.split(/\s+/);
    if (mainParts.length >= 2) {
      const deploymentId = mainParts[0];
      const version = mainParts[1];
      deployments.push({
        deploymentId,
        version,
        description,
        isHead: version === '@HEAD',
      });
    }
  }

  deployments.sort((a, b) => {
    if (a.isHead) return -1;
    if (b.isHead) return 1;
    const versionA = parseInt(a.version.replace('@', '')) || 0;
    const versionB = parseInt(b.version.replace('@', '')) || 0;
    return versionB - versionA;
  });

  return deployments;
}

function displayDeployments(deployments) {
  console.log('\n📋 Active Deployments (ordered by version, most recent first):\n');

  deployments.forEach((deployment, index) => {
    const isHead = deployment.isHead;
    const isMostRecent = index === 0 && !isHead;
    const status = isHead ? '🏷️  @HEAD' : isMostRecent ? '🆕 Most Recent' : '📦 Archivable';

    console.log(`${index + 1}. ${deployment.deploymentId}`);
    console.log(`   ${status}`);
    console.log(`   Version: ${deployment.version}`);
    console.log(`   Description: ${deployment.description || 'No description'}`);
    console.log('');
  });

  const headDeployment = deployments.find(d => d.isHead);
  const mostRecent = deployments[0];

  console.log('📊 Summary:');
  console.log(`   Total deployments: ${deployments.length}`);
  console.log(`   @HEAD deployment: ${headDeployment ? 'Present' : 'Not found'}`);
  console.log(`   Most recent: ${mostRecent.deploymentId} (v${mostRecent.version})`);
  console.log(`   Archivable: ${deployments.length - (headDeployment ? 1 : 0) - 1} deployments\n`);
}

async function getUserSelection(deployments) {
  const archivable = deployments.filter((deployment, index) => {
    const isHead = deployment.isHead;
    const isMostRecent = index === 0;
    const isAnchored = Object.values(TARGETS).some(t => deployment.description && deployment.description.includes(t.anchor));
    // Never offer @HEAD, the most recent, or any anchored (TEST-WEB-APP / PROD-WEB-APP) deployment.
    return !isHead && !isMostRecent && !isAnchored;
  });

  if (archivable.length === 0) {
    console.log('ℹ️  No deployments available for archiving (only @HEAD, the most recent, and the anchored TEST/PROD deployments exist).');
    return [];
  }

  const choices = archivable.map(deployment => ({
    name: `${deployment.deploymentId} (v${deployment.version}) - ${deployment.description || 'No description'}`,
    value: deployment.deploymentId,
    short: deployment.deploymentId,
  }));

  const answers = await checkbox({
    message: 'Select deployments to archive:',
    choices: choices,
    pageSize: 10,
  });

  return answers;
}

async function confirmArchiving(deploymentIds) {
  console.log(`\n🗂️  Selected ${deploymentIds.length} deployment(s) for archiving:`);
  deploymentIds.forEach(id => console.log(`   - ${id}`));

  return confirm({
    message: 'Are you sure you want to archive these deployments?',
    default: false,
  });
}

async function archiveDeployments(deploymentIds) {
  console.log('\n🗂️  Archiving deployments...');

  let successCount = 0;
  let failCount = 0;

  for (const deploymentId of deploymentIds) {
    try {
      console.log(`   Archiving ${deploymentId}...`);
      execSync(`clasp undeploy ${deploymentId}`, { stdio: 'inherit' });
      console.log(`   ✅ ${deploymentId} archived successfully`);
      successCount++;
    } catch (error) {
      console.log(`   ❌ Failed to archive ${deploymentId}`);
      failCount++;
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`   ✅ Successfully archived: ${successCount}`);
  if (failCount > 0) {
    console.log(`   ❌ Failed to archive: ${failCount}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Small utilities.
// ─────────────────────────────────────────────────────────────────────────

function webAppUrl(deploymentId) {
  return `https://script.google.com/macros/s/${deploymentId}/exec`;
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, getDeployments, parseDeployments, displayDeployments };
