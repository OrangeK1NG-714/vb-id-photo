const crypto = require('node:crypto');
const fs = require('node:fs');
const axios = require('axios');
const config = require('./config');
const { appError } = require('./validation');

function sign(message, privateKey) {
  return crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
}

function authorization({
  method,
  pathname,
  body,
  mchId,
  serialNo,
  privateKey,
  timestamp = Math.floor(Date.now() / 1000).toString(),
  nonce = crypto.randomBytes(16).toString('hex')
}) {
  const message = `${method}\n${pathname}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = sign(message, privateKey);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
}

function decryptResource(resource, apiV3Key) {
  if (resource.algorithm !== 'AEAD_AES_256_GCM') throw appError('PAY_NOTIFY_INVALID', '支付通知加密算法无效', 401);
  const key = Buffer.isBuffer(apiV3Key) ? apiV3Key : Buffer.from(apiV3Key);
  if (key.length !== 32) throw appError('PAY_NOTIFY_INVALID', '支付通知密钥无效', 401);
  try {
    const payload = Buffer.from(resource.ciphertext, 'base64');
    if (payload.length <= 16) throw new Error('ciphertext too short');
    const encrypted = payload.subarray(0, payload.length - 16);
    const authTag = payload.subarray(payload.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce));
    decipher.setAAD(Buffer.from(resource.associated_data || ''));
    decipher.setAuthTag(authTag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  } catch (error) {
    throw appError('PAY_NOTIFY_INVALID', '支付通知解密失败', 401);
  }
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  const key = Object.keys(headers || {}).find(item => item.toLowerCase() === target);
  return key ? String(headers[key]) : '';
}

function normalizedSerial(value) {
  return value.replace(/:/g, '').replace(/^0+/, '').toUpperCase();
}

function createWxPay(runtimeConfig = config, {
  httpClient = axios,
  readFile = fs.readFileSync,
  now = () => Date.now()
} = {}) {
  function privateKey() {
    return readFile(runtimeConfig.pay.privateKeyPath, 'utf8');
  }

  function platformCertificate() {
    return readFile(runtimeConfig.pay.platformCertPath, 'utf8');
  }

  async function code2Session(code) {
    if (!runtimeConfig.wx.appId || !runtimeConfig.wx.secret) {
      throw appError('WX_NOT_CONFIGURED', '微信小程序登录尚未配置', 503);
    }
    const response = await httpClient.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: runtimeConfig.wx.appId,
        secret: runtimeConfig.wx.secret,
        js_code: code,
        grant_type: 'authorization_code'
      },
      timeout: 10_000
    });
    if (response.data?.errcode || !response.data?.openid) {
      throw appError('WX_LOGIN_FAILED', '微信登录失败，请重试', 502);
    }
    return response.data.openid;
  }

  async function createJsapiOrder({ orderId, openid, amountFen, description }) {
    if (!runtimeConfig.pay.configured) throw appError('PAYMENT_NOT_CONFIGURED', '支付服务尚未配置', 503);
    const pathname = '/v3/pay/transactions/jsapi';
    const body = JSON.stringify({
      appid: runtimeConfig.wx.appId,
      mchid: runtimeConfig.pay.mchId,
      description,
      out_trade_no: orderId,
      notify_url: runtimeConfig.pay.notifyUrl,
      amount: { total: amountFen, currency: 'CNY' },
      payer: { openid }
    });
    const key = privateKey();
    const auth = authorization({
      method: 'POST', pathname, body,
      mchId: runtimeConfig.pay.mchId,
      serialNo: runtimeConfig.pay.serialNo,
      privateKey: key
    });
    const response = await httpClient.post(`https://api.mch.weixin.qq.com${pathname}`, body, {
      headers: {
        authorization: auth,
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'id-photo-miniprogram/1.0'
      },
      timeout: 15_000
    });
    const prepayId = response.data?.prepay_id;
    if (!prepayId) throw appError('PAYMENT_CREATE_FAILED', '微信支付未返回预支付凭证', 502);
    const timeStamp = Math.floor(now() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const packageValue = `prepay_id=${prepayId}`;
    const paySign = sign(`${runtimeConfig.wx.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, key);
    return { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign };
  }

  function verifyAndDecryptNotify(headers, rawBody) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw appError('PAY_NOTIFY_INVALID', '支付通知内容无效', 401);
    }
    const timestamp = headerValue(headers, 'wechatpay-timestamp');
    const nonce = headerValue(headers, 'wechatpay-nonce');
    const signature = headerValue(headers, 'wechatpay-signature');
    const serial = headerValue(headers, 'wechatpay-serial');
    if (!timestamp || !nonce || !signature || !serial) {
      throw appError('PAY_NOTIFY_INVALID', '支付通知签名头缺失', 401);
    }
    const timestampNumber = Number(timestamp);
    if (!Number.isSafeInteger(timestampNumber) || Math.abs(now() - timestampNumber * 1000) > 5 * 60 * 1000) {
      throw appError('PAY_NOTIFY_INVALID', '支付通知时间戳无效', 401);
    }
    const certificate = platformCertificate();
    const certificateSerial = new crypto.X509Certificate(certificate).serialNumber;
    if (normalizedSerial(certificateSerial) !== normalizedSerial(serial)) {
      throw appError('PAY_NOTIFY_INVALID', '支付通知证书序列号无效', 401);
    }
    const message = `${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`;
    const verified = crypto.verify(
      'RSA-SHA256',
      Buffer.from(message),
      certificate,
      Buffer.from(signature, 'base64')
    );
    if (!verified) throw appError('PAY_NOTIFY_INVALID', '微信支付回调验签失败', 401);
    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
      throw appError('PAY_NOTIFY_INVALID', '支付通知 JSON 无效', 401);
    }
    return decryptResource(body.resource || {}, runtimeConfig.pay.apiV3Key);
  }

  return { code2Session, createJsapiOrder, verifyAndDecryptNotify };
}

const defaultClient = createWxPay();

module.exports = {
  sign,
  authorization,
  decryptResource,
  createWxPay,
  code2Session: defaultClient.code2Session,
  createJsapiOrder: defaultClient.createJsapiOrder,
  verifyAndDecryptNotify: defaultClient.verifyAndDecryptNotify
};
