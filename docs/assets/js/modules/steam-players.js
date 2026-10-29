/** 游戏 / Steam 在线人数：每日峰值同时在线人数 */
import { chartIn, lineBase, lineSeries, axisTooltip, yAxis, END_LABEL_MAX } from '../core/charts.js';
import { fmtInt, fmtAxisCN } from '../core/format.js';
import { rangeStart, indicesFrom } from '../core/range.js';
import { downloadCSV } from '../core/ui.js';
import { loadSteam, steamState, activeGames, gameColor, mountFilters, subscribe } from './steam/shared.js';

let G = null;
let active = false;

function indices() {
  const start = rangeStart(G.dates.at(-1), steamState.range);
  return indicesFrom(G.dates, start);
}

function renderChart() {
  const idx = indices();
  const games = activeGames(G.games);
  const endLabel = games.length <= END_LABEL_MAX;
  chartIn('chart-players').setOption({
    ...lineBase(idx.map(i => G.dates[i]), {
      xFmt: v => v.slice(0, 7), legendData: games,
      grid: { left: 72, right: endLabel ? 120 : 24 },
    }),
    tooltip: axisTooltip(v => v.toLocaleString('en-US'), { header: v => v }),
    yAxis: yAxis({ axisLabel: { formatter: fmtAxisCN } }),
    series: games.map(g => lineSeries(g, gameColor(G.games, g), idx.map(i => G.data[g][i]), { endLabel })),
  }, true);
}

function renderTable() {
  const games = activeGames(G.games);
  const idx = indices().reverse();
  document.getElementById('players-thead').innerHTML =
    '<tr><th>日期</th>' + games.map(g => `<th>${g}</th>`).join('') + '</tr>';
  document.getElementById('players-tbody').innerHTML = idx.map(i =>
    `<tr><td>${G.dates[i]}</td>${games.map(g => `<td>${fmtInt(G.data[g][i])}</td>`).join('')}</tr>`).join('');
  document.getElementById('players-table-title').textContent = `数据明细（${idx.length} 天）`;
}

function render() {
  if (!active) return;
  renderChart();
  renderTable();
}

export default {
  async mount(root) {
    const { players } = await loadSteam();
    G = players;
    root.innerHTML = `
      <div class="card filters" id="players-filters"></div>
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">每日峰值同时在线人数</div>
            <div class="card-sub">数据来源：steamcharts.com · 取小时级数据的单日最大值（UTC 日）</div>
          </div>
        </div>
        <div id="chart-players" class="chart"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div class="card-title" id="players-table-title"></div>
          <div class="card-tools"><button type="button" class="btn" id="players-dl">下载 CSV</button></div>
        </div>
        <div class="table-scroll"><table><thead id="players-thead"></thead><tbody id="players-tbody"></tbody></table></div>
      </div>`;
    mountFilters(document.getElementById('players-filters'), G.games);
    document.getElementById('players-dl').addEventListener('click', () => {
      downloadCSV([['Date', ...G.games], ...G.dates.map((d, i) => [d, ...G.games.map(g => G.data[g][i])])], 'steam_players.csv');
    });
    subscribe(render);
  },
  activate() { active = true; render(); },
  deactivate() { active = false; },
  metaText: () => (G ? `在线人数更新：${G.last_updated}　·　数据截至 ${G.dates.at(-1)}` : ''),
};
