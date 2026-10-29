/**
 * 图表配色（唯一来源）
 * - 前 8 色来自 dataviz 参考色板，顺序即色盲安全机制，不可调换
 * - 第 9–11 色为本项目扩展（青 / 橄榄 / 梅红），已用校验器检查：
 *   11 色整体通过明度带、色度下限、相邻色盲区分（ΔE ≥ 8）、正常视觉区分（ΔE ≥ 15）
 * - 超过 11 个同类实体时不再循环取色，改用中性灰，并依靠图例 / 提示框区分
 * - 颜色跟随“实体”（某游戏、某厂商），不随筛选或排名变化
 */
export const CATEGORICAL = [
  '#2a78d6', // 1 蓝
  '#eb6834', // 2 橙
  '#1baf7a', // 3 青绿
  '#eda100', // 4 黄
  '#e87ba4', // 5 粉
  '#008300', // 6 绿
  '#6250d6', // 7 紫
  '#e34948', // 8 红
  '#0e8fa8', // 9 青（扩展）
  '#8a9a00', // 10 橄榄（扩展）
  '#b0408f', // 11 梅红（扩展）
];

// 中性色
export const INK = '#3d3c38';       // 合计 / 总体
export const NEUTRAL = '#b4b2a9';   // “其他”或超出色板的实体
export const MUTED = '#d3d2cc';     // 被弱化的背景线

// 顺序色（单色相，由浅到深）：蓝 250 / 450 / 650
export const SEQ_BLUE = { light: '#86b6ef', mid: '#2a78d6', dark: '#104281', bar: '#9ec5f4' };

/** 按实体在配置中的位置取色（新实体请追加到配置末尾，已有颜色不会变） */
export function colorByIndex(i) {
  return i < CATEGORICAL.length ? CATEGORICAL[i] : NEUTRAL;
}

/** 厂商 / 指标等具名实体的固定色（Ramp 等页面共用，同一厂商在所有图里颜色一致） */
export const ENTITY = {
  OpenAI: CATEGORICAL[0],       openai: CATEGORICAL[0],
  Anthropic: CATEGORICAL[1],    anthropic: CATEGORICAL[1],
  xAI: CATEGORICAL[2],          xai: CATEGORICAL[2],
  Google: CATEGORICAL[3],       google: CATEGORICAL[3],
  DeepSeek: CATEGORICAL[4],
  'Mistral AI': CATEGORICAL[5],
  overall: INK, combined: INK,
  other: NEUTRAL,
};

/**
 * 价格类型固定色（GPU 租赁价格页的所有图共用）
 * 按需=基准线用青绿（加粗）；Spot 用橙；预留按期限由短到长用同一蓝色相由浅到深
 * （按需不用深灰：与最深的预留 36 个月蓝线太接近，交叉时难以分辨）
 */
export const PRICE_COLORS = {
  on_demand: CATEGORICAL[2],
  spot: CATEGORICAL[1],
  reserved_1: SEQ_BLUE.light,
  reserved_12: SEQ_BLUE.mid,
  reserved_36: SEQ_BLUE.dark,
};
