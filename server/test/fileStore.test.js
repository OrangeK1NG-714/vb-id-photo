const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFileStore } = require('../fileStore');
const { cleanupExpired } = require('../cleanup');
const { createOrderStore } = require('../orderStore');

test('paid files are outside the public preview directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-files-'));
  const store = createFileStore(root);
  const preview = store.save('preview', Buffer.from('p'), 'jpg');
  const hd = store.save('protected', Buffer.from('h'), 'jpg');
  assert.match(store.resolve('preview', preview), /preview/);
  assert.match(store.resolve('protected', hd), /protected/);
  assert.notEqual(path.dirname(store.resolve('preview', preview)), path.dirname(store.resolve('protected', hd)));
});

test('file resolution rejects traversal and invalid kinds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-safe-'));
  const store = createFileStore(root);
  assert.throws(() => store.resolve('protected', '../secret.jpg'), /非法文件名/);
  assert.throws(() => store.save('public', Buffer.from('x'), 'jpg'), /非法存储类型/);
});

test('cleanup is idempotent and expires persisted orders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-clean-'));
  const fileStore = createFileStore(root);
  const orderStore = createOrderStore(':memory:');
  const previewFile = fileStore.save('preview', Buffer.from('p'), 'jpg');
  const hdFile = fileStore.save('protected', Buffer.from('h'), 'jpg');
  const sheetFile = fileStore.save('protected', Buffer.from('s'), 'jpg');
  orderStore.create({
    orderId: 'old', sizeId: 'one-inch', colorId: 'white', level: 'natural',
    previewFile, hdFile, sheetFile, downloadToken: 'token', createdAt: 100
  });

  assert.equal(cleanupExpired({ orderStore, fileStore, retentionMs: 100, now: 500 }), 1);
  assert.equal(cleanupExpired({ orderStore, fileStore, retentionMs: 100, now: 500 }), 0);
  assert.equal(orderStore.get('old').status, 'expired');
  assert.equal(fs.existsSync(fileStore.resolve('preview', previewFile)), false);
  assert.equal(fs.existsSync(fileStore.resolve('protected', hdFile)), false);
  orderStore.close();
});
