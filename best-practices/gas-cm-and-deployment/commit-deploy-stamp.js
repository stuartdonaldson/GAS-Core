#!/usr/bin/env node

/**
 * Commit the deploy stamp with deployment metadata in the message.
 * Called by release:patch/minor/major scripts after deployment completes.
 *
 * Usage: node commit-deploy-stamp.js
 *
 * Reads .deploy-metadata.json (written by manage-deployments.js) and creates
 * a commit message that includes deployment ID and revision.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const metadataFile = path.join(__dirname, '.deploy-metadata.json');

if (!fs.existsSync(metadataFile)) {
  console.error('❌ No deployment metadata found. Did deploy:prod run successfully?');
  process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
const { deploymentId, version, description, target } = metadata;

// Extract version and timestamp from description (e.g., "PROD-WEB-APP v1.6.2 (Rev. May 7, 2026 07:26)")
const versionMatch = description.match(/v\d+\.\d+\.\d+/);
const revMatch = description.match(/Rev\.\s+(.+)\)/);
const deployVersion = versionMatch ? versionMatch[0] : 'unknown';
const deployTimestamp = revMatch ? revMatch[1] : 'unknown';

// Build commit message
const commitMessage = `chore: deploy stamp

Deployed ${deployVersion} to ${target}
Deployment ID: ${deploymentId}
Deployment revision: ${version}
Timestamp: ${deployTimestamp}`;

// Add version.html and commit
execSync('git add src/version.html', { stdio: 'inherit' });
execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });

// Clean up metadata file
fs.unlinkSync(metadataFile);

console.log('✅ Deploy stamp committed with metadata.');
