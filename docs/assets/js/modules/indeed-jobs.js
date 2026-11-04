/** AI / AI 招聘：Indeed 各国“含 AI 关键词的岗位占比”，对照各国整体岗位指数与美国分行业岗位景气度 */
import { chartIn, lineBase, lineSeries, axisTooltip, yAxis } from '../core/charts.js';
import { COUNTRY_COLORS, PICK_COLORS, INK, MUTED } from '../core/colors.js';
import { DASH, esc } from '../core/format.js';
import { rangeStart, indicesFrom } from '../core/range.js';
import { bindSeg, segHtml, downloadCSV, fetchJSON } from '../core/ui.js';

let D = null;
let active = false;
const state = {
  range: '3Y',
  view: 'level',                 // AI 占比视图：level 占比 | rel 相对基期
  hidden: new Set(),             // 点击图例隐藏的国家，AI 占比图与国家对比图同步
  countryMetric: 'new',          // 各国整体岗位指数口径：new 新增（4 周均值）| total 存量
  sectorMetric: 'new',           // 美国分行业口径，同上
  sort: { col: 'latest', dir: -1 },
  picked: new Map(),             // 分行业图中选中的项 → 颜色
};
const ALL = '__ALL__';           // “美国整体”在分行业列表中的键
const DEFAULT_PICKS = [ALL, 'Software Development', 'Data & Analytics', 'IT Systems & Solutions'];
const MAX_PICKS = 8;

const BASE_MONTH = '2023-01';    // “相对基期”视图以该月均值为 1
const WEEKS_3M = 13, WEEKS_1Y = 52;   // JSON 为周度抽样
const arrow = d => d > 0 ? '▲' : d < 0 ? '▼' : '—';
const METRIC_NAME = { new: '新增岗位（4 周均值）', total: '存量岗位' };

const codes = () => Object.keys(D.countries);
const label = code => D.countries[code];

/** 新增岗位噪声大，取过去 4 个周度点的均值；存量不处理。前 3 个点不足 4 周，留空 */
function smooth(arr, metric) {
  if (metric !== 'new') return arr;
  return arr.map((_, i) => {
    if (i < 3) return null;
    const w = arr.slice(i - 3, i + 1);
    return w.some(v => v == null) ? null : w.reduce((a, b) => a + b, 0) / 4;
  });
}

/** 某月均值（用于相对基期） */
function baseOf(block, code) {
  const vals = block.dates.map((d, i) => d.startsWith(BASE_MONTH) ? block.series[code][i] : null).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function xRange(dates) {
  return indicesFrom(dates, rangeStart(dates.at(-1), state.range));
}

/** 在任一国家图上点选图例，两张国家图同步显示 / 隐藏 */
function bindLegendSync(chart) {
  if (chart.__jobsBound) return;
  chart.__jobsBound = true;
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

// ── 汇总表（AI 占比）────────────────────────────
function renderSummary() {
  const A = D.ai_share, P = D.postings;
  const aL = A.dates.length - 1, pL = P.dates.length - 1;
  const diff = (s, back) => (s[aL] != null && s[aL - back] != null) ? s[aL] - s[aL - back] : null;
  const chgCell = d => d == null ? `<td>${DASH}</td>` : `<td>${arrow(d)} ${Math.abs(d).toFixed(1)}</td>`;

  const rows = codes().map(code => {
    const s = A.series[code], b = baseOf(A, code);
    return { code, latest: s[aL], d3: diff(s, WEEKS_3M), d12: diff(s, WEEKS_1Y), rel: b ? s[aL] / b : null, idx: P.total[code][pL] };
  }).sort((x, y) => y.latest - x.latest);

  document.getElementById('jobs-summary').innerHTML =
    `<thead><tr><th>国家</th><th>AI 岗位占比</th><th>3 个月变化（百分点）</th><th>1 年变化（百分点）</th>` +
    `<th>相对 2023 年 1 月</th><th>整体岗位指数（存量）</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${esc(label(r.code))}</td><td>${r.latest.toFixed(2)}%</td>${chgCell(r.d3)}${chgCell(r.d12)}` +
      `<td>${r.rel == null ? DASH : r.rel.toFixed(1) + '×'}</td><td>${r.idx == null ? DASH : r.idx.toFixed(1)}</td></tr>`).join('') + '</tbody>';
  document.getElementById('jobs-summary-sub').textContent =
    `AI 岗位占比截至 ${A.dates[aL]}，整体岗位指数截至 ${P.dates[pL]}；3 个月、1 年变化分别对比 13 周、52 周前；按 AI 岗位占比从高到低排序`;
}

// ── 图 1：AI 岗位占比 ─────────────────────────
function renderAI() {
  const A = D.ai_share, rel = state.view === 'rel';
  const idx = xRange(A.dates);
  const names = [], raw = {}, series = [];
  codes().forEach(code => {
    const name = label(code), b = baseOf(A, code);
    names.push(name);
    raw[name] = idx.map(i => A.series[code][i]);
    const data = idx.map(i => {
      const v = A.series[code][i];
      return v == null ? null : rel ? (b ? +(v / b).toFixed(3) : null) : v;
    });
    series.push(lineSeries(name, COUNTRY_COLORS[code], data, { bold: code === 'US' }));
  });
  const base = lineBase(idx.map(i => A.dates[i]), { xFmt: v => v.slice(0, 7), legendData: names, grid: { left: 56 } });
  const chart = chartIn('chart-jobs-ai');
  chart.setOption({
    ...base,
    legend: { ...base.legend, selected: Object.fromEntries(names.map(n => [n, !state.hidden.has(n)])) },
    tooltip: axisTooltip((v, p) => {
      const r = raw[p.seriesName][p.dataIndex];
      return rel
        ? `${v.toFixed(2)}×<span style="font-weight:400;color:#52514e"> · 占比 ${r.toFixed(2)}%</span>`
        : `${v.toFixed(2)}%`;
    }, { header: v => `${v}（7 日移动平均）` }),
    yAxis: yAxis({ axisLabel: { formatter: v => rel ? v + '×' : v + '%' } }),
    series,
  }, true);
  document.getElementById('jobs-ai-sub').textContent = rel
    ? `相对 2023 年 1 月均值的倍数（该月 = 1），反映各国自身的变化幅度`
    : `含 AI 关键词的岗位占该国全部岗位的百分比，7 日移动平均；各国水平不宜直接比较`;
  bindLegendSync(chart);
}

// ── 图 2：各国整体岗位指数 ───────────────────────
function renderCountries() {
  const P = D.postings, metric = state.countryMetric, idx = xRange(P.dates);
  const names = [], series = [];
  codes().forEach((code, k) => {
    const name = label(code), data = smooth(P[metric][code], metric);
    names.push(name);
    series.push(lineSeries(name, COUNTRY_COLORS[code], idx.map(i => data[i]), {
      bold: code === 'US',
      extra: k === 0 ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: MUTED, type: 'dashed' }, data: [{ yAxis: 100 }] } } : {},
    }));
  });
  const base = lineBase(idx.map(i => P.dates[i]), { xFmt: v => v.slice(0, 7), legendData: names, grid: { left: 56 } });
  const chart = chartIn('chart-jobs-countries');
  chart.setOption({
    ...base,
    legend: { ...base.legend, selected: Object.fromEntries(names.map(n => [n, !state.hidden.has(n)])) },
    tooltip: axisTooltip(v => v.toFixed(1), { header: v => `${v}（${METRIC_NAME[metric]}）` }),
    yAxis: yAxis({ scale: true }),
    series,
  }, true);
  document.getElementById('jobs-country-sub').textContent = metric === 'new'
    ? '挂网 7 天以内的新增岗位，季调指数（2020-02-01 = 100），取过去 4 周均值以平滑波动；虚线为 100'
    : '在线岗位存量，季调指数（2020-02-01 = 100），7 日移动平均；虚线为 100';
  bindLegendSync(chart);
}

// ── 图 3：美国分行业景气度 ───────────────────────
/** 分行业列表（含“美国整体”），按当前口径取平滑后的序列并算出排行指标 */
function sectorItems() {
  const S = D.sectors, m = state.sectorMetric;
  const items = [{ key: ALL, label: '美国整体', raw: D.postings[m].US }];
  Object.keys(S[m]).forEach(key => items.push({ key, label: S.labels[key], raw: S[m][key] }));
  const L = S.dates.length - 1;
  const ratio = (s, back) => (s[L] != null && s[L - back] ? s[L] / s[L - back] - 1 : null);
  items.forEach(it => {
    it.s = smooth(it.raw, m);
    const peak = Math.max(...it.s.filter(v => v != null));
    it.latest = it.s[L];
    it.c3 = ratio(it.s, WEEKS_3M);
    it.c12 = ratio(it.s, WEEKS_1Y);
    it.dd = it.latest != null && peak ? it.latest / peak - 1 : null;
  });
  return items;
}

const pctCell = v => v == null ? `<td>${DASH}</td>` : `<td>${arrow(v)} ${Math.abs(v * 100).toFixed(1)}%</td>`;

function renderRank() {
  const items = sectorItems();
  const { col, dir } = state.sort;
  items.sort((a, b) => {
    if (col === 'label') return dir * a.label.localeCompare(b.label, 'zh');
    const x = a[col], y = b[col];
    if (x == null && y == null) return 0;
    if (x == null) return 1;      // 空值始终排最后
    if (y == null) return -1;
    return dir * (x - y);
  });
  const th = (c, text) => `<th class="sortable${col === c ? ` sorted${dir > 0 ? ' asc' : ''}` : ''}" data-col="${c}">${text}</th>`;
  document.getElementById('jobs-rank').innerHTML =
    `<thead><tr>${th('label', '岗位类别')}${th('latest', '最新指数')}${th('c3', '3 个月变化')}${th('c12', '1 年变化')}${th('dd', '较历史峰值')}</tr></thead><tbody>` +
    items.map(it => {
      const color = state.picked.get(it.key);
      return `<tr class="pickable${color ? ' picked' : ''}" data-key="${esc(it.key)}"><td><span class="pick-name">` +
        `<span class="dot${color ? '' : ' off'}"${color ? ` style="background:${color}"` : ''}></span>${esc(it.label)}</span></td>` +
        `<td>${it.latest == null ? DASH : it.latest.toFixed(1)}</td>${pctCell(it.c3)}${pctCell(it.c12)}` +
        `<td>${it.dd == null ? DASH : (it.dd * 100).toFixed(1) + '%'}</td></tr>`;
    }).join('') + '</tbody>';
  document.getElementById('jobs-rank-sub').textContent =
    `口径：${METRIC_NAME[state.sectorMetric]}，指数截至 ${D.sectors.dates.at(-1)}（2020-02-01 = 100）；点击表头排序，点击行加入或移出下方折线图`;
}

function renderSectorChart() {
  const S = D.sectors, idx = xRange(S.dates), m = state.sectorMetric;
  const byKey = new Map(sectorItems().map(it => [it.key, it]));
  const picked = [...state.picked.keys()].filter(k => byKey.has(k));
  const names = picked.map(k => byKey.get(k).label);
  const series = picked.map((k, i) => lineSeries(byKey.get(k).label, state.picked.get(k), idx.map(j => byKey.get(k).s[j]), {
    bold: k === ALL,
    extra: i === 0 ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: MUTED, type: 'dashed' }, data: [{ yAxis: 100 }] } } : {},
  }));
  const base = lineBase(idx.map(j => S.dates[j]), { xFmt: v => v.slice(0, 7), legendData: names, grid: { left: 56 } });
  chartIn('chart-jobs-sectors').setOption({
    ...base,
    tooltip: axisTooltip(v => v.toFixed(1), { header: v => `${v}（${METRIC_NAME[m]}）` }),
    yAxis: yAxis({ scale: true }),
    series,
  }, true);
}

function onRankClick(e) {
  const th = e.target.closest('th.sortable');
  if (th) {
    const col = th.dataset.col;
    state.sort = { col, dir: state.sort.col === col ? -state.sort.dir : (col === 'label' ? 1 : -1) };
    renderRank();
    return;
  }
  const tr = e.target.closest('tr.pickable');
  if (!tr) return;
  const key = tr.dataset.key, hint = document.getElementById('jobs-pick-hint');
  if (state.picked.has(key)) {
    state.picked.delete(key);
    hint.textContent = '';
  } else if (state.picked.size >= MAX_PICKS) {
    hint.textContent = `最多同时对比 ${MAX_PICKS} 项，请先取消已选的一项。`;
    return;
  } else {
    state.picked.set(key, pickColor(key));
    hint.textContent = '';
  }
  renderRank();
  renderSectorChart();
}

/** “美国整体”固定用 INK；其余取第一个未被占用的色 */
function pickColor(key) {
  if (key === ALL) return INK;
  const used = new Set(state.picked.values());
  return PICK_COLORS.find(c => !used.has(c)) ?? PICK_COLORS[0];
}

function renderAll() {
  if (!active || !D) return;
  renderSummary();
  renderAI();
  renderCountries();
  renderRank();
  renderSectorChart();
}

// ── CSV（周度抽样；国家级日度明细见仓库 data/indeed/）──────────
function download() {
  const rows = [['指标', '对象', '日期（7 日移动平均）', '数值']];
  codes().forEach(code => D.ai_share.dates.forEach((d, i) => {
    const v = D.ai_share.series[code][i];
    if (v != null) rows.push(['AI 岗位占比（%）', label(code), d, v]);
  }));
  const metrics = [['new', '新增岗位指数（原始值，未做 4 周平均）'], ['total', '存量岗位指数']];
  metrics.forEach(([m, name]) => {
    codes().forEach(code => D.postings.dates.forEach((d, i) => {
      const v = D.postings[m][code][i];
      if (v != null) rows.push([`整体${name}（2020-02-01=100，季调）`, label(code), d, v]);
    }));
    Object.keys(D.sectors[m]).forEach(key => D.sectors.dates.forEach((d, i) => {
      const v = D.sectors[m][key][i];
      if (v != null) rows.push([`美国分行业${name}（2020-02-01=100，季调）`, D.sectors.labels[key], d, v]);
    }));
  });
  downloadCSV(rows, 'indeed_ai_jobs.csv');
}

// ── 页面骨架 ─────────────────────────────────
const METRIC_SEG = id => segHtml([['new', '新增岗位（4 周均值）'], ['total', '存量岗位']], 'new', `id="${id}"`);

const TEMPLATE = `
  <div class="card">
    <div class="card-head" style="margin-bottom:0;align-items:center">
      <div class="card-intro" style="max-width:860px">
        <b>AI 招聘</b>：Indeed 上职位描述含 AI 相关关键词的岗位，占各国全部岗位的比例；
        并对照各国整体岗位指数，以及美国各类岗位的景气度，用来区分“AI 岗位占比上升”究竟来自 AI 需求增加，还是整体招聘本身在变化。
        招聘反映的是雇主的人才需求，是 AI 投入的间接信号，不等于 AI 的使用量或收入。
        数据来源：<a href="https://github.com/hiring-lab/ai-tracker" target="_blank" rel="noopener">Indeed Hiring Lab · AI Tracker</a>
        与 <a href="https://github.com/hiring-lab/job_postings_tracker" target="_blank" rel="noopener">Job Postings Tracker</a>
        （<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>），本页做了国家 / 行业筛选与周度抽样。
        <b>点击图例可隐藏或显示国家。</b>
      </div>
      <div class="filter-group">
        <span class="filter-label">时间范围</span>
        ${segHtml([['1Y', '1年'], ['3Y', '3年'], ['ALL', '全部']], '3Y', 'id="jobs-range"')}
        <button type="button" class="btn" id="jobs-dl">下载 CSV</button>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><div class="card-title">最新数据汇总</div><div class="card-sub" id="jobs-summary-sub"></div></div>
    </div>
    <div class="table-scroll"><table class="compact" id="jobs-summary"></table></div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><div class="card-title">含 AI 关键词的岗位占比</div><div class="card-sub" id="jobs-ai-sub"></div></div>
      <div class="filter-group"><span class="filter-label">视图</span>
        ${segHtml([['level', '占比（%）'], ['rel', '相对 2023 年 1 月']], 'level', 'id="jobs-view"')}</div>
    </div>
    <div id="chart-jobs-ai" class="chart"></div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><div class="card-title">各国整体岗位指数</div><div class="card-sub" id="jobs-country-sub"></div></div>
      <div class="filter-group"><span class="filter-label">口径</span>${METRIC_SEG('jobs-metric-c')}</div>
    </div>
    <div id="chart-jobs-countries" class="chart"></div>
  </div>

  <div class="card">
    <div class="card-head">
      <div><div class="card-title">美国分岗位景气度</div><div class="card-sub" id="jobs-rank-sub"></div></div>
      <div class="filter-group"><span class="filter-label">口径</span>${METRIC_SEG('jobs-metric-s')}</div>
    </div>
    <div class="table-scroll" style="max-height:420px"><table class="compact" id="jobs-rank"></table></div>
    <div class="pick-hint" id="jobs-pick-hint"></div>
    <div id="chart-jobs-sectors" class="chart"></div>
  </div>

  <div class="card notes">
    <h3>口径说明</h3>
    <ul>
      <li><b>AI 岗位占比</b>：职位描述含 AI 相关关键词的岗位 ÷ 该国全部在线岗位，7 日移动平均。数据源 README 给出的关键词示例为 Machine Learning、Data Science、Artificial Intelligence，完整词表未公开；其中含“Data Science”，所以占比包含传统数据岗位，更接近“AI 与数据类技能需求”，不等于 AI 应用需求。</li>
      <li><b>各国水平不宜直接比较</b>：同一时点加拿大、爱尔兰的占比明显高于美国和荷兰，数据源没有说明原因（可能与关键词覆盖、语言、岗位结构有关），比较各国请看“相对 2023 年 1 月”视图或各国自身的变化。该视图的基期是一个月的均值，基期本身的季节性波动会影响倍数。</li>
      <li><b>只有 AI 口径</b>：数据源 README 提到的生成式 AI（GenAI）岗位占比文件，在其仓库中尚未发布，本页没有该序列。AI 占比只到国家层，没有按岗位类别拆分，所以“分岗位景气度”反映的是各类岗位的整体招聘，不是其中的 AI 岗位。</li>
      <li><b>岗位指数</b>：Indeed 在线岗位量相对 2020-02-01 的变化（该日 = 100），季节调整（采用德国央行方法，2024 年 11 月起，历史数据已按新方法修订），7 日移动平均。各行业、各国都以自身 2020-02 为基期，指数只反映相对变化，不代表岗位数量的多少，也不是同一规模下的比较。</li>
      <li><b>新增 vs 存量</b>：存量是每天在 Indeed 上可见的全部岗位，平滑但滞后；招满的岗位可能仍挂在网上，Indeed 未公布下线规则。新增是挂网 7 天以内的岗位，更早反映招聘节奏，但波动大（每周变化约为存量的 4 到 5 倍），所以页面默认显示新增岗位的过去 4 周均值（4 个周度点的简单平均，前 3 周无值），存量不做处理。小行业的新增岗位指数波动尤其大，读单个行业时请看趋势。</li>
      <li><b>分岗位排行</b>：“3 个月变化”“1 年变化”是该指数与 13 周、52 周前相比的涨跌幅，“较历史峰值”是最新值相对 2020 年以来峰值的差距，均基于所选口径（新增为 4 周均值）。岗位类别是 Indeed 按标准化职位名称归类，共 47 类。折线图最多同时对比 8 项，颜色在选中期间保持不变，取消后释放，因此同一行业在不同时刻颜色可能不同。</li>
      <li><b>数据频率</b>：数据源为日度，AI 占比通常每月刷新一次，整体岗位指数每周刷新，所以两者的截至日期不同（见汇总表）。本页的图表每 7 天取一个点（源数据是 7 日移动平均，抽样不改变趋势）。国家级日度明细见仓库 <code>data/indeed/</code>，分行业只保存周度数据，日度数据以 Indeed 源仓库为准。</li>
      <li><b>样本是 Indeed 平台上的岗位</b>：不含未在 Indeed 发布的招聘；岗位数不等于空缺数，同一岗位可能多处发布，一个岗位也可能对应多个名额。</li>
    </ul>
  </div>`;

export default {
  async mount(root) {
    D = await fetchJSON('indeed.json', { optional: true });
    if (!D) {
      root.innerHTML = '<div class="card"><div class="state">Indeed 招聘数据尚未采集。<br>GitHub Actions 每周自动运行后将在此显示。</div></div>';
      return;
    }
    DEFAULT_PICKS.filter(k => k === ALL || k in D.sectors.total).forEach(k => state.picked.set(k, pickColor(k)));
    root.innerHTML = TEMPLATE;
    bindSeg(document.getElementById('jobs-range'), v => { state.range = v; renderAll(); });
    bindSeg(document.getElementById('jobs-view'), v => { state.view = v; renderAll(); });
    bindSeg(document.getElementById('jobs-metric-c'), v => { state.countryMetric = v; renderCountries(); });
    bindSeg(document.getElementById('jobs-metric-s'), v => { state.sectorMetric = v; renderRank(); renderSectorChart(); });
    document.getElementById('jobs-rank').addEventListener('click', onRankClick);
    document.getElementById('jobs-dl').addEventListener('click', download);
  },
  activate() { active = true; renderAll(); },
  deactivate() { active = false; },
  metaText: () => (D ? `招聘数据更新：${D.last_updated}　·　AI 占比截至 ${D.ai_share.dates.at(-1)}，岗位指数截至 ${D.postings.dates.at(-1)}` : ''),
};
