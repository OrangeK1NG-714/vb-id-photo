const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomBytes, createCipheriv } = require('node:crypto');

const { createOrderStore } = require('../orderStore');
const { createPaymentService } = require('../paymentService');
const { authorization, decryptResource, sign } = require('../wxpay');

function createOrder(store, orderId = 'o1') {
  store.create({
    orderId, sizeId: 'one-inch', colorId: 'blue', level: 'standard',
    previewFile: 'p.jpg', hdFile: 'h.jpg', sheetFile: 's.jpg',
    downloadToken: 'token', createdAt: 100
  });
}

test('mock payment is allowed only when explicit and marks the order paid', async () => {
  const orderStore = createOrderStore(':memory:');
  createOrder(orderStore);
  const service = createPaymentService({
    config: { allowMockPayments: true, pay: { configured: false, priceFen: 600 }, wx: {} },
    orderStore,
    wxpay: {}
  });
  const result = await service.create({ orderId: 'o1', code: 'dev-code' });
  assert.equal(result._mock, true);
  assert.equal(orderStore.get('o1').status, 'paid');
  orderStore.close();
});

test('missing payment configuration fails closed without changing order', async () => {
  const orderStore = createOrderStore(':memory:');
  createOrder(orderStore);
  const service = createPaymentService({
    config: { allowMockPayments: false, pay: { configured: false, priceFen: 600 }, wx: {} },
    orderStore,
    wxpay: {}
  });
  await assert.rejects(
    () => service.create({ orderId: 'o1', code: 'code' }),
    error => error.code === 'PAYMENT_NOT_CONFIGURED' && error.status === 503
  );
  assert.equal(orderStore.get('o1').status, 'created');
  orderStore.close();
});

test('callback is idempotent and validates trusted transaction fields', async () => {
  const orderStore = createOrderStore(':memory:');
  createOrder(orderStore);
  const transaction = {
    trade_state: 'SUCCESS', out_trade_no: 'o1', transaction_id: 'tx1',
    amount: { total: 600, currency: 'CNY' }, mchid: 'mch', appid: 'app'
  };
  const service = createPaymentService({
    config: {
      allowMockPayments: false,
      pay: { configured: true, priceFen: 600, mchId: 'mch' },
      wx: { appId: 'app' }
    },
    orderStore,
    wxpay: { verifyAndDecryptNotify: () => transaction }
  });
  await service.handleNotify({}, Buffer.from('{}'));
  await service.handleNotify({}, Buffer.from('{}'));
  assert.equal(orderStore.get('o1').transactionId, 'tx1');
  assert.equal(orderStore.get('o1').status, 'paid');

  transaction.amount.total = 1;
  await assert.rejects(
    () => service.handleNotify({}, Buffer.from('{}')),
    error => error.code === 'PAY_NOTIFY_MISMATCH'
  );
  orderStore.close();
});

test('Wechat Pay authorization signs the canonical message', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const result = authorization({
    method: 'POST', pathname: '/v3/pay/transactions/jsapi', body: '{"x":1}',
    mchId: 'mch', serialNo: 'serial', privateKey,
    timestamp: '1700000000', nonce: 'nonce'
  });
  const signature = /signature="([^"]+)"/.exec(result)[1];
  const message = 'POST\n/v3/pay/transactions/jsapi\n1700000000\nnonce\n{"x":1}\n';
  assert.equal(require('node:crypto').verify('RSA-SHA256', Buffer.from(message), publicKey, Buffer.from(signature, 'base64')), true);
  assert.equal(sign('message', privateKey).length > 100, true);
});

test('Wechat Pay resource decryption authenticates AES-GCM payloads', () => {
  const key = randomBytes(32);
  const nonce = Buffer.from('123456789012');
  const associatedData = Buffer.from('associated');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(associatedData);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ out_trade_no: 'o1' })), cipher.final(), cipher.getAuthTag()]);
  const result = decryptResource({
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: encrypted.toString('base64'),
    nonce: nonce.toString(),
    associated_data: associatedData.toString()
  }, key);
  assert.equal(result.out_trade_no, 'o1');
});
