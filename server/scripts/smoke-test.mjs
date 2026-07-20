import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`服务提前退出，exit=${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {
      // 服务仍在启动。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待健康检查超时');
}

function startManagedServer({ port, dataDir, storageDir }) {
  let output = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ALLOW_MOCK_PAYMENTS: 'true',
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      DATA_DIR: dataDir,
      STORAGE_DIR: storageDir,
      DOWNLOAD_SECRET: 'smoke-development-secret-32-bytes-minimum',
      WX_APPID: '',
      WX_SECRET: '',
      WX_MCH_ID: '',
      WX_PAY_KEY: '',
      WX_PAY_SERIAL: '',
      WX_PAY_PRIVATE_KEY_PATH: '',
      WX_PAY_PLATFORM_CERT_PATH: '',
      WX_PAY_NOTIFY_URL: '',
      SEG_API_URL: '',
      SEG_API_KEY: '',
      FACE_API_URL: '',
      FACE_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return { child, output: () => output };
}

async function stopManagedServer(managed) {
  if (!managed || managed.child.exitCode != null) return;
  const exited = new Promise((resolve, reject) => {
    managed.child.once('exit', resolve);
    managed.child.once('error', reject);
  });
  managed.child.kill('SIGTERM');
  const timeout = setTimeout(() => managed.child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timeout);
}

async function expectStatus(response, expected) {
  if (response.status !== expected) {
    throw new Error(`HTTP ${response.status}, expected ${expected}: ${await response.text()}`);
  }
}

async function createPaidOrder(baseUrl) {
  const image = await sharp({
    create: { width: 600, height: 800, channels: 3, background: { r: 210, g: 190, b: 170 } }
  }).jpeg().toBuffer();
  const form = new FormData();
  form.append('photo', new Blob([image], { type: 'image/jpeg' }), 'smoke.jpg');
  form.append('sizeId', 'one-inch');
  form.append('colorId', 'blue');
  form.append('level', 'standard');

  const processResponse = await fetch(`${baseUrl}/api/process`, { method: 'POST', body: form });
  await expectStatus(processResponse, 201);
  const processed = await processResponse.json();
  assert.match(processed.orderId, /^[a-f0-9]{32}$/);
  assert.equal(processed.faceAdjusted, false);
  assert.ok(processed.qualityWarnings.length >= 1);

  const paymentResponse = await fetch(`${baseUrl}/api/pay/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: processed.orderId, code: 'smoke-code' })
  });
  await expectStatus(paymentResponse, 200);
  assert.equal((await paymentResponse.json())._mock, true);

  const confirmResponse = await fetch(`${baseUrl}/api/pay/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: processed.orderId })
  });
  await expectStatus(confirmResponse, 200);
  const confirmed = await confirmResponse.json();
  const [hdResponse, sheetResponse] = await Promise.all([
    fetch(confirmed.hdUrl),
    fetch(confirmed.sheetUrl)
  ]);
  assert.equal(hdResponse.status, 200);
  assert.equal(sheetResponse.status, 200);
  const [hd, sheet] = await Promise.all([
    sharp(Buffer.from(await hdResponse.arrayBuffer())).metadata(),
    sharp(Buffer.from(await sheetResponse.arrayBuffer())).metadata()
  ]);
  assert.deepEqual([hd.width, hd.height], [295, 413]);
  assert.deepEqual([sheet.width, sheet.height], [1200, 1800]);
  console.log('smoke: process/pay/download dimensions ok');
  return { orderId: processed.orderId, hdUrl: confirmed.hdUrl };
}

async function verifyRestart(baseUrl, orderId) {
  const statusResponse = await fetch(`${baseUrl}/api/orders/${orderId}`);
  await expectStatus(statusResponse, 200);
  assert.equal((await statusResponse.json()).status, 'paid');
  const confirmResponse = await fetch(`${baseUrl}/api/pay/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId })
  });
  await expectStatus(confirmResponse, 200);
  const confirmed = await confirmResponse.json();
  const download = await fetch(confirmed.hdUrl);
  assert.equal(download.status, 200);
  const metadata = await sharp(Buffer.from(await download.arrayBuffer())).metadata();
  assert.deepEqual([metadata.width, metadata.height], [295, 413]);
  console.log('smoke: restart persistence ok');
}

async function main() {
  if (process.env.BASE_URL) {
    await createPaidOrder(process.env.BASE_URL.replace(/\/$/, ''));
    console.log('smoke: external server checked; restart check requires managed mode');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'id-photo-smoke-'));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const paths = { port, dataDir: path.join(root, 'data'), storageDir: path.join(root, 'storage') };
  let managed;
  try {
    managed = startManagedServer(paths);
    await waitForHealth(baseUrl, managed.child);
    const { orderId } = await createPaidOrder(baseUrl);
    await stopManagedServer(managed);

    managed = startManagedServer(paths);
    await waitForHealth(baseUrl, managed.child);
    await verifyRestart(baseUrl, orderId);
  } catch (error) {
    if (managed?.output()) process.stderr.write(managed.output());
    throw error;
  } finally {
    await stopManagedServer(managed);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();
