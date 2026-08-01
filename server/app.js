const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { appError } = require('./validation');
const { createMetricsReporter } = require('./metricsReporter');
const { createConcurrencyGate, createRateLimiter } = require('./security');

function secureTokenMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hostname(raw) {
  try {
    return new URL(`http://${raw}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

function isPrivateHostname(value) {
  if (value === 'localhost' || value === '::1' || value.startsWith('127.')) return true;
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function isPublicInternalRequest(req) {
  const hosts = [String(req.headers.host || '')];
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',', 1)[0].trim();
  if (forwarded) hosts.push(forwarded);
  return hosts.some(value => !isPrivateHostname(hostname(value)));
}

function createApp({
  config,
  orderStore,
  fileStore,
  processOrder,
  paymentService,
  metricsReporter,
  logger = console,
  clock = () => Date.now()
}) {
  const app = express();
  // Optional anonymous usage reporting to the unified dashboard; no-op if unset.
  const metrics = metricsReporter || createMetricsReporter({ endpoint: config.metricsEndpoint, logger });

  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);

  const apiLimiter = createRateLimiter({
    limit: config.apiRateLimitPerMinute || 240,
    windowMs: 60_000,
    clock
  });
  const processLimiter = createRateLimiter({
    limit: config.processRateLimitPerTenMinutes || 12,
    windowMs: 10 * 60_000,
    clock
  });
  const processGate = createConcurrencyGate(config.maxConcurrentProcessing || 2);
  const statsCache = new Map();
  const statsCacheTtlMs = 15_000;
  const previewLimiter = createRateLimiter({
    limit: config.previewRateLimitPerMinute || 120,
    windowMs: 60_000,
    clock
  });
  const downloadLimiter = createRateLimiter({
    limit: config.downloadRateLimitPerMinute || 60,
    windowMs: 60_000,
    clock
  });

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (config.production) res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', apiLimiter);

  app.get('/api/internal/stats', (req, res, next) => {
    if (isPublicInternalRequest(req)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    try {
      const received = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
      if (!config.internalStatsToken || !secureTokenMatch(received, config.internalStatsToken)) {
        throw appError('INTERNAL_STATS_UNAUTHORIZED', '内部统计凭证无效', 401);
      }
      const rawDays = req.query.days == null ? '7' : String(req.query.days);
      if (!/^\d+$/.test(rawDays)) throw appError('INVALID_STATS_RANGE', '统计天数无效');
      const days = Number(rawDays);
      if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
        throw appError('INVALID_STATS_RANGE', '统计天数必须在 1 到 365 之间');
      }
      const now = clock();
      const cached = statsCache.get(days);
      if (cached && cached.expiresAt > now) {
        res.json(cached.payload);
        return;
      }
      const since = Math.max(0, now - days * 24 * 60 * 60 * 1000);
      const payload = { ok: true, rangeDays: days, ...orderStore.stats({ since }) };
      statsCache.set(days, { payload, expiresAt: now + statsCacheTtlMs });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/pay/notify', express.raw({ type: 'application/json', limit: '64kb' }), async (req, res, next) => {
    try {
      await paymentService.handleNotify(req.headers, req.body);
      res.json({ code: 'SUCCESS', message: '成功' });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.json({ limit: '64kb' }));
  app.use('/files/preview', previewLimiter, express.static(fileStore.dirs.preview, {
    dotfiles: 'deny',
    fallthrough: false,
    index: false,
    maxAge: '10m',
    immutable: false
  }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxFileBytes || 10 * 1024 * 1024, files: 1, fields: 3, parts: 5 }
  });

  app.post('/api/process', processLimiter, processGate, upload.single('photo'), async (req, res, next) => {
    try {
      if (!req.file) throw appError('PHOTO_REQUIRED', '未收到图片');
      const result = await processOrder({
        photoBuffer: req.file.buffer,
        options: {
          sizeId: req.body.sizeId || 'one-inch',
          colorId: req.body.colorId || 'white',
          level: req.body.level || 'standard'
        }
      });
      res.status(201).json({
        orderId: result.orderId,
        previewUrl: `${config.publicBaseUrl}/files/preview/${result.previewFile}`,
        sizeId: result.sizeId,
        colorId: result.colorId,
        faceAdjusted: result.faceAdjusted,
        processingMode: result.processingMode,
        qualityWarnings: result.qualityWarnings
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/pay/create', async (req, res, next) => {
    try {
      const result = await paymentService.create({
        orderId: req.body?.orderId,
        code: req.body?.code
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/pay/confirm', (req, res, next) => {
    try {
      const order = paymentService.confirm(req.body?.orderId);
      void metrics.report('paid', order.orderId);
      const token = encodeURIComponent(order.downloadToken);
      const root = `${config.publicBaseUrl}/api/orders/${encodeURIComponent(order.orderId)}/download`;
      res.json({
        status: order.status,
        hdUrl: `${root}/hd?token=${token}`,
        sheetUrl: `${root}/sheet?token=${token}`
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/orders/:orderId', (req, res, next) => {
    try {
      const order = orderStore.get(req.params.orderId);
      if (!order) throw appError('ORDER_NOT_FOUND', '订单不存在或已过期', 404);
      res.json({
        orderId: order.orderId,
        status: order.status,
        sizeId: order.sizeId,
        colorId: order.colorId,
        level: order.level,
        faceAdjusted: order.faceAdjusted,
        previewUrl: order.status === 'expired'
          ? ''
          : `${config.publicBaseUrl}/files/preview/${order.previewFile}`,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/orders/:orderId/download/:kind', downloadLimiter, (req, res, next) => {
    try {
      const order = orderStore.get(req.params.orderId);
      if (!order || order.status === 'expired') throw appError('ORDER_NOT_FOUND', '订单不存在或已过期', 404);
      if (order.status !== 'paid') throw appError('ORDER_UNPAID', '订单尚未支付', 402);
      if (!secureTokenMatch(req.query.token, order.downloadToken)) {
        throw appError('DOWNLOAD_FORBIDDEN', '下载凭证无效', 403);
      }
      const field = req.params.kind === 'hd'
        ? 'hdFile'
        : req.params.kind === 'sheet' ? 'sheetFile' : null;
      if (!field) throw appError('FILE_KIND_NOT_FOUND', '文件类型不存在', 404);
      res.set('Cache-Control', 'private, no-store');
      res.set('Content-Disposition', `attachment; filename="id-photo-${req.params.kind}.jpg"`);
      res.sendFile(fileStore.resolve('protected', order[field]), error => {
        if (!error) return;
        next(error.code === 'ENOENT'
          ? appError('FILE_EXPIRED', '照片文件已按隐私规则删除', 410)
          : error);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/health', (_req, res) => {
    try {
      const database = orderStore.health() ? 'ok' : 'error';
      const storage = fileStore.health() ? 'ok' : 'error';
      const ok = database === 'ok' && storage === 'ok';
      res.status(ok ? 200 : 503).json({ ok, database, storage });
    } catch (error) {
      res.status(503).json({ ok: false, database: 'error', storage: 'error' });
    }
  });

  app.use((error, _req, res, next) => {
    let normalized = error;
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      normalized = appError('IMAGE_FILE_TOO_LARGE', '图片文件过大', 413);
    } else if (error instanceof multer.MulterError) {
      normalized = appError('INVALID_UPLOAD', '图片上传请求无效');
    } else if (error.type === 'entity.parse.failed') {
      normalized = appError('INVALID_JSON', '请求 JSON 无效');
    } else if (error.status === 404 && !error.code) {
      normalized = appError('FILE_NOT_FOUND', '文件不存在', 404);
    }
    logger.error(`[${normalized.code || 'INTERNAL_ERROR'}] ${normalized.message}`);
    if (res.headersSent) {
      next(normalized);
      return;
    }
    const status = normalized.status || 500;
    res.status(status).json({
      code: normalized.code || 'INTERNAL_ERROR',
      message: status >= 500 && !normalized.code ? '服务暂时不可用，请稍后重试' : normalized.message
    });
  });

  return app;
}

module.exports = { createApp, secureTokenMatch };
