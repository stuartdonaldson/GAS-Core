'use strict';

/**
 * The committed half of the two-file declared-config split — adr/0002 as narrowed by adr/0004.
 *
 * `gas-project.json` holds **project truth**: facts that are the same for every developer on the
 * project and therefore belong where a typo is caught in review once instead of per machine. Today
 * that is each target's `scriptId` and `sheetId`, scoped structurally by target key rather than by
 * a key prefix:
 *
 *   { "envs": { "sit": { "scriptId": "1tGL…", "sheetId": "1RCQ…" } } }
 *
 * `local.settings.json` keeps **machine truth and secrets**: clasp auth paths, admin secrets, the
 * deployment-ID cache the deploy writes back. Nothing here ever reads or writes that file's half.
 *
 * The `*Key` indirection (`scriptIdKey`, `sheetIdKey`) into local.settings.json stays supported and
 * is how an unmigrated project keeps working untouched — it is a legacy override, not the normal
 * way to configure a project. Precedence is therefore NOT "local overrides project": a scriptId is
 * project truth by category, so the committed file wins and a leftover copy in local.settings.json
 * is reported as the drift it is. That drift is the failure ADR-0002 §Context exists to remove;
 * silently preferring one file would hide it.
 *
 * ADR-0002 §Consequences names the cost of splitting: two files can now *disagree*, so the split
 * trades silent drift for silent absence unless every disagreement fails loudly and by name. That
 * is what `assertEnvDeclared_` and the error messages below are for — an env declared in the
 * committed half with no secret in the gitignored one must say so, naming both the key and both
 * files, rather than failing somewhere further down as "clasp fell back to ~/.clasprc.json".
 */

const fs = require('fs');
const path = require('path');

const PROJECT_FILE = 'gas-project.json';

/**
 * Reads the committed project-truth file. Returns null when the project has none — that is the
 * unmigrated case, not an error, and every caller below degrades to the legacy lookup.
 *
 * A malformed file IS an error, and deliberately not the raw parser message: "Unexpected end of
 * JSON input" names neither the file nor the fix.
 */
function loadProjectConfig(root, file = PROJECT_FILE) {
  const projectPath = path.join(root, file);
  if (!fs.existsSync(projectPath)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${projectPath}): ${err.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file} must be a JSON object (${projectPath}).`);
  }
  return { path: projectPath, file, data, envs: data.envs || null };
}

/**
 * A project that declares an `envs` block declares it completely: a target missing from it is a
 * config error, not a silent fall-through to the legacy keys. Otherwise adding a target to the JS
 * config and forgetting the committed half would keep working on the machine that already has the
 * stale local.settings.json entry and fail only on a fresh clone — the exact per-machine
 * divergence the split removes.
 */
function assertEnvDeclared_(project, targetKey) {
  if (!project || !project.envs) return;
  if (project.envs[targetKey]) return;
  const declared = Object.keys(project.envs);
  throw new Error(
    `Target "${targetKey}" is not declared in ${project.file}. ` +
    `Declared envs: ${declared.length ? declared.join(', ') : '(none)'}. ` +
    `Add an "envs.${targetKey}" entry, or remove the envs block to fall back to the legacy ` +
    `*Key lookups in local.settings.json.`
  );
}

/**
 * Resolves one per-env fact, committed half first.
 *
 * @param {string} name        canonical fact name — the key inside `envs.<target>` ('scriptId').
 * @param {object} ctx         { project, settings, target, targetKey, log }
 * @param {boolean} [required] throw naming BOTH files when neither carries it.
 */
function targetFact(name, { project, settings, target, targetKey, log = console.log }, { required = false } = {}) {
  const legacyKey = target[`${name}Key`];
  const legacyValue = legacyKey ? settings[legacyKey] : undefined;
  const declared = project && project.envs && project.envs[targetKey];
  const projectValue = declared ? declared[name] : undefined;

  if (projectValue !== undefined && projectValue !== null && String(projectValue) !== '') {
    // Both halves carrying the same fact is the drift the split exists to remove. The committed
    // half wins, but saying nothing would leave the stale copy to be "fixed" on the next machine.
    if (legacyValue && String(legacyValue) !== String(projectValue)) {
      log(
        `⚠️  ${name} disagrees between the two config files: ${project.file} says "${projectValue}", ` +
        `local.settings.json's ${legacyKey} says "${legacyValue}". Using ${project.file} — ` +
        `${legacyKey} is project truth and no longer belongs in local.settings.json; delete it.`
      );
    }
    return projectValue;
  }

  if (legacyValue && !String(legacyValue).startsWith('<')) return legacyValue;

  if (required) {
    throw new Error(
      `${legacyKey || name} is not set: no "envs.${targetKey}.${name}" in ` +
      `${project ? project.file : PROJECT_FILE} (project truth), and no ${legacyKey || name} in ` +
      `local.settings.json (legacy override).`
    );
  }
  return undefined;
}

/**
 * The clasp credential file is machine truth and lives only in local.settings.json — so an env
 * declared in the committed half is exactly where "declared but no secret" becomes real. Checked
 * here, before anything shells out, so the message can name the env, the key and both files;
 * clasp.js's own check fires later and knows only the key.
 */
function assertSecretsPresent_(project, targetKey, target, settings) {
  if (!project || !project.envs || !project.envs[targetKey]) return;
  const authKey = target.authKey || 'claspAuth';
  if (settings[authKey]) return;
  throw new Error(
    `Env "${targetKey}" is declared in ${project.file}, but local.settings.json has no ${authKey}. ` +
    `The committed half declares the env; the gitignored half must supply its secret — without ` +
    `${authKey}, clasp would silently fall back to ~/.clasprc.json, which may be another Google account.`
  );
}

module.exports = {
  PROJECT_FILE,
  loadProjectConfig,
  assertEnvDeclared_,
  assertSecretsPresent_,
  targetFact,
};
