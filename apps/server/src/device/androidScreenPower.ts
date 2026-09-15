/**
 * Turns a physical Android panel off or on while its screen keeps mirroring.
 *
 * `cmd display power-off` stops composition, so every capture goes black.
 * scrcpy's SET_DISPLAY_POWER cuts only the panel. The hub owns its scrcpy
 * control socket and has no message for it, so this starts a short
 * control-only scrcpy server with `cleanup=false`: the panel stays in the
 * requested state after the server exits, and no process outlives the action.
 *
 * Node runs this on the device host with `node -e`, so the same action works
 * on local and SSH hosts. Arguments: serial, "on" | "off", local jar, version.
 */
export const ANDROID_SCREEN_POWER_SCRIPT = String.raw`
const { execFile, spawn } = require('node:child_process');
const { connect } = require('node:net');
const fs = require('node:fs');
const [serial, power, jar, version] = process.argv.slice(1);
const adb = (args, timeout = 15000) => new Promise((resolve, reject) =>
  execFile('adb', ['-s', serial, ...args], { encoding: 'utf8', timeout }, (error, stdout, stderr) =>
    error ? reject(new Error('adb ' + args[0] + ' failed: ' + String(stderr || error.message).trim())) : resolve(stdout)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const confirmed = /Device display turned (on|off)/;
(async () => {
  if (!fs.existsSync(jar)) throw new Error('The scrcpy server is not downloaded yet. Open the device stream first.');
  const scid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, '0');
  const cache = '/data/local/tmp/t3-scrcpy-server-v' + version + '.jar';
  const working = '/data/local/tmp/t3-scrcpy-' + scid + '.jar';
  const socketName = 'scrcpy_' + scid;
  if (!(await adb(['shell', 'test -f ' + cache + ' && echo present'])).includes('present')) {
    await adb(['push', jar, cache], 60000);
  }
  // The server deletes its own classpath jar on start.
  await adb(['shell', 'cp', cache, working]);
  const port = Number((await adb(['forward', 'tcp:0', 'localabstract:' + socketName])).trim());
  const server = spawn('adb', ['-s', serial, 'shell', 'CLASSPATH=' + working, 'app_process', '/',
    'com.genymobile.scrcpy.Server', version, 'scid=' + scid, 'log_level=info', 'video=false',
    'audio=false', 'control=true', 'tunnel_forward=true', 'send_dummy_byte=false',
    'cleanup=false', 'power_on=false'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (chunk) => { log += chunk; });
  server.stderr.on('data', (chunk) => { log += chunk; });
  try {
    for (let attempt = 0; !(await adb(['shell', 'cat', '/proc/net/unix'])).includes('@' + socketName); attempt++) {
      if (attempt >= 50 || server.exitCode !== null) throw new Error('scrcpy server did not start: ' + log.trim());
      await sleep(100);
    }
    const socket = await new Promise((resolve, reject) => {
      const client = connect(port, '127.0.0.1', () => resolve(client));
      client.once('error', reject);
    });
    // SET_DISPLAY_POWER: message type 10, then 1 for on or 0 for off.
    socket.write(Buffer.from([10, power === 'on' ? 1 : 0]));
    for (let attempt = 0; attempt < 50 && !confirmed.test(log); attempt++) await sleep(100);
    socket.destroy();
    if (!confirmed.test(log)) throw new Error('scrcpy did not confirm the display change: ' + log.trim());
  } finally {
    server.kill();
    await adb(['forward', '--remove', 'tcp:' + port]).catch(() => {});
    await adb(['shell', 'rm', '-f', working]).catch(() => {});
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
`;
