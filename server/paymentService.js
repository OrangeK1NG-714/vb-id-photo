const { appError } = require('./validation');

function createPaymentService({ config, orderStore, wxpay }) {
  function requireOrder(orderId) {
    const order = orderStore.get(orderId);
    if (!order || order.status === 'expired') {
      throw appError('ORDER_NOT_FOUND', '订单不存在或已过期', 404);
    }
    return order;
  }

  async function create({ orderId, code }) {
    const order = requireOrder(orderId);
    if (order.status === 'paid') throw appError('ORDER_ALREADY_PAID', '订单已支付', 409);
    if (order.status === 'paying') throw appError('ORDER_PAYMENT_IN_PROGRESS', '订单正在支付中', 409);
    if (!config.pay.configured) {
      if (!config.allowMockPayments) {
        throw appError('PAYMENT_NOT_CONFIGURED', '支付服务尚未配置', 503);
      }
      orderStore.transition(orderId, 'paid', {
        transactionId: `mock-${orderId}`,
        updatedAt: Date.now()
      });
      return { _mock: true };
    }
    if (!code) throw appError('WX_LOGIN_REQUIRED', '微信登录凭证缺失');

    const openid = await wxpay.code2Session(code);
    orderStore.transition(orderId, 'paying', { openid, updatedAt: Date.now() });
    try {
      return await wxpay.createJsapiOrder({
        orderId,
        openid,
        amountFen: config.pay.priceFen,
        description: '证件照高清导出'
      });
    } catch (error) {
      orderStore.transition(orderId, 'failed', { openid, updatedAt: Date.now() });
      if (error.code && error.status) throw error;
      throw appError('PAYMENT_CREATE_FAILED', '微信支付下单失败，请稍后重试', 502);
    }
  }

  function confirm(orderId) {
    const order = requireOrder(orderId);
    if (order.status !== 'paid') throw appError('ORDER_UNPAID', '订单尚未支付', 402);
    return order;
  }

  async function handleNotify(headers, rawBody) {
    if (!config.pay.configured) throw appError('PAYMENT_NOT_CONFIGURED', '支付服务尚未配置', 503);
    const transaction = await wxpay.verifyAndDecryptNotify(headers, rawBody);
    if (transaction.trade_state !== 'SUCCESS') return { accepted: true };

    const order = requireOrder(transaction.out_trade_no);
    const matches =
      transaction.amount?.total === config.pay.priceFen &&
      transaction.amount?.currency === 'CNY' &&
      transaction.mchid === config.pay.mchId &&
      transaction.appid === config.wx.appId &&
      (!order.openid || !transaction.payer?.openid || order.openid === transaction.payer.openid);
    if (!matches) throw appError('PAY_NOTIFY_MISMATCH', '支付通知与订单不匹配', 400);
    if (order.status === 'paid' && order.transactionId && order.transactionId !== transaction.transaction_id) {
      throw appError('PAY_NOTIFY_MISMATCH', '支付流水号与订单不匹配', 400);
    }
    orderStore.transition(order.orderId, 'paid', {
      transactionId: transaction.transaction_id,
      updatedAt: Date.now()
    });
    return { accepted: true };
  }

  return { create, confirm, handleNotify };
}

module.exports = { createPaymentService };
