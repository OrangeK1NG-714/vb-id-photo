const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../config');

test('production rejects mock payments', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', ALLOW_MOCK_PAYMENTS: 'true' }),
    /生产环境禁止模拟支付/
  );
});

test('production payment configuration must be complete', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://photo.example.com' }),
    /微信支付配置不完整/
  );
});

test('development permits only explicit mock payments', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development' }).allowMockPayments, false);
  const config = loadConfig({ NODE_ENV: 'development', ALLOW_MOCK_PAYMENTS: 'true' });
  assert.equal(config.allowMockPayments, true);
  assert.equal(config.retentionMs, 2 * 60 * 60 * 1000);
  assert.equal(config.trustProxyHops, 0);
  assert.equal(config.maxConcurrentProcessing, 2);
  assert.equal(config.requestTimeoutMs, 60_000);
});

test('numeric configuration rejects suffixes, fractions, and unsafe integers', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development', MAX_FILE_MB: '10MB' }),
    /MAX_FILE_MB 必须是正整数/
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development', CLEANUP_INTERVAL_MINUTES: '1.5' }),
    /CLEANUP_INTERVAL_MINUTES 必须是正整数/
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '9007199254740992' }),
    /TRUST_PROXY_HOPS 必须是非负整数/
  );
});

test('provider and public URLs reject non-HTTP protocols in every environment', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development', PUBLIC_BASE_URL: 'file:///tmp/photo' }),
    /PUBLIC_BASE_URL 必须使用 HTTP 或 HTTPS/
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development', FACE_API_URL: 'ftp://face.example.com' }),
    /FACE_API_URL 必须使用 HTTP 或 HTTPS/
  );
});

test('production requires HTTPS for configured provider endpoints', () => {
  const base = {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://photo.example.com',
    WX_APPID: 'app',
    WX_SECRET: 'secret',
    WX_MCH_ID: 'mch',
    WX_PAY_KEY: '12345678901234567890123456789012',
    WX_PAY_SERIAL: 'serial',
    WX_PAY_PRIVATE_KEY_PATH: '/tmp/private.pem',
    WX_PAY_PLATFORM_CERT_PATH: '/tmp/platform.pem',
    WX_PAY_NOTIFY_URL: 'https://photo.example.com/api/pay/notify',
    DOWNLOAD_SECRET: '12345678901234567890123456789012',
    SEG_API_KEY: 'key'
  };
  assert.throws(() => loadConfig({ ...base, SEG_API_URL: 'http://seg.example.com' }), /SEG_API_URL 必须使用 HTTPS/);
  assert.throws(
    () => loadConfig({
      ...base,
      SEG_API_URL: 'https://seg.example.com',
      WX_PAY_NOTIFY_URL: 'http://photo.example.com/api/pay/notify'
    }),
    /WX_PAY_NOTIFY_URL 必须使用 HTTPS/
  );
});

test('production requires an independent strong internal stats token', () => {
  const base = {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://photo.example.com',
    WX_APPID: 'app',
    WX_SECRET: 'secret',
    WX_MCH_ID: 'mch',
    WX_PAY_KEY: '12345678901234567890123456789012',
    WX_PAY_SERIAL: 'serial',
    WX_PAY_PRIVATE_KEY_PATH: '/tmp/private.pem',
    WX_PAY_PLATFORM_CERT_PATH: '/tmp/platform.pem',
    WX_PAY_NOTIFY_URL: 'https://photo.example.com/api/pay/notify',
    DOWNLOAD_SECRET: '12345678901234567890123456789012',
    SEG_API_URL: 'https://seg.example.com',
    SEG_API_KEY: 'key'
  };
  assert.throws(() => loadConfig(base), /ID_PHOTO_INTERNAL_STATS_TOKEN/);
  assert.equal(loadConfig({
    ...base,
    ID_PHOTO_INTERNAL_STATS_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456'
  }).internalStatsToken, 'abcdefghijklmnopqrstuvwxyz123456');
});

test('production requires segmentation and a strong download secret', () => {
  const base = {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://photo.example.com',
    WX_APPID: 'app',
    WX_SECRET: 'secret',
    WX_MCH_ID: 'mch',
    WX_PAY_KEY: '12345678901234567890123456789012',
    WX_PAY_SERIAL: 'serial',
    WX_PAY_PRIVATE_KEY_PATH: '/tmp/private.pem',
    WX_PAY_PLATFORM_CERT_PATH: '/tmp/platform.pem',
    WX_PAY_NOTIFY_URL: 'https://photo.example.com/api/pay/notify'
  };
  assert.throws(() => loadConfig(base), /人像分割配置不完整/);
  assert.throws(
    () => loadConfig({ ...base, SEG_API_URL: 'https://seg.example.com', SEG_API_KEY: 'key' }),
    /DOWNLOAD_SECRET/
  );
});
