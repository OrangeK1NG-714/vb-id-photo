// pages/edit/edit.js
const { SIZES, BG_COLORS } = require('../../utils/sizes.js');
const { uploadImage } = require('../../utils/request.js');
const { normalizeError } = require('../../utils/errors.js');

const LEVELS = [
  { id: 'natural', name: '自然', desc: '轻磨皮·去油光' },
  { id: 'standard', name: '标准', desc: '匀肤·修碎发' },
  { id: 'clean', name: '清爽', desc: '提亮·补光' }
];

Page({
  data: {
    src: '',            // 原图临时路径
    previewSrc: '',     // 原图/处理后预览
    sizeId: 'one-inch',
    sizeName: '',
    sizeSpec: '',
    colors: BG_COLORS,
    selectedColorId: 'white',
    selectedColor: '#FFFFFF',
    levels: LEVELS,
    selectedLevelId: 'standard',
    processing: false
  },

  onLoad(query) {
    const src = query.src ? decodeURIComponent(query.src) : '';
    const sizeId = query.sizeId || 'one-inch';
    const size = SIZES.find(s => s.id === sizeId) || SIZES[0];
    this.setData({
      src,
      previewSrc: src,
      sizeId,
      sizeName: size.name,
      sizeSpec: `${size.widthMM}×${size.heightMM}mm`
    });
  },

  onSelectColor(e) {
    const id = e.currentTarget.dataset.id;
    const c = BG_COLORS.find(x => x.id === id);
    this.setData({ selectedColorId: id, selectedColor: c.color });
  },

  onSelectLevel(e) {
    this.setData({ selectedLevelId: e.currentTarget.dataset.id });
  },

  onGenerate() {
    if (this.data.processing) return;
    if (!this.data.src) {
      wx.showToast({ title: '未获取到照片', icon: 'none' });
      return;
    }
    this.setData({ processing: true, previewSrc: '' });
    wx.showLoading({ title: 'AI 精修中…', mask: true });

    uploadImage({
      url: '/api/process',
      filePath: this.data.src,
      formData: {
        sizeId: this.data.sizeId,
        colorId: this.data.selectedColorId,
        level: this.data.selectedLevelId
      }
    }).then((res) => {
      wx.hideLoading();
      this.setData({ processing: false });
      // 后端返回：{ orderId, previewUrl(带水印), sizeId, colorId }
      if (!res || !res.previewUrl) {
        wx.showToast({ title: '处理失败，请重试', icon: 'none' });
        return;
      }
      const targetUrl = `/pages/result/result?orderId=${res.orderId}` +
        `&preview=${encodeURIComponent(res.previewUrl)}` +
        `&sizeId=${this.data.sizeId}&colorId=${this.data.selectedColorId}`;
      wx.setStorageSync('idPhoto:lastOrder', {
        orderId: res.orderId,
        previewSrc: res.previewUrl,
        sizeId: this.data.sizeId,
        colorId: this.data.selectedColorId
      });
      const navigate = () => wx.navigateTo({ url: targetUrl });
      if (res.qualityWarnings && res.qualityWarnings.length) {
        wx.showModal({
          title: '开发降级提示',
          content: res.qualityWarnings.join('\n'),
          showCancel: false,
          success: navigate
        });
      } else {
        navigate();
      }
    }).catch((error) => {
      wx.hideLoading();
      this.setData({ processing: false, previewSrc: this.data.src });
      wx.showToast({ title: normalizeError(error).message, icon: 'none', duration: 3000 });
    });
  }
});
