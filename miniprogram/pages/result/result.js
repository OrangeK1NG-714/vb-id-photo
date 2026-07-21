const { SIZES, BG_COLORS } = require('../../utils/sizes.js');
const { request } = require('../../utils/request.js');
const { normalizeError } = require('../../utils/errors.js');
const { currentEnv } = require('../../config.js');

const PRICE = 6;
const STORAGE_KEY = 'idPhoto:lastOrder';

Page({
  data: {
    orderId: '',
    previewSrc: '',
    sizeId: 'one-inch',
    colorId: 'white',
    sizeName: '',
    sizeSpec: '',
    colorName: '',
    price: PRICE,
    status: 'created',
    statusMessage: '',
    paid: false,
    paying: false,
    recovering: false,
    hdUrl: '',
    sheetUrl: ''
  },

  onLoad(query = {}) {
    const saved = wx.getStorageSync(STORAGE_KEY) || {};
    const sizeId = query.sizeId || saved.sizeId || 'one-inch';
    const colorId = query.colorId || saved.colorId || 'white';
    const size = SIZES.find(item => item.id === sizeId) || SIZES[0];
    const color = BG_COLORS.find(item => item.id === colorId) || BG_COLORS[0];
    const orderId = query.orderId || saved.orderId || '';
    const previewSrc = query.preview ? decodeURIComponent(query.preview) : (saved.previewSrc || '');
    this.setData({
      orderId,
      previewSrc,
      sizeId,
      colorId,
      sizeName: size.name,
      sizeSpec: `${size.widthMM}×${size.heightMM}mm`,
      colorName: color.name
    });
    if (orderId) {
      this.persistOrder();
      this.recoverOrder({ silent: true });
    } else {
      this.setData({ statusMessage: '未找到可恢复的订单，请重新制作' });
    }
  },

  onUnload() {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
  },

  persistOrder() {
    wx.setStorageSync(STORAGE_KEY, {
      orderId: this.data.orderId,
      previewSrc: this.data.previewSrc,
      sizeId: this.data.sizeId,
      colorId: this.data.colorId
    });
  },

  recoverOrder({ silent = false } = {}) {
    if (!this.data.orderId || this.data.recovering) return;
    this.setData({ recovering: true });
    request({ url: `/api/orders/${this.data.orderId}`, method: 'GET' })
      .then((order) => {
        const updates = {
          recovering: false,
          status: order.status,
          previewSrc: order.previewUrl || this.data.previewSrc
        };
        if (order.status === 'expired') {
          updates.statusMessage = '照片已按隐私规则删除，请重新制作';
          wx.removeStorageSync(STORAGE_KEY);
        } else if (order.status === 'paying') {
          updates.statusMessage = '支付结果确认中，可稍后刷新';
        } else if (order.status === 'failed') {
          updates.statusMessage = '上次下单未完成，可重新发起支付';
        } else {
          updates.statusMessage = '';
        }
        this.setData(updates);
        if (order.status === 'paid') this.confirmPaid({ silent: true });
      })
      .catch((error) => {
        const normalized = normalizeError(error);
        this.setData({ recovering: false, statusMessage: normalized.message });
        if (normalized.code === 'ORDER_NOT_FOUND') wx.removeStorageSync(STORAGE_KEY);
        if (!silent) wx.showToast({ title: normalized.message, icon: 'none', duration: 3000 });
      });
  },

  onRefresh() {
    this.recoverOrder();
  },

  onPay() {
    if (this.data.paying || !this.data.orderId) return;
    this.setData({ paying: true, statusMessage: '' });
    wx.login({
      success: (loginResult) => {
        if (!loginResult.code) {
          this.setData({ paying: false });
          wx.showToast({ title: '微信登录失败，请重试', icon: 'none' });
          return;
        }
        request({
          url: '/api/pay/create',
          data: { orderId: this.data.orderId, code: loginResult.code }
        }).then((payParams) => {
          if (payParams._mock) {
            if (currentEnv() === 'develop') {
              this.confirmPaid();
            } else {
              this.setData({ paying: false });
              wx.showModal({
                title: '支付配置异常',
                content: '非开发版本禁止模拟支付，请联系管理员检查后端配置。',
                showCancel: false
              });
            }
            return;
          }
          wx.requestPayment({
            timeStamp: payParams.timeStamp,
            nonceStr: payParams.nonceStr,
            package: payParams.package,
            signType: payParams.signType || 'RSA',
            paySign: payParams.paySign,
            success: () => this.confirmPaid(),
            fail: () => {
              this.setData({ paying: false, status: 'created' });
              wx.showToast({ title: '支付未完成', icon: 'none' });
            }
          });
        }).catch((error) => {
          const normalized = normalizeError(error);
          this.setData({ paying: false, statusMessage: normalized.message });
          wx.showToast({ title: normalized.message, icon: 'none', duration: 3000 });
        });
      },
      fail: () => {
        this.setData({ paying: false });
        wx.showToast({ title: '微信登录失败，请重试', icon: 'none' });
      }
    });
  },

  confirmPaid({ attempt = 0, silent = false } = {}) {
    request({
      url: '/api/pay/confirm',
      data: { orderId: this.data.orderId }
    }).then((result) => {
      this.setData({
        paying: false,
        recovering: false,
        paid: true,
        status: 'paid',
        statusMessage: '',
        hdUrl: result.hdUrl || '',
        sheetUrl: result.sheetUrl || '',
        previewSrc: result.hdUrl || this.data.previewSrc
      });
      if (!silent) wx.showToast({ title: '支付成功', icon: 'success' });
    }).catch((error) => {
      const normalized = normalizeError(error);
      if (normalized.code === 'ORDER_UNPAID' && attempt < 5) {
        this.confirmTimer = setTimeout(() => {
          this.confirmPaid({ attempt: attempt + 1, silent });
        }, 1000);
        return;
      }
      this.setData({
        paying: false,
        recovering: false,
        status: normalized.code === 'ORDER_UNPAID' ? 'paying' : this.data.status,
        statusMessage: normalized.message
      });
      if (!silent) {
        wx.showModal({
          title: '支付结果待确认',
          content: `${normalized.message}。款项不会因刷新页面重复扣取。`,
          showCancel: false
        });
      }
    });
  },

  saveUrl(url) {
    if (!url) {
      wx.showToast({ title: '暂无可保存图片', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '下载中…', mask: true });
    wx.downloadFile({
      url,
      success: (download) => {
        if (download.statusCode !== 200) {
          wx.hideLoading();
          wx.showToast({ title: '下载失败，请刷新订单后重试', icon: 'none' });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: download.tempFilePath,
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: (error) => {
            wx.hideLoading();
            if (error.errMsg && error.errMsg.indexOf('auth deny') !== -1) {
              wx.showModal({
                title: '需要相册权限',
                content: '请在设置中允许保存图片到相册',
                confirmText: '去设置',
                success: (modal) => { if (modal.confirm) wx.openSetting(); }
              });
            } else {
              wx.showToast({ title: '保存失败，请重试', icon: 'none' });
            }
          }
        });
      },
      fail: (error) => {
        wx.hideLoading();
        wx.showToast({ title: normalizeError(error, '下载失败，请重试').message, icon: 'none' });
      }
    });
  },

  onSave() {
    this.saveUrl(this.data.hdUrl);
  },

  onSaveSheet() {
    this.saveUrl(this.data.sheetUrl);
  },

  onRemake() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
