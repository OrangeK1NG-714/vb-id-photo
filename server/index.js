const path = require('node:path');
const config = require('./config');
const { createApp } = require('./app');
const { startCleanup } = require('./cleanup');
const { createFaceDetector } = require('./faceDetector');
const { createFileStore } = require('./fileStore');
const { createImageProcessor } = require('./imageProcessor');
const { createOrderStore } = require('./orderStore');
const { createPaymentService } = require('./paymentService');
const { createWxPay } = require('./wxpay');

function buildRuntime(runtimeConfig = config, logger = console) {
  const orderStore = createOrderStore(path.join(runtimeConfig.dataDir, 'orders.sqlite'));
  const fileStore = createFileStore(runtimeConfig.storageDir);
  const faceDetector = createFaceDetector(runtimeConfig.face);
  const imageProcessor = createImageProcessor({ runtimeConfig, faceDetector, logger });
  const wxpay = createWxPay(runtimeConfig);
  const paymentService = createPaymentService({
    config: runtimeConfig,
    orderStore,
    wxpay
  });
  const app = createApp({
    config: runtimeConfig,
    orderStore,
    fileStore,
    imageProcessor,
    paymentService,
    logger
  });
  const stopCleanup = startCleanup({
    orderStore,
    fileStore,
    retentionMs: runtimeConfig.retentionMs
  }, runtimeConfig.cleanupIntervalMs, logger);
  return { app, orderStore, fileStore, stopCleanup };
}

function startServer(runtimeConfig = config, logger = console) {
  const runtime = buildRuntime(runtimeConfig, logger);
  const server = runtime.app.listen(runtimeConfig.port, '0.0.0.0', () => {
    logger.info(`证件照后端已启动: http://localhost:${runtimeConfig.port}`);
    if (!runtimeConfig.seg.configured) {
      logger.warn('未配置人像分割：仅可开发联调，输出不可用于正式证件照');
    }
    if (!runtimeConfig.face.configured) {
      logger.warn('未配置人脸检测：使用通用裁切降级，不宣称头部位置已校验');
    }
    if (!runtimeConfig.pay.configured) {
      logger.warn(runtimeConfig.allowMockPayments
        ? '支付为显式开发模拟模式，不代表真实收款验证通过'
        : '支付未配置且模拟模式关闭，支付接口将安全拒绝');
    }
  });

  let shuttingDown = false;
  async function shutdown(signal = 'manual') {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[shutdown] ${signal}`);
    runtime.stopCleanup();
    await new Promise(resolve => server.close(resolve));
    runtime.orderStore.close();
  }

  return { ...runtime, server, shutdown };
}

if (require.main === module) {
  const runtime = startServer();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      runtime.shutdown(signal)
        .then(() => process.exit(0))
        .catch(error => {
          console.error('[shutdown] 关闭失败:', error);
          process.exit(1);
        });
    });
  }
}

module.exports = { buildRuntime, startServer };
