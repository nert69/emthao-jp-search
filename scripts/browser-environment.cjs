const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Windows app containers can redirect LOCALAPPDATA to an empty temporary cache.
// Pin only Playwright's cache, preserving the rest of the launch environment.
function browserEnvironment(env = process.env, { platform = process.platform, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (platform !== 'win32' || env.PLAYWRIGHT_BROWSERS_PATH) return env;
  const installedCache = path.join(home, 'AppData', 'Local', 'ms-playwright');
  return exists(installedCache) ? { ...env, PLAYWRIGHT_BROWSERS_PATH: installedCache } : env;
}

module.exports = { browserEnvironment };
