const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { validateOptions, inspectImage } = require('../validation');

test('unknown size, color, and level are rejected', () => {
  assert.throws(
    () => validateOptions({ sizeId: 'x', colorId: 'y', level: 'z' }),
    error => error.code === 'INVALID_OPTIONS' && error.status === 400
  );
});

test('non-image bytes are rejected with a stable code', async () => {
  await assert.rejects(
    () => inspectImage(Buffer.from('not-image')),
    error => error.code === 'INVALID_IMAGE'
  );
});

test('unsupported image formats are rejected', async () => {
  const gif = await sharp({
    create: { width: 300, height: 400, channels: 3, background: 'white' }
  }).gif().toBuffer();
  await assert.rejects(() => inspectImage(gif), error => error.code === 'INVALID_IMAGE');
});

test('huge pixel dimensions are rejected', async () => {
  const image = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: 'white' }
  }).jpeg().toBuffer();
  await assert.rejects(
    () => inspectImage(image, { maxPixels: 20_000_000 }),
    error => error.code === 'IMAGE_TOO_LARGE'
  );
});
