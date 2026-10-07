import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const DEFAULT_PORT = 5173;
const LOCALHOST_URL = `http://localhost:${DEFAULT_PORT}`;
const LAN_URL = `http://192.168.5.36:${DEFAULT_PORT}`;

function startProcess(command, args, options = {}) {
  return spawn(command, args, {
    stdio: options.stdio ?? 'inherit',
    shell: options.shell ?? false,
    env: options.env ?? process.env,
  });
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGINT');
  } catch {
    // best effort
  }
}

function emit(line) {
  process.stdout.write(`${line}\n`);
}

function hasAdbDevice() {
  const result = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (result.error) return false;
  return result.stdout
    .split('\n')
    .some((line) => line.trim().endsWith('\tdevice'));
}

function setupAdbReverse(port) {
  const reverse = spawnSync('adb', ['reverse', `tcp:${port}`, `tcp:${port}`], {
    encoding: 'utf8',
  });

  if (reverse.status !== 0) {
    throw new Error(reverse.stderr || reverse.stdout || 'adb reverse failed');
  }
}

async function startEvenHubQr(url) {
  const qr = startProcess('npx', ['evenhub', 'qr', '--url', url]);
  qr.on('exit', (code) => emit(`evenhub qr exited with code ${code ?? 0}`));
}

let vitePort = null;
let tunnelStarted = false;

function startLocalTunnel(port) {
  if (tunnelStarted) return;
  tunnelStarted = true;

  emit(`Falling back to tunnel for port ${port}`);
  const tunnel = startProcess('npx', ['localtunnel', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tunnelOut = readline.createInterface({ input: tunnel.stdout });
  const tunnelErr = readline.createInterface({ input: tunnel.stderr });
  let tunnelUrl = null;

  function handleTunnelLine(line) {
    emit(line);
    if (!tunnelUrl) {
      const match = line.match(/https:\/\/[a-z0-9-]+\.loca\.lt/i);
      if (match) {
        tunnelUrl = match[0];
        emit('');
        emit(`Tunnel ready: ${tunnelUrl}`);
        emit('Generating EvenHub QR for the tunnel URL...');
        void startEvenHubQr(tunnelUrl);
      }
    }
  }

  tunnelOut.on('line', handleTunnelLine);
  tunnelErr.on('line', handleTunnelLine);

  tunnel.on('exit', (code) => {
    emit(`tunnel exited with code ${code ?? 0}`);
    process.exit(code ?? 0);
  });
}

const vite = startProcess('npm', ['run', 'dev', '--', '--host', '0.0.0.0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const viteOut = readline.createInterface({ input: vite.stdout });
const viteErr = readline.createInterface({ input: vite.stderr });

function handleViteLine(line) {
  emit(line);

  if (!vitePort) {
    const match = line.match(/Local:\s+http:\/\/localhost:(\d+)/i);
    if (match) {
      vitePort = Number(match[1]);
      emit(`Using Vite port ${vitePort}`);

      if (hasAdbDevice()) {
        try {
          setupAdbReverse(vitePort);
          emit('adb reverse active');
          emit(`Use this URL in Even App: ${LOCALHOST_URL}`);
          emit('Generating EvenHub QR for localhost...');
          void startEvenHubQr(LOCALHOST_URL);
        } catch (error) {
          emit(`adb reverse failed: ${error.message}`);
          startLocalTunnel(vitePort);
        }
      } else {
        emit('No adb device detected, falling back to tunnel');
        startLocalTunnel(vitePort);
      }
    }
  }
}

viteOut.on('line', handleViteLine);
viteErr.on('line', handleViteLine);

const shutdown = () => {
  killChild(vite);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

vite.on('exit', (code) => {
  emit(`vite exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});

