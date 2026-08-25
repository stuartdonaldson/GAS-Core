'use strict';

/**
 * The standard deploy summary (RECOMMENDATION.md §3.1, finding #2).
 *
 * Six of seven copies printed no end-of-deploy summary, usually just the /exec URL. This is the
 * mandatory final step of every deploy, and is reachable standalone so "what is deployed right
 * now?" never requires deploying.
 *
 * Rules, all of them learned from a specific failure:
 *   - The deployment ID is printed **in full, never truncated** — a truncated ID cannot be
 *     pasted into call-webapp or a bug report. (Progress lines elsewhere may still abbreviate.)
 *   - A row whose input is absent prints an explanation, never a broken URL. RCV's
 *     "(sheetId not set in local.settings.json)" is the model: it names the missing key, so the
 *     reader knows what to go set.
 *   - The version row carries the **server-confirmed** value from assertDeployedVersion, not the
 *     locally stamped one — the summary reports what is actually serving.
 */

function line_(label, value) {
  return `   ${(label + ':').padEnd(17)}${value}`;
}

/**
 * `rows` lets a project add its own without this function knowing about them:
 *   extraRows: [{ label: 'Static page', value: url, missing: '(static hosting not configured)' }]
 */
function printDeploySummary({
  label,
  emoji = '📦',
  version,
  now,
  deploymentId,
  revision,
  scriptId,
  scriptIdKey = 'scriptId',
  sheetId,
  sheetIdKey = 'sheetId',
  extraRows = [],
  tooling = null,
  log = console.log,
}) {
  const out = [];
  out.push(`\n${emoji}  ${label} deploy summary`);
  out.push(line_('Product version', version ? `v${version}` : '(unknown)'));
  out.push(line_('Stamped at', now || '(unknown)'));
  out.push(line_('Deployment ID', deploymentId || '(unavailable)'));
  out.push(line_('Revision', revision ? `@${revision}` : '(unresolved)'));
  out.push(line_('Script project', scriptId
    ? `${scriptId.slice(0, 12)}…   https://script.google.com/home/projects/${scriptId}/edit`
    : `(${scriptIdKey} not set in local.settings.json)`));
  out.push(line_('Webapp', deploymentId
    ? `https://script.google.com/macros/s/${deploymentId}/exec`
    : '(deployment ID unavailable)'));

  for (const row of extraRows) {
    if (!row) continue;
    out.push(line_(row.label, row.value || row.missing || '(not configured)'));
  }

  out.push(line_('Spreadsheet', sheetId
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
    : `(${sheetIdKey} not set in local.settings.json)`));
  // Last, and only when supplied: provenance about the tools, not about the deployment. It is
  // here so a consumer two minor versions behind finds that out on a deploy rather than never
  // (PLAN2 F10) — pair it with the package CHANGELOGs, which say what the newer version gives.
  if (tooling) out.push(line_(tooling.label || 'Tooling', tooling.value || tooling.missing || '(unknown)'));
  out.push('');

  for (const l of out) log(l);
  return out.join('\n');
}

module.exports = { printDeploySummary };
