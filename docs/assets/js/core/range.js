/** 时间范围筛选（各页面共用） */

const MONTHS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };

/** 以 latestIso 为终点向前推，返回起始日期（ISO）；ALL 返回 null */
export function rangeStart(latestIso, range) {
  if (range === 'ALL' || !MONTHS[range]) return null;
  const d = new Date(latestIso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - MONTHS[range]);
  return d.toISOString().slice(0, 10);
}

/** 返回 keys 中不早于 start 的下标；keys 可以是 YYYY-MM-DD 或 YYYY-MM */
export function indicesFrom(keys, start) {
  const res = [];
  keys.forEach((k, i) => {
    if (!start || (k.length === 7 ? k >= start.slice(0, 7) : k >= start)) res.push(i);
  });
  return res;
}
