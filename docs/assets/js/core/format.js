/** 数字与日期格式化（全站统一） */

export const DASH = '<span class="null-val">—</span>';

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** 带千分位的整数，null 显示为灰色破折号（用于表格单元格） */
export function fmtInt(n) {
  return n == null ? DASH : n.toLocaleString('en-US');
}

export function fmtPct(v, d = 1) {
  return v == null ? '—' : `${v.toFixed(d)}%`;
}

export function fmtUSD(v) {
  if (v == null) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 大数用中文单位：万 / 亿 / 万亿 */
export function fmtCN(v, d = 1) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(d) + '万亿';
  if (a >= 1e8)  return (v / 1e8).toFixed(d) + '亿';
  if (a >= 1e4)  return (v / 1e4).toFixed(d) + '万';
  return v.toFixed(0);
}

/** 坐标轴刻度：去掉多余的小数 0，如 25 万、2.5 万 */
export function fmtAxisCN(v) {
  const a = Math.abs(v);
  if (a >= 1e8) return +(v / 1e8).toFixed(1) + '亿';
  if (a >= 1e4) return +(v / 1e4).toFixed(1) + '万';
  return String(v);
}

export function shiftDate(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 月份 2026-09 → 2026 年 9 月 */
export function fmtMonthCN(m) {
  return `${m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月`;
}

/** Steam 周次存的是周一日期，对应的榜单更新日是周二 */
export function steamWeekTuesday(mondayIso) {
  return shiftDate(mondayIso, 1);
}

export function fmtWeekCN(mondayIso) {
  const t = steamWeekTuesday(mondayIso);
  return `${+t.slice(5, 7)}月${+t.slice(8, 10)}日`;
}
