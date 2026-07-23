/**
 * Admin.js — admin-only routes, gated by a set-once shared secret.
 *
 * Mirrors F3Go30's src/WebApp.js admin pattern: the secret is never typed into
 * the Apps Script editor by hand. A one-time bootstrapSecret call sets
 * ADMIN_SHARED_SECRET (refuses to run again once set); every other admin
 * action must echo that secret back in the POST body (never the query
 * string, so it never lands in access logs / curl history). Call via
 * `node tools/call-webapp.js <action>` — that tool reads adminSecret and the
 * webapp URLs from local.settings.json (gitignored) and handles the payload
 * shape (defaults `--cmd admin`), so admin calls never need to be hand-built —
 * including never hand-building a curl/fetch call with a hardcoded deployment
 * URL; the tool is the one place that URL lives locally.
 *
 * TEST-WEB-APP and PROD-WEB-APP are two deployments of the same script
 * project, so they share one PropertiesService.getScriptProperties() store —
 * bootstrapping/calling admin actions against either deployment's /exec URL
 * has the same effect.
 */
function _handleAdminPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _jsonOutput({ ok: false, error: 'invalid_json' });
  }

  if (payload.action === 'bootstrapSecret') {
    return _jsonOutput(_bootstrapAdminSecret(payload.secret));
  }

  var storedSecret = PropertiesService.getScriptProperties().getProperty('ADMIN_SHARED_SECRET');
  if (!storedSecret || payload.adminSecret !== storedSecret) {
    GasLogger.log('admin.forbidden', { action: payload.action });
    return _jsonOutput({ ok: false, error: 'forbidden' });
  }

  if (payload.action === 'setScriptProperties') {
    var keys = Object.keys(payload.properties || {});
    PropertiesService.getScriptProperties().setProperties(payload.properties || {});
    GasLogger.log('admin.setScriptProperties', { keys: keys });
    return _jsonOutput({ ok: true, keysSet: keys });
  }

  // Diagnostic: reports who the runtime executes as and which OAuth scopes
  // its token actually carries (fetched live from Google's tokeninfo, so it
  // reflects the real grant, not the manifest). The raw token itself is
  // never returned.
  if (payload.action === 'getAuthInfo') {
    GasLogger.log('admin.getAuthInfo', {});
    var authScopes = '';
    try {
      var tokResp = UrlFetchApp.fetch(
        'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(ScriptApp.getOAuthToken()),
        { muteHttpExceptions: true }
      );
      authScopes = (JSON.parse(tokResp.getContentText()).scope || '');
    } catch (err) {
      authScopes = 'lookup_failed: ' + err;
    }
    return _jsonOutput({
      ok: true,
      effectiveUser: Session.getEffectiveUser().getEmail(),
      scopes: authScopes
    });
  }

  return _jsonOutput({ ok: false, error: 'unknown_action' });
}

function _bootstrapAdminSecret(secret) {
  if (!secret || String(secret).length < 16) {
    return { ok: false, error: 'secret must be at least 16 characters' };
  }
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMIN_SHARED_SECRET')) {
    return { ok: false, error: 'already_bootstrapped' };
  }
  props.setProperty('ADMIN_SHARED_SECRET', String(secret));
  GasLogger.log('admin.bootstrapped', {});
  return { ok: true };
}
