/** AI / AI 招聘：Indeed 各国“含 AI 关键词的岗位占比”，对照整体岗位指数与美国技术类岗位指数 */
import { chartIn, lineBase, lineSeries, axisTooltip, yAxis } from '../core/charts.js';
import { COUNTRY_COLORS, SECTOR_COLORS, MUTED } from '../core/colors.js';
import { DASH, esc } from '../core/format.js';
import { rangeStart, indicesFrom } from '../core/range.js';
import { bindSeg, segHtml, downloadCSV, fetchJSON } from '../core/ui.js';

let D = null;
let active = false;
const state = { range: '3Y', view: 'level', hidden: new Set() };   // 点击图例可隐藏国家，两张国家图同步

const BASE_MONTH = '2023-01';   // “相对基期”视图以该月均值为 1
const WEEKS_3M = 13, WEEKS_1Y = 52;   // JSON 为周度抽样
const arrow = d => d > 0 ? '▲' : d < 0 ? '▼' : '—';

const codes = () => Object.keys(D.countries);
const label = code => D.countries[code];

/** 某月均值（用于相对基期） */
function baseOf(block, code) {
  const vals = block.dates.map((d, i) => d.startsWith(BASE_MONTH) ? block.series[code][i] : null).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// ── 汇总表 ───────────────────────────────────
function renderSummary() {
  const A = D.ai_share, P = D.postings;
  const aL = A.dates.length - 1, pL = P.dates.length - 1;
  const diff = (s, back) => (s[aL] != null && s[aL - back] != null) ? s[aL] - s[aL - back] : null;
  const chgCell = d => d == null ? `<td>${DASH}</td>` : `<td>${arrow(d)} ${Math.abs(d).toFixed(1)}</td>`;

  const rows = codes().map(code => {
    const s = A.series[code], b = baseOf(A, code);
    return { code, latest: s[aL], d3: diff(s, WEEKS_3M), d12: diff(s, WEEKS_1Y), rel: b ? s[aL] / b : null, idx: P.series[code][pL] };
  }).sort((x, y) => y.latest - x.latest);

  document.getElementById('jobs-summary').innerHTML =
    `<thead><tr><th>国家</th><th>AI 岗位占比</th><th>3 个月变化（百分点）</th><th>1 年变化（百分点）</th>` +
    `<th>相对 2023 年 1 月</th><th>整体岗位指数</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${esc(label(r.code))}</td><td>${r.latest.toFixed(2)}%</td>${chgCell(r.d3)}${chgCell(r.d12)}` +
      `<td>${r.rel == null ? DASH : r.rel.toFixed(1) + '×'}</td><td>${r.idx == null ? DASH : r.idx.toFixed(1)}</td></tr>`).join('') + '</tbody>';
  document.getElementById('jobs-summary-sub').textContent =
    `AI 岗位占比截至 ${A.dates[aL]}，整体岗位指数截至 ${P.dates[pL]}；3 个月、1 年变化分别对比 13 周、52 周前；按 AI 岗位占比从高到低排序`;
}

// ── 图表 ─────────────────────────────────────
function xRange(dates) {
  return indicesFrom(dates, rangeStart(dates.at(-1), state.range));
}

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

function renderPostings() {
  const P = D.postings, idx = xRange(P.dates);
  const names = [], series = [];
  codes().forEach((code, k) => {
    const name = label(code);
    names.push(name);
    series.push(lineSeries(name, COUNTRY_COLORS[code], idx.map(i => P.series[code][i]), {
      bold: code === 'US',
      extra: k === 0 ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: MUTED, type: 'dashed' }, data: [{ yAxis: 100 }] } } : {},
    }));
  });
  const base = lineBase(idx.map(i => P.dates[i]), { xFmt: v => v.slice(0, 7), legendData: names, grid: { left: 56 } });
  const chart = chartIn('chart-jobs-postings');
  chart.setOption({
    ...base,
    legend: { ...base.legend, selected: Object.fromEntries(names.map(n => [n, !state.hidden.has(n)])) },
    tooltip: axisTooltip(v => v.toFixed(1), { header: v => `${v}（7 日移动平均）` }),
    yAxis: yAxis({ scale: true }),
    series,
  }, true);
  bindLegendSync(chart);
}

function renderSectors() {
  const S = D.sectors, P = D.postings, idx = xRange(S.dates);
  const overall = new Map(P.dates.map((d, i) => [d, P.series.US[i]]));
  const names = [], series = [];
  Object.keys(S.series).forEach(key => {
    names.push(S.labels[key]);
    series.push(lineSeries(S.labels[key], SECTOR_COLORS[key], idx.map(i => S.series[key][i])));
  });
  names.push('美国整体');
  series.push(lineSeries('美国整体', SECTOR_COLORS.overall, idx.map(i => overall.get(S.dates[i]) ?? null), { bold: true }));
  const base = lineBase(idx.map(i => S.dates[i]), { xFmt: v => v.slice(0, 7), legendData: names, grid: { left: 56 } });
  chartIn('chart-jobs-sectors').setOption({
    ...base,
    tooltip: axisTooltip(v => v.toFixed(1), { header: v => `${v}（7 日移动平均）` }),
    yAxis: yAxis({ scale: true }),
    series,
  }, true);
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

function renderAll() {
  if (!active || !D) return;
  renderSummary();
  renderAI();
  renderPostings();
  renderSectors();
}

// ── CSV（周度抽样；日度明细见仓库 data/indeed/）──────────
function download() {
  const rows = [['指标', '对象', '日期（7 日移动平均）', '数值']];
  codes().forEach(code => D.ai_share.dates.forEach((d, i) => {
    const v = D.ai_share.series[code][i];
    if (v != null) rows.push(['AI 岗位占比（%）', label(code), d, v]);
  }));
  codes().forEach(code => D.postings.dates.forEach((d, i) => {
    const v = D.postings.series[code][i];
    if (v != null) rows.push(['整体岗位指数（2020-02-01=100，季调）', label(code), d, v]);
  }));
  Object.keys(D.sectors.series).forEach(key => D.sectors.dates.forEach((d, i) => {
    const v = D.sectors.series[key][i];
    if (v != null) rows.push(['美国分行业岗位指数（2020-02-01=100，季调）', D.sectors.labels[key], d, v]);
  }));
  downloadCSV(rows, 'indeed_ai_jobs.csv');
}

// ── 页面骨架 ─────────────────────────────────
const TEMPLATE = `
  <div class="card">
    <div class="card-head" style="margin-bottom:0;align-items:center">
      <div class="card-intro" style="max-width:860px">
        <b>AI 招聘</b>：Indeed 上职位描述含 AI 相关关键词的岗位，占各国全部岗位的比例；
        并对照各国整体岗位指数和美国技术类岗位指数，用来区分“AI 岗位占比上升”究竟来自 AI 需求增加，还是整体招聘本身在变化。
        招聘反映的是雇主的人才需求，是 AI 投入的间接信号，不等于 AI 的使用量或收入。
        数据来源：<a href="https://github.com/hiring-lab/ai-tracker" target="_blank" rel="noopener">Indeed Hiring Lab · AI Tracker</a>
        与 <a href="https://github.com/hiring-lab/job_postings_tracker" target="_blank" rel="noopener">Job Postings Tracker</a>
        （<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>），本页做了国家 / 行业筛选与周度抽样。
        <b>点击图例可隐藏或显示国家。</b>
      </div>
      <div class="filter-group">
        <span class="filter-label">时间范围</span>
        ${segHtml([['1Y', '1年'], ['3Y', '3年'], ['ALL', '全部']], '3Y', 'id="jobs-range"')}
        <span class="filter-label">AI 占比视图</span>
        ${segHtml([['level', '占比（%）'], ['rel', '相对 2023 年 1 月']], 'level', 'id="jobs-view"')}
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
    </div>
    <div id="chart-jobs-ai" class="chart"></div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">整体岗位指数</div>
          <div class="card-sub">相对 2020-02-01 的季调变化（该日 = 100），7 日移动平均；虚线为 100</div></div>
      </div>
      <div id="chart-jobs-postings" class="chart md"></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">美国技术类岗位指数</div>
          <div class="card-sub">软件开发、数据与分析、IT 系统与解决方案，对照美国整体；2020-02-01 = 100，季调</div></div>
      </div>
      <div id="chart-jobs-sectors" class="chart md"></div>
    </div>
  </div>

  <div class="card notes">
    <h3>口径说明</h3>
    <ul>
      <li><b>AI 岗位占比</b>：职位描述含 AI 相关关键词的岗位 ÷ 该国全部在线岗位，7 日移动平均。数据源 README 给出的关键词示例为 Machine Learning、Data Science、Artificial Intelligence，完整词表未公开；其中含“Data Science”，所以占比包含传统数据岗位，更接近“AI 与数据类技能需求”，不等于 AI 应用需求。</li>
      <li><b>各国水平不宜直接比较</b>：同一时点加拿大、爱尔兰的占比明显高于美国和荷兰，数据源没有说明原因（可能与关键词覆盖、语言、岗位结构有关），比较各国请看“相对 2023 年 1 月”视图或各国自身的变化。该视图的基期是一个月的均值，基期本身的季节性波动会影响倍数。</li>
      <li><b>只有 AI 口径</b>：数据源 README 提到的生成式 AI（GenAI）岗位占比文件，在其仓库中尚未发布，本页没有该序列。</li>
      <li><b>整体岗位指数</b>：Indeed 在线岗位量相对 2020-02-01 的变化，季节调整（采用德国央行方法，2024 年 11 月起，历史数据已按新方法修订），7 日移动平均；100 以上表示高于疫情前基线。各国基线相同，但不同国家的指数水平反映各自的招聘周期，不是同一口径下的规模对比。</li>
      <li><b>美国分行业</b>：Indeed 按标准化职位名称归类，反映该类岗位的总量，不是其中 AI 岗位的数量。本页只选了三个技术类行业，其余 44 个行业未展示。</li>
      <li><b>数据频率</b>：数据源为日度，AI 占比通常每月刷新一次，整体岗位指数每周刷新，所以两者的截至日期不同（见汇总表）。本页的图表每 7 天取一个点（源数据是 7 日移动平均，抽样不改变趋势），完整日度数据见仓库 <code>data/indeed/</code>。</li>
      <li><b>样本是 Indeed 平台上的岗位</b>：不含未在 Indeed 发布的招聘。</li>
    </ul>
  </div>`;

export default {
  async mount(root) {
    D = await fetchJSON('indeed.json', { optional: true });
    if (!D) {
      root.innerHTML = '<div class="card"><div class="state">Indeed 招聘数据尚未采集。<br>GitHub Actions 每周自动运行后将在此显示。</div></div>';
      return;
    }
    root.innerHTML = TEMPLATE;
    bindSeg(document.getElementById('jobs-range'), v => { state.range = v; renderAll(); });
    bindSeg(document.getElementById('jobs-view'), v => { state.view = v; renderAll(); });
    document.getElementById('jobs-dl').addEventListener('click', download);
  },
  activate() { active = true; renderAll(); },
  deactivate() { active = false; },
  metaText: () => (D ? `招聘数据更新：${D.last_updated}　·　AI 占比截至 ${D.ai_share.dates.at(-1)}，岗位指数截至 ${D.postings.dates.at(-1)}` : ''),
};
