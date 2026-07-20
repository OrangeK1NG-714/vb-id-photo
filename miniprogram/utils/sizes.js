// utils/sizes.js
// 常用证件照规格库。px 基于 300dpi 计算，用于导出；mm 用于展示。
// 用户痛点是"选对尺寸、一定过审"，所以规格必须准确、覆盖高频场景。

const SIZES = [
  {
    id: 'one-inch',
    name: '一寸',
    desc: '25×35mm · 通用',
    widthMM: 25, heightMM: 35,
    widthPX: 295, heightPX: 413,
    group: '常用'
  },
  {
    id: 'small-one-inch',
    name: '小一寸',
    desc: '22×32mm · 部分考试',
    widthMM: 22, heightMM: 32,
    widthPX: 260, heightPX: 378,
    group: '常用'
  },
  {
    id: 'large-one-inch',
    name: '大一寸',
    desc: '33×48mm · 部分证件',
    widthMM: 33, heightMM: 48,
    widthPX: 390, heightPX: 567,
    group: '常用'
  },
  {
    id: 'two-inch',
    name: '二寸',
    desc: '35×49mm · 通用',
    widthMM: 35, heightMM: 49,
    widthPX: 413, heightPX: 579,
    group: '常用'
  },
  {
    id: 'small-two-inch',
    name: '小二寸',
    desc: '35×45mm · 签证/护照',
    widthMM: 35, heightMM: 45,
    widthPX: 413, heightPX: 531,
    group: '常用'
  },
  {
    id: 'exam-gongwuyuan',
    name: '公务员考试',
    desc: '295×413px',
    widthMM: 25, heightMM: 35,
    widthPX: 295, heightPX: 413,
    group: '考试报名'
  },
  {
    id: 'exam-jiaoshi',
    name: '教师资格证',
    desc: '295×413px',
    widthMM: 25, heightMM: 35,
    widthPX: 295, heightPX: 413,
    group: '考试报名'
  },
  {
    id: 'visa-usa',
    name: '美国签证',
    desc: '51×51mm · 2×2inch',
    widthMM: 51, heightMM: 51,
    widthPX: 600, heightPX: 600,
    group: '签证'
  }
];

// 底色库：证件照只允许纯色背景，给出最常用的三种。
const BG_COLORS = [
  { id: 'white', name: '白底', color: '#FFFFFF', desc: '考试/签证常用' },
  { id: 'blue',  name: '蓝底', color: '#438EDB', desc: '简历/社保常用' },
  { id: 'red',   name: '红底', color: '#FF0000', desc: '部分证件' }
];

module.exports = { SIZES, BG_COLORS };
