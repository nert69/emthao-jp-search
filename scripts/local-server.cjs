// Independent local supervisor. A private named pipe prevents duplicate workers.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { browserEnvironment } = require('./browser-environment.cjs');
const service = process.argv[2];
if (!['backend', 'frontend'].includes(service)) process.exit(1);
const root = path.resolve(__dirname, '..');
const logs = path.join(root, '.cache', 'local-servers');
fs.mkdirSync(logs, { recursive: true });
const identity = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 20);
const lockPath = process.platform === 'win32' ? `\\\\.\\pipe\\emthao-${identity}-${service}` : path.join(logs, `${service}.sock`);
const lock = net.createServer(socket => socket.end());
lock.on('error', error => {
  if (error.code !== 'EADDRINUSE') fs.appendFileSync(path.join(logs, 'supervisor.log'), `${new Date().toISOString()} ${service} lock failed: ${error.message}\n`);
  process.exit(error.code === 'EADDRINUSE' ? 0 : 1);
});
const stdout = fs.openSync(path.join(logs, `${service}.stdout.log`), 'a');
const stderr = fs.openSync(path.join(logs, `${service}.stderr.log`), 'a');
let child;
let timer;
let stopping = false;
const note = message => fs.appendFileSync(path.join(logs, 'supervisor.log'), `${new Date().toISOString()} ${service} ${message}\n`);
const start = () => {
  const args = service === 'backend'
    ? [path.join(root, 'backend', 'src', 'server.js')]
    : [path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'];
  child = spawn(process.execPath, args, { cwd: path.join(root, service), windowsHide: true, stdio: ['ignore', stdout, stderr], env: browserEnvironment() });
  child.on('spawn', () => {
    fs.writeFileSync(path.join(logs, `${service}.json`), JSON.stringify({ supervisorPid: process.pid, pid: child.pid, service, root }));
    note(`started PID ${child.pid}`);
  });
  child.on('error', error => note(`launch error: ${error.message}`));
  child.once('close', (code, signal) => {
    note(`exited code=${code} signal=${signal}`);
    if (!stopping) timer = setTimeout(start, 3000);
  });
};
const stop = () => {
  stopping = true;
  clearTimeout(timer);
  if (child) child.kill();
  lock.close(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
lock.listen(lockPath, start);
