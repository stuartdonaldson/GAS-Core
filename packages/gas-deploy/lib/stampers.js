'use strict';

/**
 * Stampers write the build identity into whatever shape a project's GAS runtime already reads.
 * RECOMMENDATION.md #4 found three shapes across seven copies; rather than force a migration
 * (which would be a behaviour change, and §5 puts those out of scope), the package carries both
 * and a project picks one in config.
 *
 * Every stamper has the same contract:
 *   stamp({ root, label, version, now }) -> { version, now, label }
 * It WRITES only. Nothing reads a version back out of the file it stamped (#5).
 */

const fs = require('fs');
const path = require('path');
const { replaceConst } = require('./version.js');

/**
 * Lineage B shape — `const APP_VERSION = '…';` in script/version.js (F3Go30, RankChoiceVoting).
 * Field names are configurable because the constants are project globals in the GAS-concatenated
 * scope and renaming them would be a runtime change.
 */
function constStamper({ file, versionConst = 'APP_VERSION', dateConst = 'APP_VERSION_DATE', targetConst = 'APP_DEPLOY_TARGET' } = {}) {
  if (!file) throw new Error('constStamper requires a { file } path relative to the project root');
  const stamp = ({ root, label, version, now, log = console.log }) => {
    const filePath = path.join(root, file);
    let src = fs.readFileSync(filePath, 'utf8');
    src = replaceConst(src, versionConst, `'${version}'`);
    src = replaceConst(src, dateConst, `'${now}'`);
    src = replaceConst(src, targetConst, `'${label}'`);
    fs.writeFileSync(filePath, src, 'utf8');
    log(`📝 ${file} stamped: v${version}  ${now}  ${label}`);
    return { version, now, label };
  };
  stamp.stamperName = `constStamper(${file})`;
  stamp.file = file;
  return stamp;
}

/**
 * Lineage A shape — a `BUILD_INFO = { version, date, target, ... }` object literal, in either a
 * .js or an .html file (GActionSheet's Version.js, PracticeMix's version.html). The whole object
 * literal is rewritten, so keys the project added by hand are NOT preserved — the object is
 * generated output, which is exactly the property #5 says it must have.
 */
function buildInfoStamper({ file, constName = 'BUILD_INFO', extraFields = {} } = {}) {
  if (!file) throw new Error('buildInfoStamper requires a { file } path relative to the project root');
  const stamp = ({ root, label, version, now, webAppUrl, log = console.log }) => {
    const filePath = path.join(root, file);
    const src = fs.readFileSync(filePath, 'utf8');

    const payload = {
      version,
      date: now,
      target: label,
      ...(webAppUrl ? { webAppUrl } : {}),
      ...extraFields,
    };
    const literal = JSON.stringify(payload, null, 2);

    // Matches `const BUILD_INFO = { … };` / `var BUILD_INFO = { … };` across newlines, stopping
    // at the first `};` at line start — the shape every lineage-A copy actually writes.
    const re = new RegExp(`((?:const|var|let)\\s+${constName}\\s*=\\s*)\\{[\\s\\S]*?\\n\\}\\s*;`, 'm');
    let out;
    if (re.test(src)) {
      out = src.replace(re, `$1${literal};`);
    } else {
      out = src.trimEnd() + `\nconst ${constName} = ${literal};\n`;
    }
    fs.writeFileSync(filePath, out, 'utf8');
    log(`📝 ${file} stamped: v${version}  ${now}  ${label}`);
    return { version, now, label };
  };
  stamp.stamperName = `buildInfoStamper(${file})`;
  stamp.file = file;
  return stamp;
}

module.exports = { constStamper, buildInfoStamper };
