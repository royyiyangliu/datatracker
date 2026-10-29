/** AI / GPU 租赁价格：主流型号的按需、Spot、预留（1 / 12 / 36 个月）周度中位价 */
import { chartIn, lineBase, lineSeries, axisTooltip, yAxis } from '../core/charts.js';
import { PRICE_COLORS } from '../core/colors.js';
import { DASH, esc } from '../core/format.js';
import { rangeStart, indicesFrom } from '../core/range.js';
import { bindSeg, segHtml, downloadCSV, fetchJSON } from '../core/ui.js';

let G = null;
let active = false;
const state = { range: 'ALL', hidden: new Set(['Spot']) };   // Spot 默认隐藏，点击图例可显示

// 价格类型：(数据字段, 图例名)；顺序即图例和表格列顺序
const TYPES = [
  ['on_demand', '按需'],
  ['spot', 'Spot'],
  ['reserved_1', '预留 1 个月'],
  ['reserved_12', '预留 12 个月'],
  ['reserved_36', '预留 36 个月'],
];
const SPARSE = 5;   // 供应商数少于此值时标注“样本少”
const usd = v => '$' + v.toFixed(2);

const slugs = () => Object.keys(G.gpus);
const chartId = slug => `chart-gpu-${slug}`;

// ── 最新一周汇总表 ───────────────────────────
function renderSummary() {
  const last = G.weeks.length - 1, prev = Math.max(0, last - 4);
  const arrow = d => d > 0 ? '▲' : d < 0 ? '▼' : '—';
  const cell = (s, i) => {
    const v = s?.median[i];
    if (v == null) return `<td>${DASH}</td>`;
    const n = s.providers[i];
    return `<td>${usd(v)}<span class="sub">${n} 家${n < SPARSE ? '·样本少' : ''}</span></td>`;
  };
  const rows = slugs().map(slug => {
    const g = G.gpus[slug], od = g.series.on_demand;
    const chg = od?.median[last] != null && od.median[prev] ? (od.median[last] / od.median[prev] - 1) * 100 : null;
    return `<tr><td>${esc(g.label)}</td>${TYPES.map(([k]) => cell(g.series[k], last)).join('')}` +
      `<td>${chg == null ? DASH : `${arrow(chg)} ${Math.abs(chg).toFixed(1)}%`}</td></tr>`;
  }).join('');
  document.getElementById('gpu-summary').innerHTML =
    `<thead><tr><th>型号</th>${TYPES.map(([, n]) => `<th>${n}</th>`).join('')}<th>按需较 4 周前</th></tr></thead><tbody>${rows}</tbody>`;
  document.getElementById('gpu-summary-sub').textContent =
    `最新一周（${G.weeks[last]}）各类价格的中位数，美元 / GPU 小时；小字为该价格的供应商数`;
}

// ── 图表 ─────────────────────────────────────
function renderChart(slug) {
  const g = G.gpus[slug];
  const idx = indicesFrom(G.weeks, rangeStart(G.weeks.at(-1), state.range));
  const names = [], meta = {}, series = [];
  TYPES.forEach(([key, name]) => {
    const s = g.series[key];
    if (!s) return;
    names.push(name);
    meta[name] = { min: idx.map(i => s.min[i]), max: idx.map(i => s.max[i]), n: idx.map(i => s.providers[i]) };
    series.push(lineSeries(name, PRICE_COLORS[key], idx.map(i => s.median[i]), { bold: key === 'on_demand' }));
  });

  const base = lineBase(idx.map(i => G.weeks[i]), { xFmt: v => v.slice(0, 7), legendData: names, grid: { left: 56 } });
  const chart = chartIn(chartId(slug));
  chart.setOption({
    ...base,
    legend: { ...base.legend, selected: Object.fromEntries(names.map(n => [n, !state.hidden.has(n)])) },
    tooltip: axisTooltip((v, p) => {
      const m = meta[p.seriesName], j = p.dataIndex;
      const n = m.n[j];
      return `${usd(v)}<span style="font-weight:400;color:#52514e"> · 范围 ${usd(m.min[j])}–${usd(m.max[j])} · ${n} 家${n < SPARSE ? '（样本少）' : ''}</span>`;
    }, { header: v => `${v} 当周` }),
    yAxis: yAxis({ axisLabel: { formatter: v => '$' + v } }),
    series,
  }, true);

  // 在任一图上点选图例，所有型号图同步显示 / 隐藏
  if (!chart.__gpuBound) {
    chart.__gpuBound = true;
    chart.on('legendselectchanged', e => {
      let changed = false;
      Object.entries(e.selected).forEach(([name, on]) => {
        if (on === state.hidden.has(name)) {
          on ? state.hidden.delete(name) : state.hidden.add(name);
          changed = true;
        }
      });
      if (changed) renderAll();
    });
  }
}

function renderAll() {
  if (!active || !G) return;
  renderSummary();
  slugs().forEach(renderChart);
}

// ── CSV ──────────────────────────────────────
function download() {
  const rows = [['型号', '周（周一）', '价格类型', '中位价（美元/GPU小时）', '最低价', '最高价', '供应商数']];
  slugs().forEach(slug => {
    const g = G.gpus[slug];
    TYPES.forEach(([key, name]) => {
      const s = g.series[key];
      if (!s) return;
      G.weeks.forEach((w, i) => {
        if (s.median[i] != null) rows.push([g.label, w, name, s.median[i], s.min[i], s.max[i], s.providers[i]]);
      });
    });
  });
  downloadCSV(rows, 'gpu_rental_prices.csv');
}

// ── 页面骨架 ─────────────────────────────────
const TEMPLATE = slugList => `
  <div class="card">
    <div class="card-head" style="margin-bottom:0;align-items:center">
      <div class="card-intro" style="max-width:860px">
        <b>GPU 租赁价格</b>：主流数据中心 GPU 在各云厂商的公开标价，按周统计，折算为每 GPU 小时美元；
        同一型号的按需、Spot、预留（1 / 12 / 36 个月）价格画在同一张图上。<b>Spot 线默认隐藏，点击图例中的“Spot”即可显示。</b>
        数据来源：<a href="https://getdeploying.com/dataset/gpu-prices" target="_blank" rel="noopener">GetDeploying</a>
        （<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>），本页对其周度数据集做了型号筛选与整理。
      </div>
      <div class="filter-group">
        <span class="filter-label">时间范围</span>
        ${segHtml([['3M', '3个月'], ['6M', '6个月'], ['ALL', '全部']], 'ALL', 'id="gpu-range"')}
        <button type="button" class="btn" id="gpu-dl">下载 CSV</button>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><div class="card-title">最新一周价格汇总</div><div class="card-sub" id="gpu-summary-sub"></div></div>
    </div>
    <div class="table-scroll"><table class="compact" id="gpu-summary"></table></div>
  </div>

  <div class="grid-2">
    ${slugList.map(([slug, label]) => `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">${esc(label)}</div>
          <div class="card-sub">美元 / GPU 小时 · 周度中位数</div></div>
      </div>
      <div id="${chartId(slug)}" class="chart md"></div>
    </div>`).join('')}
  </div>

  <div class="card notes">
    <h3>口径说明</h3>
    <ul>
      <li><b>标价而非成交价</b>：均为各供应商公开的价格，不含大客户谈判价，也不是实际成交价；价格为整机价 ÷ GPU 数，取标准 Linux 共享实例，区域取靠近美国弗吉尼亚或法兰克福的，税前。</li>
      <li><b>按需</b>：随用随付，无承诺。<b>Spot</b>：低价租用闲置算力，但实例可能随时被供应商收回。<b>预留</b>：承诺租用 1 / 12 / 36 个月换取折扣，取无预付的价格；其余期限（3、6、24 个月等）未在图中展示，明细见数据文件。</li>
      <li><b>中位数</b>：同一周、同一类价格下各报价的中位数，具体加权方式数据源未说明；折线旁的“范围”为该周最低价到最高价。</li>
      <li><b>样本在变化</b>：每周纳入统计的供应商数不同，中位数的变化里有一部分来自样本变化而非价格变化。供应商少于 5 家的数值（尤其是 B200 / B300 的长期预留、GB200）基本代表个别报价，仅供参考；例如 GB200 的 Spot 目前只有 1 家供应商，且高于按需价，不具代表性。</li>
      <li><b>历史较短</b>：H100、A100 的数据起自 2025-10-27，B300、GB200 等新型号起点更晚，部分价格类型有空缺。</li>
      <li>不同来源（如指数商的成交类价格、SemiAnalysis 的 1 年期合同价）口径不同，数值不能直接与本页比较。</li>
    </ul>
  </div>`;

export default {
  async mount(root) {
    G = await fetchJSON('gpu.json', { optional: true });
    if (!G) {
      root.innerHTML = '<div class="card"><div class="state">GPU 价格数据尚未采集。<br>GitHub Actions 每周两次自动运行后将在此显示。</div></div>';
      return;
    }
    root.innerHTML = TEMPLATE(slugs().map(s => [s, G.gpus[s].label]));
    bindSeg(document.getElementById('gpu-range'), v => { state.range = v; renderAll(); });
    document.getElementById('gpu-dl').addEventListener('click', download);
  },
  activate() { active = true; renderAll(); },
  deactivate() { active = false; },
  metaText: () => (G ? `GPU 价格更新：${G.last_updated}　·　数据截至 ${G.weeks.at(-1)}（周一）` : ''),
};
