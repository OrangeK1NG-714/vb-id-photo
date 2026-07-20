const ERROR_MESSAGES = {
  ENV_NOT_CONFIGURED: '当前版本尚未配置服务地址，请联系管理员',
  NETWORK_TIMEOUT: '网络超时，请检查网络后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  INVALID_IMAGE: '请选择有效的 JPG、PNG、WebP 或 HEIF 图片',
  IMAGE_TOO_LARGE: '图片分辨率过大，请选择较小的原图',
  IMAGE_FILE_TOO_LARGE: '图片文件过大，请选择 10MB 以内的照片',
  IMAGE_TOO_SMALL: '图片分辨率过低，请选择更清晰的照片',
  INVALID_OPTIONS: '所选规格、底色或精修强度无效，请重新选择',
  FACE_NOT_FOUND: '未检测到清晰正脸，请更换正面、无遮挡的照片',
  MULTIPLE_FACES: '照片中只能有一个人，请重新选择',
  PAYMENT_NOT_CONFIGURED: '支付服务尚未开通，暂时无法购买',
  PAYMENT_CREATE_FAILED: '微信支付下单失败，请稍后重试',
  ORDER_UNPAID: '支付结果尚未确认，请稍后刷新',
  ORDER_NOT_FOUND: '订单不存在或照片已按隐私规则删除',
  FILE_EXPIRED: '照片已按隐私规则删除，请重新制作',
  DOWNLOAD_FORBIDDEN: '下载凭证已失效，请刷新订单后重试'
};

function normalizeError(error, fallbackMessage = '服务异常，请稍后重试') {
  const code = error && error.code ? error.code : 'UNKNOWN_ERROR';
  return {
    code,
    message: ERROR_MESSAGES[code] || (error && error.message) || fallbackMessage
  };
}

module.exports = { ERROR_MESSAGES, normalizeError };
