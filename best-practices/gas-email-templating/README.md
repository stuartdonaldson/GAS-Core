# Best Practice: GAS HTML Email Templating with HtmlService

## Overview

This pattern produces rich HTML email messages from Google Apps Script using `HtmlService.createTemplateFromFile`. It separates concerns cleanly: an `.html` template file owns markup and inline styles; a renderer function hydrates it; a builder returns the final `{ subject, body, htmlBody }` payload; a delivery policy enforces test-mode redirection; and the sender is decoupled from all of the above.

**Use when:** A GAS project needs to send HTML emails with variable data, loops, or conditionals (lists, tables, checklists, etc.) and you need those emails to be testable without spamming real recipients.

**Provenance:** Extracted from [F3Go30](../../../../c-Proj/F3Go30). Reference files:
- `script/nag.js` — renderer + builder + sender (reminder email with loop and conditional)
- `script/onboardingEmail.js` — renderer + builder (onboarding email with checklists)
- `script/signupEmail.js` — renderer + builder (signup confirmation, three modes)
- `script/responseSettingsEmail.js` — renderer + builder (settings notification)
- `script/ReminderEmailTemplate.html` — template with loop and conditional
- `script/OnboardingEmailTemplate.html` — template with checklist loop
- `script/Utilities.js` — `escapeHtml_()`, `sendConfiguredEmail_()`, delivery policy helpers

---

## Problem

GAS `MailApp`/`GmailApp` accept a plain-text `body` and an `htmlBody` string. Building HTML by string concatenation in JS produces untestable, unmaintainable, XSS-prone code. GAS provides `HtmlService.createTemplateFromFile` — a server-side template engine — but its non-obvious constraints (same-project file names, no auto-escaping, synchronous evaluation) cause bugs when rediscovered ad-hoc. A second problem is **test isolation**: without a policy layer, test runs send real emails to real recipients.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **GAS V8 runtime** | Required for `HtmlService.createTemplateFromFile` |
| **`gmail` or `mail` scope** | `appsscript.json`: `https://www.googleapis.com/auth/gmail.send` (GmailApp) or `https://www.googleapis.com/auth/script.send_mail` (MailApp) |
| **HTML file in same project** | Template `.html` files must live in the same Apps Script project; no path prefix supported |
| **Config sheet (for policy)** | Delivery policy reads `Email Test Mode` and `Site Q` rows from a spreadsheet Config sheet |
| **Drive scope (audit record)** | `https://www.googleapis.com/auth/drive.file` if using the Drive audit record option |

---

## Architecture

```
Caller (trigger, menu item, form submit, etc.)
  |
  +-- sendConfiguredEmail_(options)              <- policy enforcer
  |     reads Config sheet -> test mode?
  |     yes -> redirect to Site Q, prepend TEST MODE banner
  |     no  -> send to intended recipients
  |     optionally -> saveEmailAuditRecord_()    <- write htmlBody to Drive
  |
  +-- buildXxxEmailTemplate_(options)            <- builder
  |     returns { subject, body, htmlBody }
  |
  +-- renderXxxEmailHtml_(options)               <- renderer
  |     if HtmlService available:
  |       template = createTemplateFromFile('XxxEmailTemplate')
  |       hydrate template properties
  |       return template.evaluate().getContent()
  |     else:
  |       return fallback HTML (enables Node.js unit tests)
  |
  +-- XxxEmailTemplate.html                      <- markup + scriptlets (same GAS project)
```

---

## File Layout

```
script/
  XxxEmailTemplate.html   <- markup + scriptlets; no logic beyond display
  xxxEmail.js             <- renderXxxEmailHtml_() + buildXxxEmailTemplate_()
  Utilities.js            <- escapeHtml_(), sendConfiguredEmail_(), policy helpers
  someCaller.js           <- calls buildXxxEmailTemplate_(), passes to sendConfiguredEmail_()
```

---

## Renderer Function

```javascript
function renderReminderEmailHtml_(options) {
  if (typeof HtmlService === 'undefined' || !HtmlService.createTemplateFromFile) {
    // Fallback for test/non-GAS environments — no mocking required
    return '<html><body><p>' + String(options.teamName || '') + '</p></body></html>';
  }

  var template = HtmlService.createTemplateFromFile('ReminderEmailTemplate');
  // Hydrate all template variables before calling evaluate()
  template.teamName         = options.teamName;
  template.missing          = options.missing || [];
  template.trackerUrl       = options.trackerUrl;
  template.targetDateString = options.targetDateString;
  template.funFact          = options.funFact || null;
  return template.evaluate().getContent();
}
```

**Constraints:**
- `createTemplateFromFile` takes the file name **without** `.html` and **without** any path prefix.
- All variables must be assigned on the template object **before** calling `evaluate()`.
- `evaluate()` is synchronous; keep scriptlet logic minimal — compute values in the renderer.

---

## Builder Function

Returns `{ subject, body, htmlBody }`. The plain-text `body` serves clients that strip HTML.

```javascript
function buildReminderEmailTemplate_(options) {
  return {
    subject: 'Go30 Reminder | ' + options.teamName + ' | ' + options.targetDateString,
    body: options.missing.map(function(m) { return m.name; }).join('\n'),
    htmlBody: renderReminderEmailHtml_(options)
  };
}
```

Always supply both `body` and `htmlBody`. Never omit `body`.

---

## Template File (Scriptlet Syntax)

### Basic list with conditional

```html
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">

    <h1>Missing check-ins for <?= targetDateString ?></h1>

    <? if (funFact) { ?>
      <p><strong><?= funFact ?></strong></p>
    <? } ?>

    <ul>
      <? for (var i = 0; i < missing.length; i++) { ?>
        <li>
          <strong><?= missing[i].name ?></strong>
          <? if (missing[i].who) { ?>
            - goal: <?= missing[i].who ?>
          <? } ?>
        </li>
      <? } ?>
    </ul>

    <p><a href="<?= trackerUrl ?>">Open tracker</a></p>

  </body>
</html>
```

### Table

```html
<table style="border-collapse:collapse;width:100%;font-size:14px;">
  <thead>
    <tr style="background:#f3f3f3;">
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Name</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Goal</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Status</th>
    </tr>
  </thead>
  <tbody>
    <? for (var i = 0; i < rows.length; i++) { ?>
      <tr>
        <td style="border:1px solid #ccc;padding:6px 10px;"><?= rows[i].name ?></td>
        <td style="border:1px solid #ccc;padding:6px 10px;"><?= rows[i].goal ?></td>
        <td style="border:1px solid #ccc;padding:6px 10px;"><?= rows[i].status ?></td>
      </tr>
    <? } ?>
  </tbody>
</table>
```

Pass `template.rows = options.rows || []` in the renderer before `evaluate()`. Apply all styles inline — most email clients strip `<style>` blocks.

### Checklist

```html
<ul style="list-style:none;padding:0;">
  <? for (var i = 0; i < checklist.length; i++) { ?>
    <li style="margin:0 0 6px;">
      <span style="color:#2a7a2a;font-weight:bold;">&#x2611;</span> <?= checklist[i] ?>
    </li>
  <? } ?>
</ul>
```

---

## Sending

```javascript
// MailApp — sends as the script deployer (owner)
var email = buildReminderEmailTemplate_(opts);
MailApp.sendEmail(to, email.subject, email.body, { htmlBody: email.htmlBody });

// GmailApp — sends as the active OAuth user
GmailApp.sendEmail(to, email.subject, email.body, {
  htmlBody: email.htmlBody,
  name: 'My App'
});
```

**Sender identity:** `MailApp` sends from the deployer's address. `GmailApp` sends from the user who authorised the script. Choose deliberately based on who the recipient should see.

---

## XSS Rule

`<?= val ?>` does **not** auto-escape HTML. Always pass user-controlled strings through `escapeHtml_()`:

```javascript
function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

Any value from a spreadsheet cell, form response, URL parameter, or user input is user-controlled. Put `escapeHtml_()` in `Utilities.js` and share it across all renderers.

---

## Email Delivery Policy

The policy layer intercepts every send call and either:
1. **Production:** sends to the real recipients, or
2. **Test mode:** redirects all email to a safe test address and prepends a TEST MODE banner.

This prevents test runs from spamming real users and provides a clear audit trail.

### Config sheet entries

| Column A (key) | Column B (primary) | Column C (secondary) |
|---|---|---|
| `Email Test Mode` | `Yes` or `No` | (unused) |
| `Site Q` | Display name | Email address — used as the test recipient |

### Policy reader

```javascript
function readEmailDeliveryPolicy_(spreadsheet, configData) {
  var testModeConfig = getConfigValue_(spreadsheet, 'Email Test Mode', configData);
  var siteQConfig    = getConfigValue_(spreadsheet, 'Site Q', configData);
  return {
    emailTestMode: isConfigYesLike_(testModeConfig && testModeConfig.primary),
    siteQEmail:    sanitizePolicyEmailAddress_(siteQConfig && siteQConfig.secondary),
    siteQName:     String(siteQConfig && siteQConfig.primary || '').trim()
  };
}
```

### TEST MODE banner (injected into htmlBody)

```javascript
function buildTestModeNoticeHtml_(intendedRecipients) {
  return [
    '<div style="margin:0 0 16px;padding:12px 14px;',
    'border:2px solid #b42318;background:#fef3f2;color:#7a271a;font-weight:bold;">',
    'TEST MODE &mdash; Intended recipients: ' + escapeHtml_(intendedRecipients),
    '</div>'
  ].join('');
}
```

### Unified send wrapper

```javascript
function sendConfiguredEmail_(options) {
  // options: { spreadsheet, configData, recipients, subject, body, htmlBody, logLabel }
  var delivery = prepareOutboundEmailDelivery_(options);
  if (!delivery.ok) {
    Logger.log((options.logLabel || 'sendConfiguredEmail') + ': ' + delivery.error);
    return;
  }
  if (delivery.message.htmlBody) {
    MailApp.sendEmail(delivery.message.to, delivery.message.subject,
      delivery.message.body, { htmlBody: delivery.message.htmlBody });
  } else {
    MailApp.sendEmail(delivery.message.to, delivery.message.subject,
      delivery.message.body);
  }
}
```

`prepareOutboundEmailDelivery_()` returns an object with these shapes:

```javascript
// Production
{ ok: true, testMode: false,
  message: { to, subject, body, htmlBody },
  intendedRecipients: '...', effectiveRecipients: '...' }

// Test mode — redirected + banner injected into subject, body, and htmlBody
{ ok: true, testMode: true,
  message: { to: siteQEmail, subject: '[TEST MODE] ...', body: 'TEST MODE ...\n\n...', htmlBody: '<banner>...' },
  intendedRecipients: '...', effectiveRecipients: siteQEmail }
```

**Important:** every send path in the project must go through `sendConfiguredEmail_()`. Direct `MailApp.sendEmail()` calls bypass the policy.

---

## Saving Email as a Drive Audit Record

For projects that need a durable record of every sent email — or want to verify rendering without sending at all — write the `htmlBody` to a Drive file after sending:

```javascript
function saveEmailAuditRecord_(subject, htmlBody, folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var timestamp = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var title = '[Email Audit] ' + subject + ' - ' + timestamp;
  folder.createFile(Utilities.newBlob(htmlBody, 'text/html', title + '.html'));
}
```

Call this inside `sendConfiguredEmail_()` after the `MailApp.sendEmail()` call. The folder ID can be stored as a Script Property (`EMAIL_AUDIT_FOLDER_ID`) and read at runtime. In test mode this gives you a full rendered preview of what the recipient would have seen, stored in Drive for inspection.

---

## Testing Outside GAS

The `HtmlService` guard in the renderer means unit tests run without mocking:

```javascript
// Node.js unit test (node:test)
const { buildReminderEmailTemplate_ } = require('./nag.js');
const assert = require('assert');
const { test } = require('node:test');

test('builder returns subject, body, htmlBody', () => {
  var result = buildReminderEmailTemplate_({
    teamName: 'Iron PAX',
    targetDateString: '06/01/2026',
    trackerUrl: 'https://example.com',
    missing: [{ name: 'Hammerhead', who: '30 burpees' }]
  });
  assert.ok(result.subject.includes('Iron PAX'));
  assert.ok(result.body.includes('Hammerhead'));
  assert.ok(typeof result.htmlBody === 'string' && result.htmlBody.includes('<'));
});
```

For end-to-end validation of the rendered template itself, use the Playwright pattern ([`../gas-playwright-testing/README.md`](../gas-playwright-testing/README.md)) and inspect the Drive audit record.

---

## Constraints and Trade-offs

| Concern | Detail |
|---|---|
| **File naming** | `createTemplateFromFile('Foo')` looks for `Foo.html` in the same GAS project. No subdirectory or path prefix. |
| **No auto-escaping** | `<?= val ?>` does not escape HTML. Call `escapeHtml_()` on all user data. |
| **Synchronous evaluation** | `template.evaluate()` is synchronous. Keep scriptlet logic minimal; compute in the renderer. |
| **Plain-text body** | Always supply `body` (plain text) alongside `htmlBody`. |
| **Inline styles** | Email clients strip `<style>` blocks. Apply all styles inline. |
| **Sender identity** | `MailApp` vs `GmailApp` affects the visible sender. Choose deliberately. |
| **Policy enforcement** | Test-mode redirect only works if all sends go through `sendConfiguredEmail_()`. |
| **Drive audit scope** | Requires `DriveApp` scope (`https://www.googleapis.com/auth/drive.file`) in `appsscript.json`. |
| **Testability** | Builder + renderer are Node.js unit-testable without mocking. Template rendering requires GAS or an end-to-end test. |
