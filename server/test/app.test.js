const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createFileStore } = require('../fileStore');
const { createOrderStore } = require('../orderStore');
const { createPaymentService } = require('../paymentService');

async function startHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-app-'));
  const orderStore = createOrderStore(path.join(root, 'orders.sqlite'));
  const fileStore = createFileStore(path.join(root, 'storage'));
  const config = {
    publicBaseUrl: '',
    maxFileBytes: 1024 * 1024,
    maxImagePixels: 20_000_000,
    allowMockPayments: false,
    pay: { configured: false, priceFen: 600 },
    wx: {}
  };
  const paymentService = createPaymentService({ config, orderStore, wxpay: {} });
  const output = Buffer.from('private-image');
  const app = createApp({
    config,
    orderStore,
    fileStore,
    imageProcessor: async () => ({
      previewBuffer: Buffer.from('preview-image'),
      hdBuffer: output,
      sheetBuffer: output,
      faceAdjusted: false,
      faceDetection: 'unavailable',
      backgroundReplaced: false
    }),
    paymentService,
    logger: { error() {} }
  });
  const server = await new Promise(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  config.publicBaseUrl = baseUrl;
  return {
    baseUrl,
    orderStore,
    fileStore,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      orderStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test('health reports storage and database readiness', async () => {
  const harness = await startHarness();
  const response = await fetch(`${harness.baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, database: 'ok', storage: 'ok' });
  await harness.close();
});

test('process rejects missing image with a stable code', async () => {
  const harness = await startHarness();
  const response = await fetch(`${harness.baseUrl}/api/process`, {
    method: 'POST', body: new FormData()
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'PHOTO_REQUIRED');
  await harness.close();
});

test('process rejects unknown specifications before storing files', async () => {
  const harness = await startHarness();
  const form = new FormData();
  form.append('photo', new Blob([Buffer.from('fake')], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('sizeId', 'unknown');
  form.append('colorId', 'white');
  form.append('level', 'standard');
  const response = await fetch(`${harness.baseUrl}/api/process`, { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_OPTIONS');
  await harness.close();
});

test('frontend cannot forge paid state and protected downloads require token', async () => {
  const harness = await startHarness();
  const previewFile = harness.fileStore.save('preview', Buffer.from('p'), 'jpg');
  const hdFile = harness.fileStore.save('protected', Buffer.from('h'), 'jpg');
  const sheetFile = harness.fileStore.save('protected', Buffer.from('s'), 'jpg');
  harness.orderStore.create({
    orderId: 'o1', sizeId: 'one-inch', colorId: 'white', level: 'standard',
    previewFile, hdFile, sheetFile, downloadToken: 'secret-token', createdAt: Date.now()
  });

  const forged = await fetch(`${harness.baseUrl}/api/pay/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: 'o1', paid: true })
  });
  assert.equal(forged.status, 402);
  assert.equal((await forged.json()).code, 'ORDER_UNPAID');
  assert.equal((await fetch(`${harness.baseUrl}/api/orders/o1/download/hd?token=secret-token`)).status, 402);

  harness.orderStore.transition('o1', 'paid', { transactionId: 'trusted' });
  assert.equal((await fetch(`${harness.baseUrl}/api/orders/o1/download/hd?token=wrong`)).status, 403);
  const download = await fetch(`${harness.baseUrl}/api/orders/o1/download/hd?token=secret-token`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'h');
  await harness.close();
});

test('order status exposes recovery metadata without download secrets', async () => {
  const harness = await startHarness();
  const previewFile = harness.fileStore.save('preview', Buffer.from('p'), 'jpg');
  const hdFile = harness.fileStore.save('protected', Buffer.from('h'), 'jpg');
  const sheetFile = harness.fileStore.save('protected', Buffer.from('s'), 'jpg');
  harness.orderStore.create({
    orderId: 'recover', sizeId: 'one-inch', colorId: 'blue', level: 'natural',
    previewFile, hdFile, sheetFile, downloadToken: 'never-expose', faceAdjusted: false,
    createdAt: Date.now()
  });
  const response = await fetch(`${harness.baseUrl}/api/orders/recover`);
  const body = await response.json();
  assert.equal(body.status, 'created');
  assert.equal(body.faceAdjusted, false);
  assert.equal(JSON.stringify(body).includes('never-expose'), false);
  await harness.close();
});
