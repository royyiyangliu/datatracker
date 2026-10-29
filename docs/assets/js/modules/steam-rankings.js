/** 游戏 / Steam 畅销榜：全球畅销榜周度排名（Top 100） */
import { chartIn, lineBase, lineSeries, axisTooltip, yAxis, END_LABEL_MAX } from '../core/charts.js';
import { DASH, fmtWeekCN, steamWeekTuesday } from '../core/format.js';
import { rangeStart, indicesFrom } from '../core/range.js';
import { downloadCSV } from '../core/ui.js';
import { loadSteam, steamState, activeGames, gameColor, mountFilters, subscribe } from './steam/shared.js';

let G = null;   // games.json（游戏列表与顺序）
let R = null;   // rankings.json
let active = false;

function indices() {
  const start = rangeStart(R.weeks.at(-1), steamState.range);
  return indicesFrom(R.weeks, start);
}

function fmtRank(n) {
  if (n == null) return DASH;
  const cls = n <= 3 ? 'rank-top3' : n <= 10 ? 'rank-top10' : n > 50 ? 'rank-low' : '';
  return `<span class="${cls}">#${n}</span>`;
}

function renderChart() {
  const idx = indices();
  const games = activeGames(G.games);
  const endLabel = games.length <= END_LABEL_MAX;
  chartIn('chart-rankings').setOption({
    ...lineBase(idx.map(i => R.weeks[i]), {
      xFmt: v => v.slice(0, 7), legendData: games,
      grid: { left: 56, right: endLabel ? 120 : 24 },
    }),
    tooltip: axisTooltip(v => `#${v}`, { header: fmtWeekCN, sort: 'asc' }),   // 排名靠前的在上
    yAxis: yAxis({ inverse: true, min: 1, max: 100, axisLabel: { formatter: v => `#${v}` } }),
    series: games.map(g => lineSeries(g, gameColor(G.games, g), idx.map(i => (R.data[g] || [])[i] ?? null), { endLabel })),
  }, true);
}

function renderTable() {
  const games = activeGames(G.games);
  const idx = indices().reverse();   // 最新周在上
  document.getElementById('rankings-thead').innerHTML =
    '<tr><th>周次</th>' + games.map(g => `<th>${g}</th>`).join('') + '</tr>';
  document.getElementById('rankings-tbody').innerHTML = idx.map(i =>
    `<tr><td>${fmtWeekCN(R.weeks[i])}</td>${games.map(g => `<td>${fmtRank((R.data[g] || [])[i])}</td>`).join('')}</tr>`).join('');
  document.getElementById('rankings-table-title').textContent = `排名记录（${idx.length} 周）`;
}

function render() {
  if (!active || !R) return;
  renderChart();
  renderTable();
}

export default {
  async mount(root) {
    const { players, rankings } = await loadSteam();
    G = players;
    if (!rankings?.weeks?.length) {
      root.innerHTML = '<div class="card"><div class="state">排名数据尚未采集。<br>GitHub Actions 每周三自动运行后将在此显示。</div></div>';
      return;
    }
    R = rankings;
    root.innerHTML = `
      <div class="card filters" id="rankings-filters"></div>
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Steam 全球畅销榜排名</div>
            <div class="card-sub">每周更新（周二），仅统计 Top 100，榜外显示为空缺；排名第 1 在最上方</div>
          </div>
        </div>
        <div id="chart-rankings" class="chart"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div class="card-title" id="rankings-table-title"></div>
          <div class="card-tools"><button type="button" class="btn" id="rankings-dl">下载 CSV</button></div>
        </div>
        <div class="table-scroll"><table><thead id="rankings-thead"></thead><tbody id="rankings-tbody"></tbody></table></div>
      </div>`;
    mountFilters(document.getElementById('rankings-filters'), G.games);
    document.getElementById('rankings-dl').addEventListener('click', () => {
      downloadCSV([['Date', ...G.games],
        ...R.weeks.map((w, i) => [steamWeekTuesday(w), ...G.games.map(g => R.data[g]?.[i])])], 'steam_rankings.csv');
    });
    subscribe(render);
  },
  activate() { active = true; render(); },
  deactivate() { active = false; },
  metaText: () => (R?.last_updated ? `排名更新：${R.last_updated}　·　最新一周 ${steamWeekTuesday(R.weeks.at(-1))}` : ''),
};
