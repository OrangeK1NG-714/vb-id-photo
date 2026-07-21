const axios = require('axios');
const { appError } = require('./validation');

function createFaceDetector({ apiUrl, apiKey, httpClient = axios }) {
  const configured = Boolean(apiUrl && apiKey);

  async function detect(buffer) {
    if (!configured) return null;
    const response = await httpClient.post(
      apiUrl,
      { image: buffer.toString('base64') },
      {
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        timeout: 15_000,
        maxContentLength: 1024 * 1024,
        maxBodyLength: 16 * 1024 * 1024,
        maxRedirects: 0
      }
    );
    const faces = Array.isArray(response.data?.faces) ? response.data.faces : [];
    if (faces.length === 0) throw appError('FACE_NOT_FOUND', '未检测到清晰正脸');
    if (faces.length > 1) throw appError('MULTIPLE_FACES', '照片中只能有一个人');
    const face = faces[0];
    const normalized = {
      x: Number(face.x),
      y: Number(face.y),
      width: Number(face.width),
      height: Number(face.height),
      confidence: Number(face.confidence ?? 0)
    };
    if (![normalized.x, normalized.y, normalized.width, normalized.height].every(Number.isFinite) ||
        normalized.x < 0 || normalized.y < 0 || normalized.width <= 0 || normalized.height <= 0) {
      throw appError('FACE_DETECTOR_UNAVAILABLE', '人脸检测服务返回异常', 503);
    }
    return normalized;
  }

  return { detect, configured };
}

module.exports = { createFaceDetector };
