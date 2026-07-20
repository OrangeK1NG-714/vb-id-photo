const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createOrderStore } = require('../orderStore');

function order(orderId = 'o1') {
  return {
    orderId,
    sizeId: 'one-inch',
    colorId: 'blue',
    level: 'standard',
    previewFile: 'p.jpg',
    hdFile: 'h.jpg',
    sheetFile: 's.jpg',
    downloadToken: 'token',
    faceAdjusted: false,
    createdAt: 100
  };
}

test('orders survive reopening the database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-db-'));
  const file = path.join(directory, 'orders.sqlite');
  let store = createOrderStore(file);
  store.create(order());
  store.close();
  store = createOrderStore(file);
  assert.equal(store.get('o1').status, 'created');
  assert.equal(store.get('o1').downloadToken, 'token');
  store.close();
});

test('only allowed transitions are accepted and same-state callbacks are idempotent', () => {
  const store = createOrderStore(':memory:');
  store.create(order());
  assert.equal(store.transition('o1', 'paying').status, 'paying');
  assert.equal(store.transition('o1', 'paid', { transactionId: 'tx1' }).status, 'paid');
  assert.equal(store.transition('o1', 'paid', { transactionId: 'tx1' }).status, 'paid');
  assert.throws(() => store.transition('o1', 'created'), /非法订单状态转换/);
  store.close();
});

test('expired query excludes already expired orders', () => {
  const store = createOrderStore(':memory:');
  store.create(order('old'));
  store.create({ ...order('new'), createdAt: 1000 });
  assert.deepEqual(store.listExpired(500).map(item => item.orderId), ['old']);
  store.transition('old', 'expired');
  assert.equal(store.listExpired(500).length, 0);
  store.close();
});
