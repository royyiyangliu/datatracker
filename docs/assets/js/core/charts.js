/**
 * 图表基础层：所有页面的图表共用同一套主题、坐标轴、提示框、图例与线条规格
 * 依赖全局 echarts（index.html 中以 CDN 引入）
 */
import { CATEGORICAL } from './colors.js';

const INK_1 = '#0b0b0b', INK_2 = '#52514e', INK_3 = '#898781';
const GRID = '#e1e0d9', AXIS = '#c3c2b7', SURFACE = '#fcfcfb';
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

echarts.registerTheme('dt', {
  color: CATEGORICAL,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: FONT, color: INK_2 },
  line: { symbol: 'none', smooth: false, lineStyle: { width: 2 } },
  categoryAxis: {
    axisLine: { lineStyle: { color: AXIS } }, axisTick: { show: false },
    axisLabel: { color: INK_3 }, splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: INK_3 }, splitLine: { lineStyle: { color: GRID, width: 1 } },
  },
  logAxis: {
    axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: INK_3 }, splitLine: { lineStyle: { color: GRID, width: 1 } },
  },
  legend: { textStyle: { color: INK_2, fontSize: 12 } },
  tooltip: {
    backgroundColor: SURFACE, borderColor: 'rgba(11,11,11,0.12)', borderWidth: 1,
    padding: [10, 12], textStyle: { color: INK_1, fontSize: 12 },
    extraCssText: 'box-shadow:0 4px 16px rgba(11,11,11,0.10);border-radius:8px;',
  },
});

const instances = new WeakMap();
const observer = new ResizeObserver(entries => {
  entries.forEach(e => instances.get(e.target)?.resize());
});

/** 在容器内创建（或复用）图表；容器尺寸变化（含 tab 切换后可见）时自动 resize */
export function chartIn(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  let c = instances.get(el);
  if (!c) {
    c = echarts.init(el, 'dt');
    instances.set(el, c);
    observer.observe(el);
  }
  return c;
}

// ── 提示框 ──────────────────────────────────

const lineKey = color =>
  `<span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${color};vertical-align:middle;margin-right:6px"></span>`;

export function tipHeader(text) {
  return `<div style="font-size:13px;font-weight:600;margin-bottom:6px">${text}</div>`;
}

export function tipRow(name, value, color) {
  return `<div style="margin:3px 0;display:flex;justify-content:space-between;gap:24px">
    <span style="color:${INK_2}">${color ? lineKey(color) : ''}${name}</span><b>${value}</b></div>`;
}

export const tipDivider = '<div style="border-top:1px solid #e1e0d9;margin:4px 0"></div>';

/**
 * 十字线 + 多系列提示框
 * fmt(value, param)；header(axisValue)；sort: 'desc'（默认，数值大的在前）| 'asc' | false
 * reverse: 按堆叠顺序自上而下；extra(dataIndex): 在表头下方追加内容；skip(param): 忽略某些系列
 */
export function axisTooltip(fmt, { header = v => v, sort = 'desc', reverse = false, extra = null, skip = null } = {}) {
  return {
    trigger: 'axis',
    axisPointer: { type: 'line', lineStyle: { color: AXIS, width: 1, type: 'solid' } },
    formatter(params) {
      let rows = params.filter(p => p.value != null && !(skip && skip(p)));
      if (!rows.length) return '';
      if (sort === 'desc') rows = [...rows].sort((a, b) => b.value - a.value);
      if (sort === 'asc')  rows = [...rows].sort((a, b) => a.value - b.value);
      if (reverse) rows = [...rows].reverse();
      let html = tipHeader(header(params[0].axisValue));
      if (extra) html += extra(params[0].dataIndex);
      rows.forEach(p => { html += tipRow(p.seriesName, fmt(p.value, p), p.color); });
      return html;
    },
  };
}

// ── 图表骨架 ─────────────────────────────────

/** 图例：线图用细短线，面积图用方块；单系列图不应调用 */
export function legend({ kind = 'line', data } = {}) {
  return {
    bottom: 4, type: 'plain', data,
    icon: 'roundRect',
    itemWidth: kind === 'line' ? 16 : 12,
    itemHeight: kind === 'line' ? 4 : 12,
    textStyle: { fontSize: 12, color: INK_2 },
  };
}

/** 折线图骨架：时间类目轴、底部图例 */
export function lineBase(xData, { xFmt, grid = {}, legendData, legendKind } = {}) {
  return {
    animation: false,
    // 图例系列多时会折成两行，给底部多留一些空间
    grid: { top: 16, right: 24, bottom: (legendData?.length ?? 0) > 6 ? 84 : 56, left: 64, ...grid },
    legend: legend({ kind: legendKind, data: legendData }),
    xAxis: {
      type: 'category', data: xData, boundaryGap: false,
      axisLabel: xFmt ? { formatter: xFmt } : {},
    },
  };
}

export const yAxis = extra => ({ type: 'value', ...extra });

/**
 * 折线系列：2px 线，无标记点；总体 / 合计线加粗；
 * endLabel 在线尾直接标注名称（系列较少时开启，避免标签互相遮挡）
 */
export function lineSeries(name, color, data, { bold = false, endLabel = false, extra = {} } = {}) {
  return {
    name, type: 'line', data, color,
    symbol: 'none', connectNulls: false,
    lineStyle: { width: bold ? 2.5 : 2 },
    z: bold ? 3 : 2,
    emphasis: { focus: 'series' },
    ...(endLabel ? {
      endLabel: { show: true, formatter: '{a}', color: INK_2, fontSize: 11 },
      labelLayout: { moveOverlap: 'shiftY' },
    } : {}),
    ...extra,
  };
}

/** 堆叠面积：相邻色块之间用表面色细线分隔 */
export function areaSeries(name, color, data, stack = 'total') {
  return {
    name, type: 'line', stack, data, color,
    symbol: 'none',
    lineStyle: { width: 1, color: SURFACE },
    areaStyle: { opacity: 0.92 },
    emphasis: { focus: 'series' },
  };
}

/** 系列数 ≤ 此值时在线尾直接标注（其余只靠图例和提示框） */
export const END_LABEL_MAX = 6;
