const DEFAULT_MAX_IMAGE_PIXELS = 20_000_000;

function createProcessOrder({
  validateOptions,
  imagePort,
  orderPort,
  filePort,
  metricsPort,
  idPort,
  logger = console,
  clock = () => Date.now(),
  maxImagePixels = DEFAULT_MAX_IMAGE_PIXELS
}) {
  return async function processOrder({ photoBuffer, options: rawOptions }) {
    let storedFiles;
    try {
      const options = validateOptions(rawOptions);
      await imagePort.inspect(photoBuffer, { maxPixels: maxImagePixels });
      const output = await imagePort.process(photoBuffer, options);
      storedFiles = filePort.saveOrderFiles(output);

      const orderId = idPort.createOrderId();
      const downloadToken = idPort.createDownloadToken();
      orderPort.create({
        orderId,
        ...options,
        ...storedFiles,
        downloadToken,
        faceAdjusted: output.faceAdjusted,
        createdAt: clock()
      });

      void metricsPort.report('open', orderId);
      const qualityWarnings = [];
      if (!output.backgroundReplaced) {
        qualityWarnings.push('开发降级模式未完成人像抠图，不可用于正式证件照');
      }
      if (!output.faceAdjusted) {
        qualityWarnings.push('未完成人脸位置校验，请人工确认头顶与下巴完整');
      }

      return {
        orderId,
        previewFile: storedFiles.previewFile,
        sizeId: options.sizeId,
        colorId: options.colorId,
        faceAdjusted: Boolean(output.faceAdjusted),
        processingMode: output.faceDetection || 'unavailable',
        qualityWarnings
      };
    } catch (error) {
      if (storedFiles) {
        try {
          filePort.removeOrderFiles(storedFiles);
        } catch (cleanupError) {
          logger.error(`[FILE_ROLLBACK_FAILED] ${cleanupError.message}`);
        }
      }
      throw error;
    }
  };
}

module.exports = { createProcessOrder };
