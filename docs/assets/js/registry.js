/**
 * 页面注册表：一级分类 → 二级页面
 * 新增数据源：在 modules/ 下新建一个模块文件，再在这里加一条 page 即可
 *
 * 模块约定（default export）：
 *   mount(root)    首次进入时调用，负责取数并渲染 DOM（可 async）
 *   activate()     每次切到该页时调用（此时容器可见，适合绘图）
 *   deactivate()   离开该页时调用（可选）
 *   metaText()     返回右上角显示的数据更新时间（可选）
 */
export const CATEGORIES = [
  {
    id: 'games', label: '游戏',
    pages: [
      { id: 'players',  label: 'Steam 在线人数', load: () => import('./modules/steam-players.js') },
      { id: 'rankings', label: 'Steam 畅销榜',   load: () => import('./modules/steam-rankings.js') },
    ],
  },
  {
    id: 'ai', label: 'AI',
    pages: [
      { id: 'ramp', label: 'Ramp AI 指数', load: () => import('./modules/ramp.js') },
    ],
  },
];

/** 旧版地址（#players 等）兼容 */
export const LEGACY_HASH = {
  players: 'games/players',
  rankings: 'games/rankings',
  ramp: 'ai/ramp',
};
