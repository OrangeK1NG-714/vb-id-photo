function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function calculateCropBox(source, face, target) {
  if (!source?.width || !source?.height || !face?.width || !face?.height || !target?.width || !target?.height) {
    throw new Error('裁切几何参数无效');
  }
  const targetRatio = target.width / target.height;
  let height = Math.min(source.height, Math.max(face.height / 0.38, 1));
  let width = height * targetRatio;
  if (width > source.width) {
    width = source.width;
    height = width / targetRatio;
  }
  width = Math.max(1, Math.floor(width));
  height = Math.max(1, Math.floor(width / targetRatio));
  if (height > source.height) {
    height = source.height;
    width = Math.max(1, Math.floor(height * targetRatio));
  }
  const faceCenterX = face.x + face.width / 2;
  const desiredTop = face.y - height * 0.18;
  const left = clamp(Math.round(faceCenterX - width / 2), 0, source.width - width);
  const top = clamp(Math.round(desiredTop), 0, source.height - height);
  return { left, top, width, height };
}

module.exports = { calculateCropBox };
