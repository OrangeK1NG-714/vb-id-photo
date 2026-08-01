const test = require('node:test');
const assert = require('node:assert/strict');

const { createProcessOrder } = require('../application/processOrder');

function createHarness(overrides = {}) {
  const calls = [];
  const output = {
    previewBuffer: Buffer.from('preview'),
    hdBuffer: Buffer.from('hd'),
    sheetBuffer: Buffer.from('sheet'),
    faceAdjusted: false,
    faceDetection: 'degraded',
    backgroundReplaced: false
  };
  const storedFiles = {
    previewFile: 'preview.jpg',
    hdFile: 'hd.jpg',
    sheetFile: 'sheet.jpg'
  };
  const ports = {
    validateOptions(raw) {
      calls.push(['validate', raw]);
      return { sizeId: raw.sizeId, colorId: raw.colorId, level: raw.level };
    },
    imagePort: {
      async inspect(buffer, limits) {
        calls.push(['inspect', buffer, limits]);
      },
      async process(buffer, options) {
        calls.push(['process', buffer, options]);
        return output;
      }
    },
    orderPort: {
      create(order) {
        calls.push(['create-order', order]);
        return order;
      }
    },
    filePort: {
      saveOrderFiles(receivedOutput) {
        calls.push(['save-files', receivedOutput]);
        return storedFiles;
      },
      removeOrderFiles(files) {
        calls.push(['remove-files', files]);
      }
    },
    metricsPort: {
      report(event, orderId) {
        calls.push(['metric', event, orderId]);
      }
    },
    idPort: {
      createOrderId: () => 'order-id',
      createDownloadToken: () => 'download-token'
    },
    logger: {
      error(message) {
        calls.push(['log-error', message]);
      }
    },
    clock: () => 1_234,
    maxImagePixels: 456,
    ...overrides
  };

  return {
    calls,
    output,
    storedFiles,
    processOrder: createProcessOrder(ports)
  };
}

test('processOrder coordinates image, file and order ports without HTTP dependencies', async () => {
  const harness = createHarness();
  const photoBuffer = Buffer.from('photo');
  const options = { sizeId: 'one-inch', colorId: 'white', level: 'standard' };

  const result = await harness.processOrder({ photoBuffer, options });

  assert.deepEqual(result, {
    orderId: 'order-id',
    previewFile: 'preview.jpg',
    sizeId: 'one-inch',
    colorId: 'white',
    faceAdjusted: false,
    processingMode: 'degraded',
    qualityWarnings: [
      '开发降级模式未完成人像抠图，不可用于正式证件照',
      '未完成人脸位置校验，请人工确认头顶与下巴完整'
    ]
  });
  assert.deepEqual(harness.calls.map(call => call[0]), [
    'validate',
    'inspect',
    'process',
    'save-files',
    'create-order',
    'metric'
  ]);
  assert.deepEqual(harness.calls[1], ['inspect', photoBuffer, { maxPixels: 456 }]);
  assert.deepEqual(harness.calls[4][1], {
    orderId: 'order-id',
    sizeId: 'one-inch',
    colorId: 'white',
    level: 'standard',
    previewFile: 'preview.jpg',
    hdFile: 'hd.jpg',
    sheetFile: 'sheet.jpg',
    downloadToken: 'download-token',
    faceAdjusted: false,
    createdAt: 1_234
  });
});

test('processOrder removes all stored files when order persistence fails', async () => {
  const persistenceError = new Error('database unavailable');
  const harness = createHarness({
    orderPort: {
      create() {
        throw persistenceError;
      }
    }
  });

  await assert.rejects(
    harness.processOrder({
      photoBuffer: Buffer.from('photo'),
      options: { sizeId: 'one-inch', colorId: 'white', level: 'standard' }
    }),
    error => error === persistenceError
  );
  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'remove-files'),
    [['remove-files', harness.storedFiles]]
  );
});

test('processOrder reports rollback failures while preserving the original error', async () => {
  const persistenceError = new Error('database unavailable');
  const harness = createHarness({
    orderPort: {
      create() {
        throw persistenceError;
      }
    },
    filePort: {
      saveOrderFiles() {
        return {
          previewFile: 'preview.jpg',
          hdFile: 'hd.jpg',
          sheetFile: 'sheet.jpg'
        };
      },
      removeOrderFiles() {
        throw new Error('disk unavailable');
      }
    }
  });

  await assert.rejects(
    harness.processOrder({
      photoBuffer: Buffer.from('photo'),
      options: { sizeId: 'one-inch', colorId: 'white', level: 'standard' }
    }),
    error => error === persistenceError
  );
  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'log-error'),
    [['log-error', '[FILE_ROLLBACK_FAILED] disk unavailable']]
  );
});
