const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateCropBox } = require('../faceCrop');
const { createFaceDetector } = require('../faceDetector');

test('face-aware crop stays inside the source and matches target ratio', () => {
  const crop = calculateCropBox(
    { width: 1200, height: 1600 },
    { x: 450, y: 180, width: 300, height: 360 },
    { width: 295, height: 413 }
  );
  assert.ok(crop.left >= 0 && crop.top >= 0);
  assert.ok(crop.left + crop.width <= 1200);
  assert.ok(crop.top + crop.height <= 1600);
  assert.ok(Math.abs(crop.width / crop.height - 295 / 413) < 0.01);
});

test('a face near the top never produces a negative crop', () => {
  const crop = calculateCropBox(
    { width: 800, height: 1000 },
    { x: 250, y: 5, width: 260, height: 300 },
    { width: 295, height: 413 }
  );
  assert.equal(crop.top, 0);
});

test('unconfigured detector returns an explicit unavailable result', async () => {
  const detector = createFaceDetector({ apiUrl: '', apiKey: '' });
  assert.equal(detector.configured, false);
  assert.equal(await detector.detect(Buffer.from('image')), null);
});
