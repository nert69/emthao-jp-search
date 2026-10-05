// Starts detached supervisors, waits for readiness, then opens the local app.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const listening = port => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const finish = value => { socket.destroy(); resolve(value); };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(1000, () => finish(false));
});
(async () => {
  for (const dependency of ['backend/node_modules/playwright', 'frontend/node_modules/vite/bin/vite.js']) {
    if (!fs.existsSync(path.join(root, dependency))) throw new Error('Dependencies are missing. Run npm.cmd run setup in the project folder first.');
  }
  for (const [service, port] of [['backend', 8787], ['frontend', 5173]]) {
    if (await listening(port)) continue;
    const worker = spawn(process.execPath, [path.join(__dirname, 'local-server.cjs'), service], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' });
    worker.on('error', error => { console.error(error.message); process.exitCode = 1; });
    worker.unref();
  }
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const [preview, health] = await Promise.all([
        fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(2000) }).then(r => r.text()),
        fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(2000) }).then(r => r.json()),
      ]);
      if (preview.includes('EmThaoJP') && health.status === 'ok' && health.browserConnected) { ready = true; break; }
    } catch { /* Still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error(`The app did not become ready. Check logs in ${path.join(root, '.cache', 'local-servers')}`);
  console.log('Japanese marketplace search is ready at http://localhost:5173/');
  if (!process.argv.includes('--no-browser')) {
    if (process.platform !== 'win32') throw new Error('Open http://localhost:5173/ in your browser.');
    const browser = spawn('cmd.exe', ['/d', '/s', '/c', 'start "" "http://localhost:5173/"'], { windowsHide: true, detached: true, stdio: 'ignore' });
    browser.on('error', error => console.error(`Open http://localhost:5173/ manually: ${error.message}`));
    browser.unref();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
