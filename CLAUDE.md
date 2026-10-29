# datatracker

公开数据追踪看板：用 GitHub Actions 定时抓取公开数据源，存成 CSV / JSON，由纯静态前端（ECharts）展示。无后端、无构建步骤。目标是持续接入更多公开数据，整合成一个页面。

## 目录结构

```
games_config.json      跟踪的游戏列表（名称 + appid）；新增游戏只能追加到末尾
scripts/               抓取脚本（从项目根目录运行）
data/                  原始数据 CSV（history.csv；ramp/*.csv；gpu/*.csv）
docs/                  静态站点根目录（供 GitHub Pages 发布）
  index.html           页面外壳（只含导航容器）
  *.json               前端读取的数据：games.json、rankings.json、ramp.json、gpu.json
  assets/css/          theme.css（设计变量）、components.css（组件样式）
  assets/js/main.js    两级导航 + 按需加载页面模块（hash 路由 #分类/页面）
  assets/js/registry.js  分类 → 页面注册表（新增页面在此注册）
  assets/js/core/      colors（唯一配色来源）、charts（统一图表基础层）、format、range、ui
  assets/js/modules/   每个页面一个模块；steam/shared.js 为 Steam 两页共用
.github/workflows/     四个定时工作流
```

## 数据源与抓取流程

| 页面 | 来源 | 脚本 | 工作流（UTC） | 写入 |
|---|---|---|---|---|
| 游戏 / Steam 在线人数 | steamcharts.com 的 chart-data.json | `update.py` | 每日 15:00 | `data/history.csv`、`docs/games.json` |
| 游戏 / Steam 畅销榜 | store.steampowered.com 全球畅销榜（Playwright 渲染） | `fetch_rankings.py` | 每周三 12:00 | `docs/rankings.json` |
| AI / Ramp AI 指数 | ramp.com/data/ai-index（页面内嵌数据 + chart-data 接口） | `fetch_ramp.py` | 每周一、四 16:30 | `data/ramp/*.csv`、`docs/ramp.json` |
| AI / GPU 租赁价格 | getdeploying.com 公开周度数据集 weekly.csv（CC BY 4.0） | `fetch_gpu_prices.py` | 每周二、五 03:00 | `data/gpu/getdeploying_weekly.csv`、`docs/gpu.json` |

- 流程统一：脚本抓取 → 校验 → 写文件 → 工作流有变更才 commit 并 push 到 main（提交信息以 `data:` 开头）。所有工作流都支持手动触发。
- 在线人数：取小时级数据的单日最大值（UTC 日），只追加今天之前的完整日期，增量写入 CSV。
- 畅销榜：周标识用周一日期（实际榜单日为周二），优先拦截页面 JSON 接口，失败降级为解析页面元素；保存 Top 100 快照。`backfill_rankings.py` 用于一次性回填历史周榜。
- Ramp：每次全量覆盖；任一数据源解析或校验失败则退出码 1 且不写任何文件；数据无变化时不写，`last_updated` 表示数据最近一次变化时间。
- GPU 价格：源文件含全部历史，每次全量覆盖；只保留 H100 / A100 / B200 / B300 / GB200，前端展示按需、Spot、预留 1 / 12 / 36 个月的周度中位价（Spot 默认隐藏）。价格是各供应商公开标价，不是成交价；供应商少于 5 家的数值标“样本少”。使用须署名 GetDeploying 并链接 CC BY 4.0（页面介绍中已写，改版时保留）。
- `daily-update` 与 `weekly-rankings` 工作流 push 前没有 `git pull --rebase`，只有 Ramp 工作流有；不要让它们的触发时间重叠。

## 前端约定

- 页面模块（`default export`）：`mount(root)` 首次进入时取数并渲染，`activate()` 每次切到该页时绘图，`deactivate()` 可选，`metaText()` 返回右上角更新时间。
- 新增数据源：写抓取脚本和工作流 → 在 `modules/` 新建模块 → 在 `registry.js` 注册；新分类在 `CATEGORIES` 加一项。
- 颜色只从 `core/colors.js` 取：11 色分类色盘已校验色盲区分，颜色跟随实体（游戏按其在 `games_config.json` 中的位置，厂商用 `ENTITY` 固定色），超出 11 个用中性灰，不要循环取色。
- 图表一律经 `core/charts.js`（`chartIn`、`lineBase`、`lineSeries`、`axisTooltip` 等），不要在模块里单独写坐标轴、网格或提示框样式；不要用双 y 轴。
- 页面文字一律中文，大数用“万 / 亿”，数据文件以 `?v=时间戳` 取数避免缓存。
- 本地预览：`python -m http.server 8765 --directory docs`，然后打开 `http://localhost:8765/#games/players`。

## 协作约定

- 回复与文件内容用中文，数字用阿拉伯数字，回复简洁。
- 不编造数据或事实；推测须说明。任务不清晰先确认；复杂任务先给执行步骤，确认后再做。
- 未经允许不删除文件。`data/` 与 `docs/*.json` 由工作流自动更新，手工修改前先确认。
