/**
 * gas-backend-example.js — minimal doPost JSON dispatcher for a static-frontend GAS web app,
 * plus a worked Google Identity Services (GIS) verification example.
 *
 * Pairs with cors-fetch-client.html's callApi() and static/src/index.html's demo page. Deploy
 * this as a GAS web app (manifest: appsscript.json.example — ANYONE_ANONYMOUS + USER_DEPLOYING)
 * and paste its /exec URL into the static demo page to drive it live. See ../README.md for the
 * full pattern this implements.
 *
 * Two actions:
 *   - "ping"   — no identity required. Proves the CORS/dispatch plumbing works end to end.
 *   - "whoami" — requires a Google ID token (idToken) in the request body. Demonstrates the
 *                identity & access control pattern from ../README.md's final section: verify
 *                the token server-side, key on `sub`, apply an allowlist, fail closed.
 */

// -- Dispatcher --------------------------------------------------------------------------------

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Malformed JSON body' });
  }

  var action = body.action;
  try {
    switch (action) {
      case 'ping':
        return jsonResponse_(demoPing_());
      case 'whoami':
        return jsonResponse_(demoWhoAmI_(body.idToken));
      default:
        return jsonResponse_({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message || err) });
  }
}

/** text/plain, not application/json — a JSON Content-Type on the RESPONSE is fine (browsers
 *  don't preflight on response headers), but note doPost() above reads e.postData.contents
 *  regardless of what Content-Type the client sent, so this stays agnostic either way. */
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// -- "ping" action -------------------------------------------------------------------------------

function demoPing_() {
  return { ok: true, serverTimeIso: new Date().toISOString(), version: getScriptVersion_() };
}

function getScriptVersion_() {
  return PropertiesService.getScriptProperties().getProperty('APP_VERSION') || 'dev';
}

// -- "whoami" action: Google Identity Services verification --------------------------------------

// Populate with your GIS OAuth client ID (the same one static/src/index.html's
// GOOGLE_CLIENT_ID is configured with) — required so a token minted for a DIFFERENT app can't be
// replayed against this backend. Store as a Script Property in real deployments, not hardcoded.
var GIS_CLIENT_ID_PROPERTY_ = 'GIS_CLIENT_ID';

// Script Property holding a comma-separated allowlist of Google account `sub` claims permitted
// to pass whoami's isAllowlisted check. Empty/unset = nobody is allowlisted (fail closed).
var GIS_ALLOWLIST_PROPERTY_ = 'GIS_ALLOWLIST_SUBS';

/**
 * Verifies a Google ID token (JWT) the client obtained via GIS Sign In With Google / One Tap,
 * using the non-sensitive openid/email/profile scopes only — no consent screen, no access to the
 * visitor's data. See ../README.md's "What a first-party page unlocks next" section for the full
 * rationale: this authenticates WHO the visitor is; it grants no authorization on its own.
 *
 * At low request volume, delegating verification to Google's tokeninfo endpoint (as done here)
 * is the simplest correct approach. At higher volume, verify locally against Google's published
 * JWKS (RS256) instead, to avoid a UrlFetchApp round trip per request.
 */
function demoWhoAmI_(idToken) {
  if (!idToken) return { ok: false, error: 'Missing idToken' };

  var props = PropertiesService.getScriptProperties();
  var expectedAudience = props.getProperty(GIS_CLIENT_ID_PROPERTY_);
  if (!expectedAudience) {
    return { ok: false, error: 'Server not configured: ' + GIS_CLIENT_ID_PROPERTY_ + ' script property is unset' };
  }

  var claims = verifyGoogleIdToken_(idToken, expectedAudience);
  if (!claims) return { ok: false, error: 'Invalid or expired identity token' };

  var allowlisted = isSubAllowlisted_(claims.sub, props);
  return {
    ok: true,
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === 'true' || claims.email_verified === true,
    name: claims.name || null,
    allowlisted: allowlisted,
    // Fail closed in the CALLER, not just here: a real protected action should check
    // `allowlisted` itself before doing anything privileged, exactly like this function does.
  };
}

/**
 * Calls Google's tokeninfo endpoint and validates aud/iss/exp. Returns the verified claims, or
 * null for anything malformed, expired, or issued for a different audience/issuer — never
 * throws, so callers can treat it exactly like a failed lookup and fail closed by default.
 */
function verifyGoogleIdToken_(idToken, expectedAudience) {
  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
  } catch (e) {
    return null;
  }
  if (response.getResponseCode() !== 200) return null;

  var claims;
  try {
    claims = JSON.parse(response.getContentText());
  } catch (e) {
    return null;
  }

  if (claims.aud !== expectedAudience) return null;
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return null;
  var expMs = Number(claims.exp) * 1000;
  if (!isFinite(expMs) || Date.now() >= expMs) return null;
  if (!claims.sub) return null;

  return claims;
}

function isSubAllowlisted_(sub, props) {
  var raw = props.getProperty(GIS_ALLOWLIST_PROPERTY_) || '';
  var allowed = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return allowed.indexOf(sub) !== -1;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    demoPing_: demoPing_,
    demoWhoAmI_: demoWhoAmI_,
    verifyGoogleIdToken_: verifyGoogleIdToken_,
    isSubAllowlisted_: isSubAllowlisted_,
  };
}
