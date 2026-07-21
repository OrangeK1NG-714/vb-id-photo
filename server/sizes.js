// sizes.js —— 后端权威的规格库。
// 前端也有一份用于展示，但导出尺寸以后端为准，避免被篡改。
const SIZES = {
  'one-inch':        { name: '一寸',       widthPX: 295, heightPX: 413 },
  'small-one-inch':  { name: '小一寸',     widthPX: 260, heightPX: 378 },
  'large-one-inch':  { name: '大一寸',     widthPX: 390, heightPX: 567 },
  'two-inch':        { name: '二寸',       widthPX: 413, heightPX: 579 },
  'small-two-inch':  { name: '小二寸',     widthPX: 413, heightPX: 531 },
  'exam-gongwuyuan': { name: '公务员考试', widthPX: 295, heightPX: 413 },
  'exam-jiaoshi':    { name: '教师资格证', widthPX: 295, heightPX: 413 },
  'visa-usa':        { name: '美国签证',   widthPX: 600, heightPX: 600 }
};

const COLORS = {
  white: { name: '白底', rgb: { r: 255, g: 255, b: 255 } },
  blue:  { name: '蓝底', rgb: { r: 67,  g: 142, b: 219 } },
  red:   { name: '红底', rgb: { r: 255, g: 0,   b: 0 } }
};

function hasSize(id) { return Object.hasOwn(SIZES, id); }
function hasColor(id) { return Object.hasOwn(COLORS, id); }
function getSize(id) {
  if (!hasSize(id)) throw new Error(`未知证件照规格: ${id}`);
  return SIZES[id];
}
function getColor(id) {
  if (!hasColor(id)) throw new Error(`未知底色: ${id}`);
  return COLORS[id];
}

module.exports = { SIZES, COLORS, hasSize, hasColor, getSize, getColor };
