const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '../../miniprogram');

test('mini program separates develop, trial, and release endpoints', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'config.js'), 'utf8');
  assert.match(source, /develop/);
  assert.match(source, /trial/);
  assert.match(source, /release/);
  assert.match(source, /getAccountInfoSync/);
});

test('mock payment bypass is restricted to develop builds', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'pages/result/result.js'), 'utf8');
  assert.match(source, /payParams\._mock/);
  assert.match(source, /currentEnv\(\) === 'develop'/);
});

test('result page restores persisted order state', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'pages/result/result.js'), 'utf8');
  assert.match(source, /getStorageSync/);
  assert.match(source, /\/api\/orders\//);
  assert.match(source, /recoverOrder/);
});
