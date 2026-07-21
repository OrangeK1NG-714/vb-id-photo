const { getBaseUrl } = require('../config.js');
const { normalizeError } = require('./errors.js');

function endpoint(url) {
  try {
    return getBaseUrl() + url;
  } catch (error) {
    throw normalizeError(error);
  }
}

function networkError(error) {
  const timeout = error && error.errMsg && error.errMsg.indexOf('timeout') !== -1;
  return normalizeError({ code: timeout ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR' });
}

function request({ url, method = 'POST', data = {}, header = {} }) {
  return new Promise((resolve, reject) => {
    let fullUrl;
    try {
      fullUrl = endpoint(url);
    } catch (error) {
      reject(error);
      return;
    }
    wx.request({
      url: fullUrl,
      method,
      data,
      header: { 'content-type': 'application/json', ...header },
      timeout: 30000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(normalizeError(res.data));
      },
      fail(error) {
        reject(networkError(error));
      }
    });
  });
}

function uploadImage({ url, filePath, formData = {} }) {
  return new Promise((resolve, reject) => {
    let fullUrl;
    try {
      fullUrl = endpoint(url);
    } catch (error) {
      reject(error);
      return;
    }
    wx.uploadFile({
      url: fullUrl,
      filePath,
      name: 'photo',
      formData,
      timeout: 60000,
      success(res) {
        try {
          const data = JSON.parse(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(normalizeError(data));
        } catch (_) {
          reject({ code: 'INVALID_RESPONSE', message: '服务返回数据异常，请稍后重试' });
        }
      },
      fail(error) {
        reject(networkError(error));
      }
    });
  });
}

module.exports = { request, uploadImage };
