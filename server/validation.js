const sharp = require('sharp');
const { hasColor, hasSize } = require('./sizes');

const LEVELS = new Set(['natural', 'standard', 'clean']);
const FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

function appError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateOptions({ sizeId, colorId, level }) {
  if (!hasSize(sizeId)) throw appError('INVALID_OPTIONS', '不支持所选证件照规格');
  if (!hasColor(colorId)) throw appError('INVALID_OPTIONS', '不支持所选底色');
  if (!LEVELS.has(level)) throw appError('INVALID_OPTIONS', '不支持所选精修强度');
  return { sizeId, colorId, level };
}

async function inspectImage(buffer, { maxPixels = 20_000_000, minDimension = 200 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw appError('INVALID_IMAGE', '请选择有效的 JPG、PNG、WebP 或 HEIF 图片');
  }
  try {
    const metadata = await sharp(buffer, { limitInputPixels: maxPixels, failOn: 'error' }).metadata();
    if (!FORMATS.has(metadata.format)) throw appError('INVALID_IMAGE', '图片格式不受支持');
    if (!metadata.width || !metadata.height) throw appError('INVALID_IMAGE', '无法读取图片尺寸');
    if (metadata.width * metadata.height > maxPixels) {
      throw appError('IMAGE_TOO_LARGE', '图片分辨率过大');
    }
    if (metadata.width < minDimension || metadata.height < minDimension) {
      throw appError('IMAGE_TOO_SMALL', '图片分辨率过低，请选择更清晰的照片');
    }
    return metadata;
  } catch (error) {
    if (error.code && error.status) throw error;
    if (/pixel limit|exceeds pixel/i.test(error.message)) {
      throw appError('IMAGE_TOO_LARGE', '图片分辨率过大');
    }
    throw appError('INVALID_IMAGE', '请选择有效的 JPG、PNG、WebP 或 HEIF 图片');
  }
}

module.exports = { LEVELS, validateOptions, inspectImage, appError };
