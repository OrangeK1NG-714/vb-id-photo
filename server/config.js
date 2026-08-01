const path = require('node:path');

require('dotenv').config();

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`无效布尔配置: ${value}`);
}

function positiveInteger(value, fallback, name) {
  const raw = value == null || value === '' ? String(fallback) : String(value);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} 必须是正整数`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数`);
  return parsed;
}

function nonNegativeInteger(value, fallback, name) {
  const raw = value == null || value === '' ? String(fallback) : String(value);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} 必须是非负整数`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} 必须是非负整数`);
  return parsed;
}

function optionalHttpsUrl(value, name, production) {
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} 必须是有效 URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} 必须使用 HTTP 或 HTTPS`);
  }
  if (production && parsed.protocol !== 'https:') throw new Error(`生产环境 ${name} 必须使用 HTTPS`);
  return parsed.toString().replace(/\/$/, '');
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
    notifyUrl: optionalHttpsUrl(env.WX_PAY_NOTIFY_URL, 'WX_PAY_NOTIFY_URL', production),
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

  const publicBaseUrl = optionalHttpsUrl(
    env.PUBLIC_BASE_URL || 'http://localhost:3000',
    'PUBLIC_BASE_URL',
    production
  );

  const seg = { apiUrl: optionalHttpsUrl(env.SEG_API_URL, 'SEG_API_URL', production), apiKey: env.SEG_API_KEY || '' };
  const segmentationConfigured = Boolean(seg.apiUrl && seg.apiKey);
  if (production && !segmentationConfigured) throw new Error('生产环境人像分割配置不完整');

  const downloadSecret = env.DOWNLOAD_SECRET || '';
  if (production && Buffer.byteLength(downloadSecret) < 32) {
    throw new Error('生产环境 DOWNLOAD_SECRET 至少需要 32 字节');
  }
  const internalStatsToken = env.ID_PHOTO_INTERNAL_STATS_TOKEN || '';
  if (production && Buffer.byteLength(internalStatsToken) < 32) {
    throw new Error('生产环境 ID_PHOTO_INTERNAL_STATS_TOKEN 至少需要 32 字节');
  }
  if (production && (!env.WX_APPID || !env.WX_SECRET)) throw new Error('微信小程序配置不完整');

  return {
    nodeEnv,
    production,
    host: env.HOST || '0.0.0.0',
    port: positiveInteger(env.PORT, 3000, 'PORT'),
    publicBaseUrl,
    dataDir: resolvePath(env.DATA_DIR, './data'),
    storageDir: resolvePath(env.STORAGE_DIR, './storage'),
    retentionMs: positiveInteger(env.FILE_RETENTION_MINUTES, 120, 'FILE_RETENTION_MINUTES') * 60 * 1000,
    cleanupIntervalMs: positiveInteger(env.CLEANUP_INTERVAL_MINUTES, 15, 'CLEANUP_INTERVAL_MINUTES') * 60 * 1000,
    maxFileBytes: positiveInteger(env.MAX_FILE_MB, 10, 'MAX_FILE_MB') * 1024 * 1024,
    maxImagePixels: positiveInteger(env.MAX_IMAGE_PIXELS, 20_000_000, 'MAX_IMAGE_PIXELS'),
    trustProxyHops: nonNegativeInteger(env.TRUST_PROXY_HOPS, production ? 1 : 0, 'TRUST_PROXY_HOPS'),
    apiRateLimitPerMinute: positiveInteger(env.API_RATE_LIMIT_PER_MINUTE, 240, 'API_RATE_LIMIT_PER_MINUTE'),
    processRateLimitPerTenMinutes: positiveInteger(env.PROCESS_RATE_LIMIT_PER_10_MINUTES, 12, 'PROCESS_RATE_LIMIT_PER_10_MINUTES'),
    previewRateLimitPerMinute: positiveInteger(env.PREVIEW_RATE_LIMIT_PER_MINUTE, 120, 'PREVIEW_RATE_LIMIT_PER_MINUTE'),
    downloadRateLimitPerMinute: positiveInteger(env.DOWNLOAD_RATE_LIMIT_PER_MINUTE, 60, 'DOWNLOAD_RATE_LIMIT_PER_MINUTE'),
    maxConcurrentProcessing: positiveInteger(env.MAX_CONCURRENT_PROCESSING, 2, 'MAX_CONCURRENT_PROCESSING'),
    requestTimeoutMs: positiveInteger(env.REQUEST_TIMEOUT_MS, 60_000, 'REQUEST_TIMEOUT_MS'),
    headersTimeoutMs: positiveInteger(env.HEADERS_TIMEOUT_MS, 15_000, 'HEADERS_TIMEOUT_MS'),
    keepAliveTimeoutMs: positiveInteger(env.KEEP_ALIVE_TIMEOUT_MS, 5_000, 'KEEP_ALIVE_TIMEOUT_MS'),
    maxRequestsPerSocket: positiveInteger(env.MAX_REQUESTS_PER_SOCKET, 100, 'MAX_REQUESTS_PER_SOCKET'),
    maxConnections: positiveInteger(env.MAX_CONNECTIONS, 200, 'MAX_CONNECTIONS'),
    shutdownGraceMs: positiveInteger(env.SHUTDOWN_GRACE_MS, 10_000, 'SHUTDOWN_GRACE_MS'),
    downloadSecret,
    internalStatsToken,
    allowMockPayments,
    // 可选：统一使用看板 vb-metrics 的 /api/collect 地址。留空则不上报（no-op）。
    metricsEndpoint: optionalHttpsUrl(env.METRICS_ENDPOINT, 'METRICS_ENDPOINT', production),
    wx: { appId: env.WX_APPID || '', secret: env.WX_SECRET || '' },
    pay: { ...pay, configured: payConfigured },
    seg: { ...seg, configured: segmentationConfigured },
    face: {
      apiUrl: optionalHttpsUrl(env.FACE_API_URL, 'FACE_API_URL', production),
      apiKey: env.FACE_API_KEY || '',
      configured: Boolean(env.FACE_API_URL && env.FACE_API_KEY)
    }
  };
}

module.exports = loadConfig();
module.exports.loadConfig = loadConfig;
