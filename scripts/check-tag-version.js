#!/usr/bin/env node
'use strict';
const { checkTagVersion } = require('./lib/tagVersion.js');

const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
if (!tag) {
  console.error('Usage: check-tag-version.js <tag>  (or set GITHUB_REF_NAME)');
  process.exit(2);
}

const result = checkTagVersion(tag);
if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}
console.log(`OK: ${tag} matches its package.json version.`);
