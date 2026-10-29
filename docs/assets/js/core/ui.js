/** 通用交互组件 */

/**
 * 绑定分段控件：<div class="seg"><button data-v="x" class="active">…</button>…</div>
 * 返回 setValue，供外部同步选中状态
 */
export function bindSeg(el, onChange) {
  const buttons = [...el.querySelectorAll('button')];
  const setValue = v => buttons.forEach(b => b.classList.toggle('active', b.dataset.v === v));
  buttons.forEach(b => b.addEventListener('click', () => {
    setValue(b.dataset.v);
    onChange(b.dataset.v);
  }));
  return setValue;
}

/** 生成分段控件的 HTML */
export function segHtml(options, active, attrs = '') {
  return `<div class="seg" ${attrs}>` +
    options.map(([v, label]) => `<button type="button" data-v="${v}"${v === active ? ' class="active"' : ''}>${label}</button>`).join('') +
    '</div>';
}

/** 下载 CSV（带 BOM，Excel 打开中文不乱码） */
export function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** 读取 docs/ 下的数据文件；加时间戳避免 GitHub Pages 缓存旧数据 */
export async function fetchJSON(name, { optional = false } = {}) {
  try {
    const res = await fetch(`${name}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`${name} 加载失败（${res.status}）`);
    return await res.json();
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}
