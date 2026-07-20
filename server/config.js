const path = require('node:path');

require('dotenv').config();

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`无效布尔配置: ${value}`);
}

function positiveInteger(value, fallback, name) {
  const parsed = Number.parseInt(value == null || value === '' ? String(fallback) : value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数`);
  return parsed;
}

function resolvePath(value, fallback) {
  return path.resolve(__dirname, value || fallback);
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const allowMockPayments = boolean(env.ALLOW_MOCK_PAYMENTS, false);
  if (production && allowMockPayments) throw new Error('生产环境禁止模拟支付');

  const pay = {
    mchId: env.WX_MCH_ID || '',
    apiV3Key: env.WX_PAY_KEY || '',
    serialNo: env.WX_PAY_SERIAL || '',
    privateKeyPath: resolvePath(env.WX_PAY_PRIVATE_KEY_PATH, './cert/apiclient_key.pem'),
    platformCertPath: resolvePath(env.WX_PAY_PLATFORM_CERT_PATH, './cert/wechatpay_platform.pem'),
    notifyUrl: env.WX_PAY_NOTIFY_URL || '',
    priceFen: positiveInteger(env.PRICE_FEN, 600, 'PRICE_FEN')
  };
  const payConfigured = Boolean(
    pay.mchId && pay.apiV3Key && pay.serialNo && env.WX_PAY_PRIVATE_KEY_PATH &&
    env.WX_PAY_PLATFORM_CERT_PATH && pay.notifyUrl
  );
  if (production && !payConfigured) throw new Error('微信支付配置不完整');
  if (pay.apiV3Key && Buffer.byteLength(pay.apiV3Key) !== 32) {
    throw new Error('WX_PAY_KEY 必须为 32 字节');
  }

  const publicBaseUrl = (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  if (production && !publicBaseUrl.startsWith('https://')) {
    throw new Error('生产环境 PUBLIC_BASE_URL 必须使用 HTTPS');
  }

  const seg = { apiUrl: env.SEG_API_URL || '', apiKey: env.SEG_API_KEY || '' };
  const segmentationConfigured = Boolean(seg.apiUrl && seg.apiKey);
  if (production && !segmentationConfigured) throw new Error('生产环境人像分割配置不完整');

  const downloadSecret = env.DOWNLOAD_SECRET || '';
  if (production && Buffer.byteLength(downloadSecret) < 32) {
    throw new Error('生产环境 DOWNLOAD_SECRET 至少需要 32 字节');
  }
  if (production && (!env.WX_APPID || !env.WX_SECRET)) throw new Error('微信小程序配置不完整');

  return {
    nodeEnv,
    production,
    port: positiveInteger(env.PORT, 3000, 'PORT'),
    publicBaseUrl,
    dataDir: resolvePath(env.DATA_DIR, './data'),
    storageDir: resolvePath(env.STORAGE_DIR, './storage'),
    retentionMs: positiveInteger(env.FILE_RETENTION_MINUTES, 120, 'FILE_RETENTION_MINUTES') * 60 * 1000,
    cleanupIntervalMs: positiveInteger(env.CLEANUP_INTERVAL_MINUTES, 15, 'CLEANUP_INTERVAL_MINUTES') * 60 * 1000,
    maxFileBytes: positiveInteger(env.MAX_FILE_MB, 10, 'MAX_FILE_MB') * 1024 * 1024,
    maxImagePixels: positiveInteger(env.MAX_IMAGE_PIXELS, 20_000_000, 'MAX_IMAGE_PIXELS'),
    downloadSecret,
    allowMockPayments,
    // 可选：统一使用看板 vb-metrics 的 /api/collect 地址。留空则不上报（no-op）。
    metricsEndpoint: env.METRICS_ENDPOINT || '',
    wx: { appId: env.WX_APPID || '', secret: env.WX_SECRET || '' },
    pay: { ...pay, configured: payConfigured },
    seg: { ...seg, configured: segmentationConfigured },
    face: {
      apiUrl: env.FACE_API_URL || '',
      apiKey: env.FACE_API_KEY || '',
      configured: Boolean(env.FACE_API_URL && env.FACE_API_KEY)
    }
  };
}

module.exports = loadConfig();
module.exports.loadConfig = loadConfig;
