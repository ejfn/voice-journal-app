#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const DEV_VERSION_PATH = path.join(__dirname, '..', 'src', 'dev-version.json');

try {
  // Get git commit hash
  const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

  // Get latest version tag and calculate next minor version (or next patch on release branches)
  let baseVersion = '0.1.0';
  try {
    let isReleaseBranch = false;
    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
      }).trim();
      const match = currentBranch.match(/^release\/v?(\d+)\.(\d+)/);
      if (match) {
        const [, relMajor, relMinor] = match;
        const lastPatchTag = execSync(
          `git tag -l "v${relMajor}.${relMinor}.[0-9]*" --sort=-version:refname`,
          { encoding: 'utf8' },
        )
          .trim()
          .split('\n')[0];
        let nextPatch = 0;
        if (lastPatchTag) {
          const patchNum = parseInt(
            lastPatchTag.replace(/^v/, '').split('.')[2],
            10,
          );
          if (!isNaN(patchNum)) nextPatch = patchNum + 1;
        }
        baseVersion = `${relMajor}.${relMinor}.${nextPatch}`;
        isReleaseBranch = true;
      }
    } catch {
      // Ignore git branch parse errors and fallback
    }

    if (!isReleaseBranch) {
      const lastTag = execSync('git tag -l "v*.*.0" --sort=-version:refname', {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')[0];
      if (lastTag) {
        const lastVersion = lastTag.replace('v', '');
        const [major, minor] = lastVersion.split('.').map(Number);
        baseVersion = `${major}.${minor + 1}.0`;
      }
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
