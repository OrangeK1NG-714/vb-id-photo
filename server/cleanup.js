function cleanupExpired({ orderStore, fileStore, retentionMs, now = Date.now() }) {
  const expiredOrders = orderStore.listExpired(now - retentionMs);
  for (const order of expiredOrders) {
    fileStore.removeOrderFiles(order);
    orderStore.transition(order.orderId, 'expired', { updatedAt: now });
  }
  return expiredOrders.length;
}

function startCleanup(options, intervalMs, logger = console) {
  function run() {
    try {
      const count = cleanupExpired(options);
      if (count > 0) logger.info(`[cleanup] 已清理 ${count} 个过期订单文件`);
    } catch (error) {
      logger.error('[cleanup] 清理失败:', error.message);
    }
  }

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { cleanupExpired, startCleanup };
