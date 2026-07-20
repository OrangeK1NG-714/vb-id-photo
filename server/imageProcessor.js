const axios = require('axios');
const sharp = require('sharp');
const config = require('./config');
const { calculateCropBox } = require('./faceCrop');
const { createFaceDetector } = require('./faceDetector');
const { getColor, getSize } = require('./sizes');
const { inspectImage } = require('./validation');

function createImageProcessor({
  runtimeConfig = config,
  faceDetector = createFaceDetector(config.face),
  httpClient = axios,
  logger = console
} = {}) {
  const pixelLimit = runtimeConfig.maxImagePixels || 20_000_000;

  async function removeBackground(inputBuffer) {
    if (!runtimeConfig.seg?.configured) {
      logger.warn('[imageProcessor] 未配置人像分割，开发环境使用原图降级');
      return sharp(inputBuffer, { limitInputPixels: pixelLimit }).ensureAlpha().png().toBuffer();
    }
    const response = await httpClient.post(runtimeConfig.seg.apiUrl, inputBuffer, {
      headers: {
        authorization: `Bearer ${runtimeConfig.seg.apiKey}`,
        'content-type': 'application/octet-stream'
      },
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 25 * 1024 * 1024
    });
    const cutout = Buffer.from(response.data);
    await inspectImage(cutout, { maxPixels: pixelLimit });
    return cutout;
  }

  async function detectFace(inputBuffer) {
    if (!faceDetector?.configured) return { faceBox: null, faceAdjusted: false, faceDetection: 'unavailable' };
    try {
      const faceBox = await faceDetector.detect(inputBuffer);
      return { faceBox, faceAdjusted: Boolean(faceBox), faceDetection: faceBox ? 'verified' : 'unavailable' };
    } catch (error) {
      if (error.code === 'FACE_NOT_FOUND' || error.code === 'MULTIPLE_FACES') throw error;
      logger.warn('[imageProcessor] 人脸检测不可用，使用 attention 裁切降级:', error.message);
      return { faceBox: null, faceAdjusted: false, faceDetection: 'degraded' };
    }
  }

  async function compositeBackground(cutoutBuffer, colorId) {
    const { rgb } = getColor(colorId);
    const metadata = await sharp(cutoutBuffer, { limitInputPixels: pixelLimit }).metadata();
    return sharp({
      create: {
        width: metadata.width,
        height: metadata.height,
        channels: 4,
        background: { ...rgb, alpha: 1 }
      }
    }).composite([{ input: cutoutBuffer, blend: 'over' }]).png().toBuffer();
  }

  function retouchParams(level) {
    if (level === 'natural') return { modulate: { brightness: 1.02, saturation: 1.02 }, sharpen: 0.5 };
    if (level === 'clean') return { modulate: { brightness: 1.08, saturation: 1.03 }, sharpen: 0.8 };
    return { modulate: { brightness: 1.05, saturation: 1.02 }, sharpen: 0.6 };
  }

  async function retouch(buffer, level) {
    const params = retouchParams(level);
    return sharp(buffer, { limitInputPixels: pixelLimit })
      .median(1)
      .modulate(params.modulate)
      .sharpen(params.sharpen)
      .toBuffer();
  }

  async function cropToSize(buffer, sizeId, faceBox = null) {
    const { widthPX, heightPX } = getSize(sizeId);
    let pipeline = sharp(buffer, { limitInputPixels: pixelLimit });
    if (faceBox) {
      const metadata = await pipeline.metadata();
      const crop = calculateCropBox(
        { width: metadata.width, height: metadata.height },
        faceBox,
        { width: widthPX, height: heightPX }
      );
      pipeline = pipeline.extract(crop);
    }
    return pipeline
      .resize(widthPX, heightPX, {
        fit: 'cover',
        position: faceBox ? 'centre' : sharp.strategy.attention
      })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toBuffer();
  }

  async function addWatermark(buffer) {
    const metadata = await sharp(buffer).metadata();
    const svg = Buffer.from(`
      <svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
        <defs><pattern id="wm" width="140" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
          <text x="0" y="45" font-size="20" fill="rgba(255,255,255,0.45)" font-family="sans-serif">证件照预览</text>
        </pattern></defs>
        <rect width="100%" height="100%" fill="url(#wm)"/>
      </svg>`);
    return sharp(buffer).composite([{ input: svg, blend: 'over' }]).jpeg({ quality: 90 }).toBuffer();
  }

  async function makePrintSheet(photoBuffer, sizeId) {
    const { widthPX, heightPX } = getSize(sizeId);
    const sheetWidth = 1200;
    const sheetHeight = 1800;
    const gap = 20;
    const columns = Math.max(1, Math.floor((sheetWidth - gap) / (widthPX + gap)));
    const rows = Math.max(1, Math.floor((sheetHeight - gap) / (heightPX + gap)));
    const gridWidth = columns * widthPX + (columns - 1) * gap;
    const gridHeight = rows * heightPX + (rows - 1) * gap;
    const offsetX = Math.floor((sheetWidth - gridWidth) / 2);
    const offsetY = Math.floor((sheetHeight - gridHeight) / 2);
    const composites = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        composites.push({
          input: photoBuffer,
          left: offsetX + column * (widthPX + gap),
          top: offsetY + row * (heightPX + gap)
        });
      }
    }
    return sharp({
      create: { width: sheetWidth, height: sheetHeight, channels: 3, background: '#FFFFFF' }
    }).composite(composites).jpeg({ quality: 95 }).toBuffer();
  }

  async function processIdPhoto(inputBuffer, options) {
    await inspectImage(inputBuffer, { maxPixels: pixelLimit });
    const detection = await detectFace(inputBuffer);
    const cutout = await removeBackground(inputBuffer);
    const composed = await compositeBackground(cutout, options.colorId);
    const retouched = await retouch(composed, options.level);
    const hdBuffer = await cropToSize(retouched, options.sizeId, detection.faceBox);
    const [previewBuffer, sheetBuffer] = await Promise.all([
      addWatermark(hdBuffer),
      makePrintSheet(hdBuffer, options.sizeId)
    ]);
    return {
      previewBuffer,
      hdBuffer,
      sheetBuffer,
      faceAdjusted: detection.faceAdjusted,
      faceDetection: detection.faceDetection,
      backgroundReplaced: Boolean(runtimeConfig.seg?.configured)
    };
  }

  return { processIdPhoto, cropToSize, removeBackground };
}

const defaultProcessor = createImageProcessor();

module.exports = {
  createImageProcessor,
  processIdPhoto: defaultProcessor.processIdPhoto
};
