import { spawn } from 'node:child_process';
import readline from 'node:readline';

function startProcess(command, args, options = {}) {
  return spawn(command, args, {
    stdio: options.stdio ?? 'inherit',
    shell: options.shell ?? false,
    env: options.env ?? process.env,
  });
}

function emit(line) {
  process.stdout.write(`${line}\n`);
}

function startEvenHubQr(url) {
  const qr = startProcess('npx', ['evenhub', 'qr', '--url', url]);
  qr.on('exit', (code) => emit(`evenhub qr exited with code ${code ?? 0}`));
}

emit('Starting iPhone/Safari dev launcher');

const vite = startProcess('npm', ['run', 'dev', '--', '--host', '0.0.0.0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const viteOut = readline.createInterface({ input: vite.stdout });
const viteErr = readline.createInterface({ input: vite.stderr });

let tunnelStarted = false;

function startTunnel(port) {
  if (tunnelStarted) return;
  tunnelStarted = true;

  emit(`Starting HTTPS tunnel for port ${port}`);
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
        emit(`iPhone ready: ${tunnelUrl}`);
        emit('Open this URL directly in Safari on the iPhone.');
        emit('If you want a QR, scan the EvenHub QR below with the iPhone camera.');
        startEvenHubQr(tunnelUrl);
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

function handleViteLine(line) {
  emit(line);
  const match = line.match(/Local:\s+http:\/\/localhost:(\d+)/i);
  if (match) {
    startTunnel(Number(match[1]));
  }
}

viteOut.on('line', handleViteLine);
viteErr.on('line', handleViteLine);

vite.on('exit', (code) => {
  emit(`vite exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});
