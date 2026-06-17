/**
 * Copyright (c) 2026 Stuart Donaldson. Licensed under the MIT License.
 * See LICENSE file for details.
 */

const fs = require('fs');
const path = require('path');

// Get current date and time in format "Feb 3, 2026 14:30"
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
const appVersion = 'v1.5';

const versionPath = path.join(__dirname, 'src', 'version.html');

// Read the file
fs.readFile(versionPath, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading version.html:', err);
    process.exit(1);
  }

  // Replace the version string
  const updatedData = data.replace(
    /version: "[^"]*"/,
    `version: "${appVersion} (Rev. ${currentDateTime})"`
  );

  // Also update buildDate with full ISO datetime
  const buildDateStr = now.toISOString();
  const updatedData2 = updatedData.replace(
    /buildDate: "[^"]*"/,
    `buildDate: "${buildDateStr}"`
  );

  // Write back
  fs.writeFile(versionPath, updatedData2, 'utf8', (err) => {
    if (err) {
      console.error('Error writing version.html:', err);
      process.exit(1);
    }
    console.log(`Revision date/time updated to: ${currentDateTime}`);
  });
});
