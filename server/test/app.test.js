const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createFileStore } = require('../fileStore');
const { createOrderStore } = require('../orderStore');
const { createPaymentService } = require('../paymentService');

async function startHarness({ configOverrides = {}, clock = () => Date.now() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-app-'));
  const orderStore = createOrderStore(path.join(root, 'orders.sqlite'));
  const fileStore = createFileStore(path.join(root, 'storage'));
  const config = {
    publicBaseUrl: '',
    maxFileBytes: 1024 * 1024,
    maxImagePixels: 20_000_000,
    allowMockPayments: false,
    pay: { configured: false, priceFen: 600 },
    wx: {},
    ...configOverrides
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
    logger: { error() {} },
    clock
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

test('internal stats require an independent token and expose only aggregate order data', async () => {
  const now = 2_000_000_000_000;
  const harness = await startHarness({
    configOverrides: { internalStatsToken: 'independent-internal-stats-token' },
    clock: () => now
  });
  const files = {
    previewFile: harness.fileStore.save('preview', Buffer.from('p'), 'jpg'),
    hdFile: harness.fileStore.save('protected', Buffer.from('h'), 'jpg'),
    sheetFile: harness.fileStore.save('protected', Buffer.from('s'), 'jpg')
  };
  harness.orderStore.create({
    orderId: 'sensitive-order', sizeId: 'one-inch', colorId: 'white', level: 'standard',
    ...files, downloadToken: 'must-not-leak', faceAdjusted: true, createdAt: now - 60_000
  });
  harness.orderStore.transition('sensitive-order', 'paid', {
    openid: 'openid-must-not-leak', transactionId: 'transaction-must-not-leak', updatedAt: now
  });
  harness.orderStore.create({
    orderId: 'outside-window', sizeId: 'two-inch', colorId: 'blue', level: 'natural',
    ...files, downloadToken: 'old-secret', createdAt: now - 8 * 24 * 60 * 60 * 1000
  });

  assert.equal((await fetch(`${harness.baseUrl}/api/internal/stats`)).status, 401);
  const publicResponse = await fetch(`${harness.baseUrl}/api/internal/stats?days=7`, {
    headers: {
      host: 'photo.richardq.tech',
      'x-forwarded-host': 'photo.richardq.tech',
      authorization: 'Bearer independent-internal-stats-token'
    }
  });
  assert.equal(publicResponse.status, 404);
  const response = await fetch(`${harness.baseUrl}/api/internal/stats?days=7`, {
    headers: { authorization: 'Bearer independent-internal-stats-token' }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 2);
  assert.equal(body.recent, 1);
  assert.deepEqual(body.byStatus, { paid: 1 });
  assert.deepEqual(body.bySize, { 'one-inch': 1 });
  assert.deepEqual(body.faceAdjusted, { '1': 1 });
  const serialized = JSON.stringify(body);
  for (const secret of ['sensitive-order', 'openid-must-not-leak', 'transaction-must-not-leak', 'must-not-leak']) {
    assert.equal(serialized.includes(secret), false);
  }
  const invalid = await fetch(`${harness.baseUrl}/api/internal/stats?days=366`, {
    headers: { authorization: 'Bearer independent-internal-stats-token' }
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'INVALID_STATS_RANGE');
  await harness.close();
});

test('health reports storage and database readiness', async () => {
  const harness = await startHarness();
  const response = await fetch(`${harness.baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, database: 'ok', storage: 'ok' });
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  await harness.close();
});

test('API limiter rejects bursts with retry metadata', async () => {
  const harness = await startHarness({ configOverrides: { apiRateLimitPerMinute: 2 } });
  await fetch(`${harness.baseUrl}/api/orders/missing-one`);
  await fetch(`${harness.baseUrl}/api/orders/missing-two`);
  const blocked = await fetch(`${harness.baseUrl}/api/orders/missing-three`);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
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
