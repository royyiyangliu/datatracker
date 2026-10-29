/** 应用外壳：两级导航 + 按需加载页面模块 */
import { CATEGORIES, LEGACY_HASH } from './registry.js';
import { esc } from './core/format.js';

const $ = id => document.getElementById(id);
const sections = new Map();   // "cat/page" -> { el, mod, ready }
const lastPage = {};          // 分类 -> 最近访问的页面
let current = null;
let navToken = 0;

function parseHash() {
  let h = location.hash.slice(1);
  if (LEGACY_HASH[h]) h = LEGACY_HASH[h];
  const [c, p] = h.split('/');
  const cat = CATEGORIES.find(x => x.id === c) ?? CATEGORIES[0];
  const page = cat.pages.find(x => x.id === p) ?? cat.pages.find(x => x.id === lastPage[cat.id]) ?? cat.pages[0];
  return { cat, page };
}

function renderNav(cat, page) {
  $('nav-primary').innerHTML = CATEGORIES.map(c => {
    const target = c.pages.find(p => p.id === lastPage[c.id]) ?? c.pages[0];
    return `<a href="#${c.id}/${target.id}"${c.id === cat.id ? ' class="active" aria-current="page"' : ''}>${esc(c.label)}</a>`;
  }).join('');
  $('nav-secondary').innerHTML = cat.pages.map(p =>
    `<a href="#${cat.id}/${p.id}"${p.id === page.id ? ' class="active" aria-current="page"' : ''}>${esc(p.label)}</a>`).join('');
}

async function show() {
  const token = ++navToken;
  const { cat, page } = parseHash();
  const key = `${cat.id}/${page.id}`;
  if (location.hash.slice(1) !== key) history.replaceState(null, '', `#${key}`);
  lastPage[cat.id] = page.id;
  renderNav(cat, page);
  document.title = `${page.label} · 公开数据追踪`;

  if (current && current !== key) sections.get(current)?.mod?.deactivate?.();
  current = key;
  sections.forEach((s, k) => { s.el.hidden = k !== key; });

  let s = sections.get(key);
  if (!s) {
    s = { el: document.createElement('section'), mod: null, ready: null };
    s.el.innerHTML = '<div class="state">加载中…</div>';
    $('main').appendChild(s.el);
    sections.set(key, s);
    s.ready = (async () => {
      const mod = (await page.load()).default;
      s.el.innerHTML = '';
      await mod.mount(s.el);
      s.mod = mod;
    })().catch(e => {
      console.error(e);
      s.ready = null;
      s.el.innerHTML = `<div class="state error">加载失败：${esc(e.message)}</div>`;
    });
  }
  await s.ready;
  if (token !== navToken || !s.mod) return;   // 期间已切换到别的页面，或加载失败
  s.mod.activate?.();
  $('meta').textContent = s.mod.metaText?.() ?? '';
}

window.addEventListener('hashchange', show);
show();
