/**
 * Stamps version and deployment date into src/version.html.
 *
 * Reads the version from package.json so it stays in sync with npm version.
 * Called by deploy:test and deploy:prod npm scripts before clasp push.
 * Do not call directly — use the npm scripts so this always runs as part of deploy.
 */

const fs = require('fs');
const path = require('path');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const appVersion = `v${packageJson.version}`;

const now = new Date();
const dateStr = now.toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});
const timeStr = now.toLocaleTimeString('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});
const currentDateTime = `${dateStr} ${timeStr}`;

const versionPath = path.join(__dirname, 'src', 'version.html');

fs.readFile(versionPath, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading version.html:', err);
    process.exit(1);
  }

  const updatedData = data.replace(
    /version: "[^"]*"/,
    `version: "${appVersion} (Rev. ${currentDateTime})"`
  );

  const buildDateStr = now.toISOString();
  const updatedData2 = updatedData.replace(
    /buildDate: "[^"]*"/,
    `buildDate: "${buildDateStr}"`
  );

  fs.writeFile(versionPath, updatedData2, 'utf8', (err) => {
    if (err) {
      console.error('Error writing version.html:', err);
      process.exit(1);
    }
    console.log(`Revision stamped: ${appVersion} — ${currentDateTime}`);
  });
});
