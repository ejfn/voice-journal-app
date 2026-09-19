#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const DEV_VERSION_PATH = path.join(__dirname, '..', 'src', 'dev-version.json');

try {
  // Get git commit hash
  const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

  // Get latest version tag and calculate next minor version
  let baseVersion = '1.0.0';
  try {
    const lastTag = execSync('git tag -l "v*.*.0" --sort=-version:refname', {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')[0];
    if (lastTag) {
      const lastVersion = lastTag.replace('v', '');
      const [major, minor, patch] = lastVersion.split('.').map(Number);
      baseVersion = `${major}.${minor + 1}.0`;
    }
  } catch {
    // No tags found, use default version
  }

  // Create dev version info
  const devVersion = {
    version: `v${baseVersion}-dev`,
    gitCommit,
    timestamp: new Date().toISOString(),
  };

  // Ensure src directory exists
  const srcDir = path.dirname(DEV_VERSION_PATH);
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }

  // Write dev version file
  fs.writeFileSync(
    DEV_VERSION_PATH,
    JSON.stringify(devVersion, null, 2) + '\n',
  );

  console.log(
    `✓ Injected dev version: ${devVersion.version}+${gitCommit.substring(0, 7)}`,
  );
} catch (error) {
  console.warn('⚠️ Could not inject dev version:', error.message);
}
