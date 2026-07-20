// pages/index/index.js
const { SIZES } = require('../../utils/sizes.js');

Page({
  data: {
    sizes: [],
    selectedId: 'one-inch'
  },

  onLoad() {
    // 把规格库映射成页面需要的字段
    const sizes = SIZES.map(s => ({
      id: s.id,
      name: s.name,
      wmm: s.widthMM,
      hmm: s.heightMM,
      wpx: s.widthPX,
      hpx: s.heightPX,
      group: s.group
    }));
    this.setData({ sizes });
  },

  onSelectSize(e) {
    this.setData({ selectedId: e.currentTarget.dataset.id });
  },

  onChoosePhoto() {
    const { selectedId } = this.data;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: (res) => {
        const tempFile = res.tempFiles[0];
        // 简单的大小校验，避免超大图上传失败
        if (tempFile.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '图片过大，请选择 10MB 以内', icon: 'none' });
          return;
        }
        wx.navigateTo({
          url: `/pages/edit/edit?src=${encodeURIComponent(tempFile.tempFilePath)}&sizeId=${selectedId}`
        });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      }
    });
  }
});
