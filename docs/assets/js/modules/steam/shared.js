/**
 * Steam 两个页面（在线人数、畅销榜）共用：数据加载、筛选状态、筛选器 UI
 * 筛选状态在两个页面间同步（切换页面不会丢失已选游戏与时间范围）
 */
import { fetchJSON, bindSeg, segHtml } from '../../core/ui.js';
import { colorByIndex } from '../../core/colors.js';
import { esc } from '../../core/format.js';

let dataPromise = null;

/** 一次性加载 games.json（必需）与 rankings.json（可选） */
export function loadSteam() {
  if (!dataPromise) {
    dataPromise = Promise.all([fetchJSON('games.json'), fetchJSON('rankings.json', { optional: true })])
      .then(([players, rankings]) => {
        players.games.forEach(g => state.selected.add(g));
        return { players, rankings };
      })
      .catch(e => { dataPromise = null; throw e; });
  }
  return dataPromise;
}

// ── 共享筛选状态 ─────────────────────────────

const state = { range: '6M', selected: new Set() };
const listeners = new Set();
export const steamState = state;

export function subscribe(fn) { listeners.add(fn); }
function emit() { listeners.forEach(fn => fn()); }

export function setRange(range) { state.range = range; emit(); }
export function setSelected(names, on) {
  names.forEach(n => (on ? state.selected.add(n) : state.selected.delete(n)));
  emit();
}

export const activeGames = games => games.filter(g => state.selected.has(g));
export const gameColor = (games, name) => colorByIndex(games.indexOf(name));

const RANGES = [['1M', '1个月'], ['3M', '3个月'], ['6M', '6个月'], ['1Y', '1年'], ['ALL', '全部']];

/** 在 el 内渲染筛选器；所有实例与共享状态保持同步 */
export function mountFilters(el, games) {
  el.innerHTML = `
    <div class="filter-group">
      <span class="filter-label">时间范围</span>
      ${segHtml(RANGES, state.range)}
    </div>
    <div class="filter-group top">
      <span class="filter-label" style="margin-top:2px">游戏</span>
      <div>
        <button type="button" class="btn" data-act="all">全选 / 取消</button>
        <div class="checks">
          ${games.map(g => `
            <label class="check">
              <input type="checkbox" value="${esc(g)}" />
              <span class="dot" style="background:${gameColor(games, g)}"></span>${esc(g)}
            </label>`).join('')}
        </div>
      </div>
    </div>`;

  const checks = [...el.querySelectorAll('input[type=checkbox]')];
  const setSeg = bindSeg(el.querySelector('.seg'), setRange);
  checks.forEach(cb => cb.addEventListener('change', () => setSelected([cb.value], cb.checked)));
  el.querySelector('[data-act=all]').addEventListener('click', () => {
    setSelected(games, !checks.every(c => c.checked));
  });

  const sync = () => {
    setSeg(state.range);
    checks.forEach(c => { c.checked = state.selected.has(c.value); });
  };
  sync();
  subscribe(sync);
}
