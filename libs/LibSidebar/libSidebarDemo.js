'use strict';

/**
 * libs/LibSidebar/libSidebarDemo.js — co-located demo logic for LibSidebar.
 *
 * Hybrid model (bd memory test-demo-harness-hybrid-model-2026-06-18,
 * docs/test-harness-design.md §4.1/§4.3): a library-prefixed manifest of named
 * global functions, not a closure array. `demo` is a STRING naming a real
 * global function so the shared wrapper's onOpen() menu builder can bind
 * `menu.addItem(name, e.demo)` directly (GAS menu items only bind named
 * globals, not closures). Each demo function is zero-arg and pulls its
 * environment from the shared wrapper's `Harness.getSheet()` instead of
 * receiving a ctx argument.
 *
 * `kind: 'sidebar'` entries launch an HTML sidebar (NotificationSidebar.html,
 * served via NoticeLogInit() in libs/LibSidebar/NotificationSBCode.js) rather
 * than running to completion synchronously. GAS menu items can only route to
 * zero-arg named functions, so the menu click simply opens the sidebar and
 * returns immediately; the sidebar then drives further interaction itself
 * via the client/server message queue (google.script.run polling).
 *
 * Never vendored into a consumer's production clasp deployment — only
 * NotificationSBCode.js + NotificationSidebar.html are (see CONSUMERS.md).
 * Pushed alongside those files by scripts/push-demo.sh whenever a demo's
 * demo.config.json lists LibSidebar in its `uses`.
 *
 * Plain GAS-V8: no require(), no module-scoped const collisions across
 * libraries (this file's globals are all `libSidebar_`-prefixed, and the
 * manifest is `LIBSIDEBAR_DEMOS`, both unique to this library).
 */

/** @type {Array<{name: string, demo: string, kind?: 'menu'|'webapp'|'sidebar'}>} */
var LIBSIDEBAR_DEMOS = [
  { name: 'LibSidebar: Notification Sidebar Demo', demo: 'libSidebar_notificationSidebarDemo', kind: 'sidebar' },
];

/**
 * Launches the LibSidebar notification sidebar and drives it through a short
 * scripted sequence: a title/description, a few progress log lines, a link,
 * and a prompt that waits for the user's response.
 *
 * `kind: 'sidebar'` demos do not run their full interaction synchronously
 * from the harness's perspective — opening the sidebar (NoticeLogInit) is
 * itself the visible effect of the menu click. The remaining scripted steps
 * below run on the same server-side call (GAS allows this; NoticePrompt
 * blocks via the script-properties queue/poll loop in
 * NotificationSBCode.js), so the function still only returns once the
 * scripted demo completes or the prompt step times out.
 *
 * @returns {{status: 'ok'|'error', feature: string, message?: string, data?: Object, error?: string}}
 */
function libSidebar_notificationSidebarDemo() {
  try {
    NoticeLogInit(
      'LibSidebar Notification Demo',
      'This demo opens the notification sidebar and drives it through a ' +
        'title, <b>description</b>, a few log messages, a link, and a ' +
        'prompt for response.'
    );

    NoticeLog('progress step 1');
    NoticeLog('-');
    Utilities.sleep(1000);
    NoticeLog('progress step 2');
    Utilities.sleep(1000);
    NoticeLog('progress step 3');

    NoticeLog(`Click ${blf('here', 'https://example.com')} to access the link`);

    const response = NoticePrompt('Enter your name', 'Please enter your name:');
    NoticeLog('You entered ' + (response === null ? '(no response — timed out)' : response));
    NoticeLog('Demo complete');

    return {
      status: 'ok',
      feature: 'notificationSidebar',
      message: 'Opened the notification sidebar and ran the scripted log/prompt sequence.',
      data: { response: response },
    };
  } catch (err) {
    return {
      status: 'error',
      feature: 'notificationSidebar',
      message: 'Notification sidebar demo failed.',
      error: err.message,
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  // Node test-sandbox path only — never vendored, never present in a real
  // GAS V8 runtime, where `module` is undefined and these globals are read
  // directly off the shared global scope by examples/demo-harness/harness.js.
  module.exports = { LIBSIDEBAR_DEMOS, libSidebar_notificationSidebarDemo };
}
