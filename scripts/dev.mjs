import { spawn } from 'node:child_process';
const children = [spawn('node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'inherit' }), spawn('node_modules/.bin/wrangler', ['dev', '--local', '--ip', '127.0.0.1', '--port', '8787'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); setTimeout(() => process.exit(code), 500).unref(); }
for (const child of children) child.on('exit', code => stop(code || 0));
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
