/** AI / Ramp AI 指数：AI 采用率、人均支出、token 支出与价格、AI 占企业支出比例 */
import {
  chartIn, lineBase, lineSeries, areaSeries, axisTooltip, yAxis,
  tipHeader, tipRow, tipDivider, END_LABEL_MAX,
} from '../core/charts.js';
import { ENTITY, INK, MUTED, SEQ_BLUE } from '../core/colors.js';
import { fmtPct, fmtUSD, fmtCN, fmtMonthCN, shiftDate } from '../core/format.js';
import { rangeStart, indicesFrom } from '../core/range.js';
import { bindSeg, segHtml, downloadCSV, fetchJSON } from '../core/ui.js';

let G = null;
const state = { range: 'ALL', pepmScale: 'log', tokenMetric: 'spend', tokenMode: 'value', priceType: 'blended', shareSector: null };

// 系列颜色：厂商沿用全站固定色；人均支出为同一色相的三个层级（浅 → 深）
const COLORS = { ...ENTITY, median: SEQ_BLUE.light, top10: SEQ_BLUE.mid, top1: SEQ_BLUE.dark };
const LABELS = {
  overall: '全部企业', combined: 'OpenAI + Anthropic',
  openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI', google: 'Google', other: '其他',
  median: '中位数企业', top10: '前 10% 企业', top1: '前 1% 企业',
};
const label = k => LABELS[k] ?? k;

const ADOPTION_KEYS = ['overall', 'OpenAI', 'Anthropic', 'xAI', 'DeepSeek', 'Mistral AI'];
const PEPM_KEYS = ['top1', 'top10', 'median'];
const TOKEN_KEYS = ['anthropic', 'openai', 'xai', 'google', 'other'];   // 堆叠自下而上
const PRICE_KEYS = ['combined', 'anthropic', 'openai'];
const PRICE_TYPE_LABELS = { blended: '综合', input: '输入', output: '输出' };

// NAICS 行业中文简称
const SECTOR_CN = {
  'Accommodation and Food Services': '住宿和餐饮',
  'Administrative and Support and Waste Management and Remediation Services': '行政支持与废物管理',
  'Agriculture, Forestry, Fishing and Hunting': '农林牧渔',
  'Arts, Entertainment, and Recreation': '艺术、娱乐和休闲',
  'Construction': '建筑',
  'Educational Services': '教育服务',
  'Finance and Insurance': '金融和保险',
  'Health Care and Social Assistance': '医疗和社会救助',
  'Information': '信息',
  'Management of Companies and Enterprises': '企业管理',
  'Manufacturing': '制造',
  'Mining, Quarrying, and Oil and Gas Extraction': '采矿和油气开采',
  'Other Services (except Public Administration)': '其他服务',
  'Professional, Scientific, and Technical Services': '专业、科学和技术服务',
  'Public Administration': '公共管理',
  'Real Estate and Rental and Leasing': '房地产和租赁',
  'Retail Trade': '零售',
  'Transportation and Warehousing': '运输和仓储',
  'Utilities': '公用事业',
  'Wholesale Trade': '批发',
};
const sectorLabel = k => SECTOR_CN[k] ?? k;
const fmtTokenValue = (metric, v) => metric === 'spend' ? '$' + fmtCN(v) : fmtCN(v) + ' tokens';

// ── 时间范围：以全部数据中最新的日期为基准，所有图共用 ──
function indices(keys) {
  if (state.range === 'ALL') return indicesFrom(keys, null);
  const latest = [G.tokens.weeks.at(-1), G.token_prices.dates.at(-1), G.adoption.months.at(-1) + '-01'].sort().at(-1);
  return indicesFrom(keys, rangeStart(latest, state.range));
}

// 有线尾标注时，右侧需要留出标签空间
const gridFor = (endLabel, left = 64) => ({ left, right: endLabel ? 110 : 24 });

// ── KPI ──────────────────────────────────────
function renderKpis() {
  const a = G.adoption, pe = G.spend_per_employee, t = G.tokens, p = G.token_prices;
  const arrow = d => d > 0 ? '▲' : d < 0 ? '▼' : '—';

  const ai = a.months.length - 1;
  const adopt = a.series.overall[ai], adoptPrev = a.series.overall[ai - 1];

  const pi = pe.months.length - 1;
  const med = pe.series.median[pi], medPrev = pe.series.median[pi - 1];

  // 与 Ramp 页面一致：最新一周对比 4 周前的同一周
  const wi = t.weeks.length - 1, wp = Math.max(0, wi - 4);
  const weekTotal = i => TOKEN_KEYS.reduce((s, k) => s + t.spend[k][i], 0);
  const spendChg = (weekTotal(wi) / weekTotal(wp) - 1) * 100;

  const di = p.dates.length - 1;
  const prevIdx = p.dates.indexOf(shiftDate(p.dates[di], -28));
  const price = p.blended.combined[di];
  const pricePrev = prevIdx >= 0 ? p.blended.combined[prevIdx] : null;
  const priceChg = pricePrev ? (price / pricePrev - 1) * 100 : null;

  const tiles = [
    { label: 'AI 采用率', value: fmtPct(adopt),
      delta: `${arrow(adopt - adoptPrev)} ${Math.abs(adopt - adoptPrev).toFixed(1)} 个百分点 · 较上月`,
      period: `${fmtMonthCN(a.months[ai])} · 全部企业` },
    { label: '人均月 AI 支出（中位数）', value: fmtUSD(med),
      delta: `${arrow(med - medPrev)} ${fmtUSD(Math.abs(med - medPrev))} · 较上月`,
      period: `${fmtMonthCN(pe.months[pi])} · 有 AI 支出的企业` },
    { label: '每周 token 支出', value: '$' + fmtCN(weekTotal(wi), 0),
      delta: `${arrow(spendChg)} ${Math.abs(spendChg).toFixed(1)}% · 较 4 周前`,
      period: `截至 ${t.weeks[wi]} 的一周` },
    { label: 'Token 综合价格', value: price == null ? '—' : `$${price.toFixed(2)}`,
      delta: priceChg == null ? '—' : `${arrow(priceChg)} ${Math.abs(priceChg).toFixed(1)}% · 较 4 周前`,
      period: `每百万 token · OpenAI + Anthropic · ${p.dates[di]}` },
  ];
  document.getElementById('ramp-kpis').innerHTML = tiles.map(x => `
    <div class="kpi">
      <div class="kpi-label">${x.label}</div>
      <div class="kpi-value">${x.value}</div>
      <div class="kpi-delta">${x.delta}</div>
      <div class="kpi-period">${x.period}</div>
    </div>`).join('');
}

// ── 图表 ─────────────────────────────────────
function renderAdoption() {
  const a = G.adoption, idx = indices(a.months);
  const endLabel = ADOPTION_KEYS.length <= END_LABEL_MAX;
  chartIn('chart-ramp-adoption').setOption({
    ...lineBase(idx.map(i => a.months[i]), { grid: gridFor(endLabel), legendData: ADOPTION_KEYS.map(label) }),
    tooltip: axisTooltip(v => fmtPct(v, 2), { header: fmtMonthCN }),
    yAxis: yAxis({ axisLabel: { formatter: '{value}%' } }),
    series: ADOPTION_KEYS.map(k => lineSeries(label(k), COLORS[k], idx.map(i => a.series[k][i]), { bold: k === 'overall', endLabel })),
  }, true);
}

function renderPepm() {
  const pe = G.spend_per_employee, idx = indices(pe.months);
  const log = state.pepmScale === 'log';
  chartIn('chart-ramp-pepm').setOption({
    ...lineBase(idx.map(i => pe.months[i]), { grid: gridFor(true), legendData: PEPM_KEYS.map(label) }),
    tooltip: axisTooltip(fmtUSD, { header: fmtMonthCN }),
    yAxis: yAxis({
      type: log ? 'log' : 'value', logBase: 10, min: log ? 1 : 0,
      axisLabel: { formatter: v => '$' + v.toLocaleString('en-US') },
    }),
    series: PEPM_KEYS.map(k => lineSeries(label(k), COLORS[k], idx.map(i => pe.series[k][i]), { endLabel: true })),
  }, true);
}

function renderTokens() {
  const t = G.tokens, { tokenMetric: metric, tokenMode: mode } = state;
  const idx = indices(t.weeks);
  const totals = idx.map(i => TOKEN_KEYS.reduce((s, k) => s + t[metric][k][i], 0));
  const share = mode === 'share';
  const valueFmt = v => share ? fmtPct(v) : fmtTokenValue(metric, v);

  document.getElementById('ramp-tokens-title').textContent =
    `Token ${metric === 'spend' ? '支出' : '用量'}${share ? '占比' : ''}：按模型提供商`;

  chartIn('chart-ramp-tokens').setOption({
    ...lineBase(idx.map(i => t.weeks[i]), { grid: { left: 72, right: 24 }, legendData: TOKEN_KEYS.map(label), legendKind: 'area' }),
    tooltip: axisTooltip(valueFmt, {
      header: v => `截至 ${v} 的一周`,
      sort: false, reverse: true,   // 与堆叠顺序一致，自上而下
      extra: j => tipRow('合计', fmtTokenValue(metric, totals[j])) + tipDivider,
    }),
    yAxis: yAxis({
      max: share ? 100 : null,
      axisLabel: { formatter: v => share ? `${v}%` : (metric === 'spend' ? '$' : '') + fmtCN(v, 0) },
    }),
    series: TOKEN_KEYS.map(k => areaSeries(label(k), COLORS[k], idx.map((i, j) =>
      share ? (totals[j] ? t[metric][k][i] / totals[j] * 100 : null) : t[metric][k][i]))),
  }, true);
}

function renderPrices() {
  const p = G.token_prices, type = state.priceType, idx = indices(p.dates);
  chartIn('chart-ramp-prices').setOption({
    ...lineBase(idx.map(i => p.dates[i]), { xFmt: v => v.slice(0, 7), grid: gridFor(true), legendData: PRICE_KEYS.map(label) }),
    tooltip: axisTooltip(v => `$${v.toFixed(3)}`, { header: v => `${v}（滚动 7 天）` }),
    yAxis: yAxis({ axisLabel: { formatter: v => `$${v.toFixed(2)}` } }),
    series: PRICE_KEYS.map(k => lineSeries(label(k), COLORS[k], idx.map(i => p[type][k][i]), { bold: k === 'combined', endLabel: true })),
  }, true);
}

// 最新月份数值最高的行业，作为默认高亮
function defaultSector() {
  const sh = G.spend_share, last = sh.months.length - 1;
  return Object.keys(sh.sectors).sort((a, b) => (sh.sectors[b][last] ?? -1) - (sh.sectors[a][last] ?? -1))[0];
}

function renderShare() {
  const sh = G.spend_share;
  if (!sh) return;
  const idx = indices(sh.months), focus = state.shareSector;
  const muted = Object.keys(sh.sectors).filter(k => k !== focus).map(k => lineSeries(sectorLabel(k), MUTED,
    idx.map(i => sh.sectors[k][i]), { extra: { id: `bg-${k}`, silent: true, z: 1, lineStyle: { width: 1 }, emphasis: { disabled: true } } }));
  const overall = lineSeries(label('overall'), INK, idx.map(i => sh.overall[i]), { bold: true, endLabel: true, extra: { id: 'overall' } });
  const focused = lineSeries(sectorLabel(focus), SEQ_BLUE.mid, idx.map(i => sh.sectors[focus][i]), { endLabel: true, extra: { id: 'focus' } });

  chartIn('chart-ramp-share').setOption({
    ...lineBase(idx.map(i => sh.months[i]), { grid: { left: 56, right: 140 }, legendData: [overall.name, focused.name] }),
    // 灰色背景线不进入提示框
    tooltip: axisTooltip(v => fmtPct(v, 2), { header: fmtMonthCN, skip: p => String(p.seriesId).startsWith('bg-') }),
    yAxis: yAxis({ axisLabel: { formatter: '{value}%' } }),
    series: [...muted, overall, focused],
  }, true);
}

function renderShareBar() {
  const sh = G.spend_share;
  if (!sh) return;
  const last = sh.months.length - 1;
  const rows = Object.keys(sh.sectors)
    .map(k => ({ key: k, value: sh.sectors[k][last] }))
    .filter(r => r.value != null)
    .sort((a, b) => a.value - b.value);   // 横向条形图自下而上，最大值在顶部
  const overall = sh.overall[last];
  document.getElementById('ramp-share-bar-sub').textContent =
    `${fmtMonthCN(sh.months[last])} · 竖线为全部企业（${fmtPct(overall, 2)}）`;

  const chart = chartIn('chart-ramp-share-bar');
  chart.setOption({
    animation: false,
    grid: { top: 8, right: 64, bottom: 24, left: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: p => tipHeader(p.name) + tipRow('AI 支出占比', fmtPct(p.value, 2)) + tipRow('全部企业', fmtPct(overall, 2)),
    },
    xAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: rows.map(r => sectorLabel(r.key)), axisLabel: { color: '#52514e', fontSize: 12 } },
    series: [{
      type: 'bar', barWidth: '62%', cursor: 'pointer',
      data: rows.map(r => ({
        value: r.value,
        itemStyle: { color: r.key === state.shareSector ? SEQ_BLUE.mid : SEQ_BLUE.bar, borderRadius: [0, 4, 4, 0] },
      })),
      label: { show: true, position: 'right', color: '#52514e', fontSize: 11, formatter: p => fmtPct(p.value, 2) },
      emphasis: { itemStyle: { color: SEQ_BLUE.mid } },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: INK, type: 'solid', width: 1 }, label: { show: false }, data: [{ xAxis: overall }] },
    }],
  }, true);
  // 点击整行（含空白处和行业名）都能选中，不必精确点到很短的条形
  chart.getZr().off('click');
  chart.getZr().on('click', e => {
    const pt = [e.offsetX, e.offsetY];
    if (!chart.containPixel('grid', pt) && e.offsetX > chart.convertToPixel('grid', [0, 0])[0]) return;
    const i = Math.round(chart.convertFromPixel({ yAxisIndex: 0 }, e.offsetY));
    if (rows[i]) setSector(rows[i].key);
  });
}

function setSector(sector) {
  state.shareSector = sector;
  document.getElementById('ramp-share-sector').value = sector;
  renderShare();
  renderShareBar();
}

function renderAll() {
  renderKpis();
  renderAdoption();
  renderPepm();
  renderTokens();
  renderPrices();
  renderShare();
  renderShareBar();
}

// ── CSV ──────────────────────────────────────
function download(kind) {
  if (kind === 'adoption') {
    const a = G.adoption;
    downloadCSV([['Month', ...ADOPTION_KEYS.map(label)],
      ...a.months.map((m, i) => [m, ...ADOPTION_KEYS.map(k => a.series[k][i])])], 'ramp_ai_adoption.csv');
  } else if (kind === 'pepm') {
    const pe = G.spend_per_employee, keys = [...PEPM_KEYS].reverse();
    downloadCSV([['Month', ...keys.map(label)],
      ...pe.months.map((m, i) => [m, ...keys.map(k => pe.series[k][i])])], 'ramp_ai_spend_per_employee.csv');
  } else if (kind === 'tokens') {
    const t = G.tokens, metric = state.tokenMetric, unit = metric === 'spend' ? 'USD' : 'tokens';
    downloadCSV([['Week ending', ...TOKEN_KEYS.map(k => `${label(k)} (${unit})`), `合计 (${unit})`],
      ...t.weeks.map((w, i) => {
        const vals = TOKEN_KEYS.map(k => t[metric][k][i]);
        return [w, ...vals, vals.reduce((s, v) => s + v, 0)];
      })], `ramp_token_${metric}_weekly.csv`);
  } else if (kind === 'share') {
    const sh = G.spend_share, names = Object.keys(sh.sectors);
    downloadCSV([['Month', '全部企业 (%)', ...names.map(n => `${sectorLabel(n)} (%)`)],
      ...sh.months.map((m, i) => [m, sh.overall[i], ...names.map(n => sh.sectors[n][i])])], 'ramp_ai_share_of_spend.csv');
  } else if (kind === 'prices') {
    const p = G.token_prices, type = state.priceType;
    downloadCSV([['Date', ...PRICE_KEYS.map(k => `${label(k)} ${PRICE_TYPE_LABELS[type]} ($/M tokens)`)],
      ...p.dates.map((d, i) => [d, ...PRICE_KEYS.map(k => p[type][k][i])])], `ramp_token_price_${type}_daily.csv`);
  }
}

// ── 页面骨架 ─────────────────────────────────
const dl = kind => `<button type="button" class="btn" data-dl="${kind}">下载 CSV</button>`;

const TEMPLATE = `
  <div class="card">
    <div class="card-head" style="margin-bottom:0;align-items:center">
      <div class="card-intro" style="max-width:820px">
        <b>Ramp AI Index</b>：Ramp Economics Lab 基于其企业卡与账单支付平台上 8.5 万+ 家美国企业的真实交易，按月统计 AI 采用率与支出；
        token 数据来自使用 Ramp AI Token Spend Management 的企业，按周统计。
        <a href="https://ramp.com/data/ai-index" target="_blank" rel="noopener">查看原始页面 ↗</a>
      </div>
      <div class="filter-group">
        <span class="filter-label">时间范围</span>
        ${segHtml([['6M', '6个月'], ['1Y', '1年'], ['ALL', '全部']], 'ALL', 'id="ramp-range"')}
      </div>
    </div>
  </div>

  <div class="kpi-row" id="ramp-kpis"></div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">AI 采用率：总体及分厂商</div>
          <div class="card-sub">当月有 AI 付费支出的企业占比 · 月度</div></div>
        <div class="card-tools">${dl('adoption')}</div>
      </div>
      <div id="chart-ramp-adoption" class="chart md"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title">人均月 AI 支出</div>
          <div class="card-sub">仅含有 AI 支出的企业，美元 / 员工 / 月 · 月度</div></div>
        <div class="card-tools">
          ${segHtml([['log', '对数轴'], ['linear', '线性轴']], 'log', 'id="ramp-pepm-scale"')}
          ${dl('pepm')}
        </div>
      </div>
      <div id="chart-ramp-pepm" class="chart md"></div>
      <div class="card-note">前 10% / 前 1% 为该组企业内部的中位数。</div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title" id="ramp-tokens-title">Token 支出：按模型提供商</div>
          <div class="card-sub">每周（周六至周五），堆叠顶端即合计</div></div>
        <div class="card-tools">
          ${segHtml([['spend', '支出'], ['volume', '用量']], 'spend', 'id="ramp-token-metric"')}
          ${segHtml([['value', '金额'], ['share', '占比']], 'value', 'id="ramp-token-mode"')}
          ${dl('tokens')}
        </div>
      </div>
      <div id="chart-ramp-tokens" class="chart md"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Token 价格</div>
          <div class="card-sub">美元 / 百万 token，滚动 7 天成本 ÷ 用量 · 每日</div></div>
        <div class="card-tools">
          ${segHtml([['blended', '综合'], ['input', '输入'], ['output', '输出']], 'blended', 'id="ramp-price-type"')}
          ${dl('prices')}
        </div>
      </div>
      <div id="chart-ramp-prices" class="chart md"></div>
      <div class="card-note">Ramp 仅公布 OpenAI 与 Anthropic 的价格；“输入”为未命中缓存的输入 token。</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">AI 占企业支出比例（不含工资）</div>
          <div class="card-sub">AI 支出 ÷ 经 Ramp 支付的全部支出 · 月度 · 灰线为其余行业</div></div>
        <div class="card-tools">
          <span class="filter-label">高亮行业</span>
          <select class="select" id="ramp-share-sector"></select>
          ${dl('share')}
        </div>
      </div>
      <div id="chart-ramp-share" class="chart tall"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title">AI 占企业支出比例：分行业</div>
          <div class="card-sub" id="ramp-share-bar-sub"></div></div>
      </div>
      <div id="chart-ramp-share-bar" class="chart tall"></div>
      <div class="card-note">点击行业可在左图中高亮其走势；单个行业的月度数值波动较大。</div>
    </div>
  </div>

  <div class="card notes">
    <h3>口径说明</h3>
    <ul>
      <li><b>采用率</b>：当月在 Ramp 上有 AI 产品或服务正向付费交易（企业卡、账单、ACH）的企业占比；免费工具和员工个人账户不计入，可能低估实际使用。</li>
      <li><b>人均月 AI 支出</b>：当月 AI 支出 ÷ 员工数，只统计有 AI 支出的企业。</li>
      <li><b>AI 占企业支出比例</b>：分母为经 Ramp 支付的全部支出（企业卡、账单 / ACH），工资通常不经 Ramp 发放，因此不在其中；分子包括大模型订阅、编程助手订阅、API token 以及 GPU 云和基础设施支出。行业按 NAICS 分类，不含未识别行业。</li>
      <li><b>Token 支出 / 用量</b>：来自接入 Ramp Token Spend Management 的企业，从各 AI 提供商账单按模型归属；不代表 Ramp 全体客户，少数大客户可能显著影响份额。</li>
      <li><b>Token 价格</b>：Ramp 单独发布的价格序列，样本与 token 支出图不完全相同，两者数值不宜直接换算。</li>
      <li>样本企业数随时间增长（2023 年中约 1.3 万家，2026 年约 6.5 万家），早期与近期的企业构成不同。</li>
    </ul>
  </div>`;

export default {
  async mount(root) {
    G = await fetchJSON('ramp.json', { optional: true });
    if (!G) {
      root.innerHTML = '<div class="card"><div class="state">Ramp 数据尚未采集。<br>GitHub Actions 每周两次自动运行后将在此显示。</div></div>';
      return;
    }
    root.innerHTML = TEMPLATE;

    const $ = id => document.getElementById(id);
    bindSeg($('ramp-range'), v => { state.range = v; renderAll(); });
    bindSeg($('ramp-pepm-scale'), v => { state.pepmScale = v; renderPepm(); });
    bindSeg($('ramp-token-metric'), v => { state.tokenMetric = v; renderTokens(); });
    bindSeg($('ramp-token-mode'), v => { state.tokenMode = v; renderTokens(); });
    bindSeg($('ramp-price-type'), v => { state.priceType = v; renderPrices(); });

    if (G.spend_share) {
      state.shareSector = defaultSector();
      const sel = $('ramp-share-sector');
      Object.keys(G.spend_share.sectors)
        .sort((a, b) => sectorLabel(a).localeCompare(sectorLabel(b), 'zh-CN'))
        .forEach(k => sel.add(new Option(sectorLabel(k), k)));
      sel.value = state.shareSector;
      sel.addEventListener('change', () => setSector(sel.value));
    }
    root.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => download(b.dataset.dl)));
  },
  activate() { if (G) renderAll(); },
  metaText: () => (G ? `Ramp 数据更新：${G.last_updated}　·　月度数据截至 ${G.adoption.months.at(-1)}　·　token 数据截至 ${G.tokens.weeks.at(-1)}` : ''),
};
