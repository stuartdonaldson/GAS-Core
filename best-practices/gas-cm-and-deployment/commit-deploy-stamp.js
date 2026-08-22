#!/usr/bin/env node

/**
 * Commit the deploy stamp with deployment metadata in the message.
 * Called by release:patch/minor/major scripts after deployment completes.
 *
 * Usage: node commit-deploy-stamp.js [stamped-file-path]
 *   stamped-file-path defaults to src/version.html; pass your project's actual stamped
 *   file (e.g. script/version.js) if it differs.
 *
 * Reads .deploy-metadata.json — written by gas-deploy's deploy() after every successful
 * deploy, in its own shape: { at, target, version, deploymentId, revision, scriptId }.
 * This is a plain field read, not a description-string parse: gas-deploy's metadata has
 * no `description` field to parse in the first place.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const stampedFile = process.argv[2] || 'src/version.html';
const metadataFile = path.join(__dirname, '.deploy-metadata.json');

if (!fs.existsSync(metadataFile)) {
  console.error('❌ No deployment metadata found. Did deploy:prod run successfully?');
  process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
const { deploymentId, version, revision, target, at } = metadata;

const commitMessage = `chore: deploy stamp

Deployed v${version} to ${target}
Deployment ID: ${deploymentId}
Deployment revision: ${revision}
Timestamp: ${at}`;

execSync(`git add ${stampedFile}`, { stdio: 'inherit' });
execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });

fs.unlinkSync(metadataFile);

console.log('✅ Deploy stamp committed with metadata.');
