"""
Ramp AI Index - 数据抓取脚本
- 月度数据（采用率、人均 AI 支出）：解析 https://ramp.com/data/ai-index 页面内嵌的 Next.js 数据
- token 数据（支出/用量、价格）：请求页面图表使用的 JSON 接口 /data/ai-index/chart-data/*
- 每次全量覆盖写入 data/ramp/*.csv，并生成前端使用的 docs/ramp.json
- 任一数据源解析或校验失败则退出码 1，不写入任何文件
"""

import csv
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE_URL = "https://ramp.com/data/ai-index"
CHART_URL = "https://ramp.com/data/ai-index/chart-data/{name}"
DATA_DIR = "data/ramp"
OUTPUT_JSON = "docs/ramp.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# 采用率：页面上的厂商顺序
VENDORS = ["OpenAI", "Anthropic", "xAI", "DeepSeek", "Mistral AI"]

# token 支出：单独展示的模型提供商，其余合并为 other
TOKEN_MAKERS = ["openai", "anthropic", "xai", "google"]

# token 价格：接口里的 token_type -> 前端口径
PRICE_TYPES = {"all_tokens": "blended", "uncached_input": "input", "output": "output"}
PRICE_MAKERS = ["anthropic", "openai"]


class DataError(Exception):
    pass


# ══ 网络 ══════════════════════════════════

def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8")
        except Exception as e:
            print(f"    尝试 {attempt + 1}/{retries} 失败: {e}")
            if attempt < retries - 1:
                time.sleep(5)
    raise DataError(f"请求失败: {url}")


# ══ 页面内嵌数据解析 ══════════════════════

def extract_rsc_payload(html):
    """拼接页面中所有 self.__next_f.push([1, "..."]) 的字符串内容"""
    chunks = re.findall(r"self\.__next_f\.push\((\[.*?\])\)</script>", html, flags=re.S)
    parts = []
    for c in chunks:
        try:
            arr = json.loads(c)
        except json.JSONDecodeError:
            continue
        if len(arr) >= 2 and arr[0] == 1 and isinstance(arr[1], str):
            parts.append(arr[1])
    if not parts:
        raise DataError("页面中未找到 Next.js 数据块，页面结构可能已变化")
    return "".join(parts)


def extract_named_array(payload, name, first_key=None):
    """在 payload 中找到 "name":[...] 并解析出数组；first_key 用于区分重名的数组"""
    lead = r'\{"%s"' % re.escape(first_key) if first_key else ""
    m = re.search(r'"%s":(?=\[%s)' % (re.escape(name), lead), payload)
    if not m:
        raise DataError(f"页面数据中未找到 {name}")
    arr, _ = json.JSONDecoder().raw_decode(payload, m.end())
    if not isinstance(arr, list) or not arr:
        raise DataError(f"{name} 为空")
    return arr


def num(v):
    """页面数据中缺失值写作 "$undefined" 或 null"""
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def parse_adoption(payload):
    overall = extract_named_array(payload, "adoptionOverall")
    vendor = extract_named_array(payload, "adoptionVendor")

    rows = {}
    for r in overall:
        rows.setdefault(r["date_month"][:7], {})["overall"] = num(r["adoption_rate_pct"])
    for r in vendor:
        if r["vendor"] in VENDORS:
            rows.setdefault(r["date_month"][:7], {})[r["vendor"]] = num(r["adoption_rate_pct"])

    months = sorted(rows)
    result = {
        "months": months,
        "series": {k: [rows[m].get(k) for m in months] for k in ["overall"] + VENDORS},
    }
    check_series(result["series"], 0, 100, "采用率")
    return result


def parse_spend_per_employee(payload):
    data = extract_named_array(payload, "spendPerEmployee")
    rows = sorted(data, key=lambda r: r["date_month"])
    # 与页面一致：前 10%/前 1% 缺失时回退到 P90/P99
    pick = lambda r, a, b: num(r.get(a)) if num(r.get(a)) is not None else num(r.get(b))
    result = {
        "months": [r["date_month"][:7] for r in rows],
        "series": {
            "median": [num(r.get("median_pepm")) for r in rows],
            "top10": [pick(r, "top_10_percent_median_pepm", "p90_pepm") for r in rows],
            "top1": [pick(r, "top_1_percent_median_pepm", "p99_pepm") for r in rows],
        },
    }
    check_series(result["series"], 0, 1_000_000, "人均 AI 支出")
    return result


def parse_spend_share(payload):
    """AI 占企业支出（不含工资）的比例：总体及分行业，转换为百分比"""
    overall = extract_named_array(payload, "overall", first_key="my_date")
    sector = extract_named_array(payload, "sector", first_key="my_date")
    pct = lambda v: round(v * 100, 4) if num(v) is not None else None

    by_month = {r["my_date"][:7]: pct(r.get("ai_share_of_tpv")) for r in overall}
    sectors = {}
    for r in sector:
        # 与页面一致：剔除未识别行业
        if r.get("naics_sector") in (None, "Unknown"):
            continue
        sectors.setdefault(r["naics_sector"], {})[r["my_date"][:7]] = pct(r.get("ai_share_of_tpv"))

    months = sorted(by_month)
    result = {
        "months": months,
        "overall": [by_month[m] for m in months],
        "sectors": {name: [vals.get(m) for m in months] for name, vals in sorted(sectors.items())},
    }
    if len(result["sectors"]) < 10:
        raise DataError(f"AI 支出占比的行业数异常: {len(result['sectors'])}")
    check_series({"overall": result["overall"], **result["sectors"]}, 0, 100, "AI 支出占比")
    return result


# ══ token 接口解析 ════════════════════════

def parse_token_volumes(rows):
    """按周、按模型提供商汇总 token 支出（美元）与用量（token 数）"""
    agg = {}  # (week_end, maker) -> [spend, volume]
    for r in rows:
        if r.get("period_grain") != "weekly":
            continue
        key = (r["period_end"], r["model_maker"])
        slot = agg.setdefault(key, [0.0, 0.0])
        v = num(r.get("metric_value")) or 0
        if r["metric_key"] == "token_spend":
            slot[0] += v
        elif r["metric_key"] == "token_volume":
            slot[1] += v
    if not agg:
        raise DataError("tokenVolumes 中没有周度数据")

    weeks = sorted({w for w, _ in agg})
    makers = sorted({m for _, m in agg})
    detail = [[w, m, round(s, 2), round(t)] for (w, m), (s, t) in sorted(agg.items())]

    def folded(idx):
        out = {k: [] for k in TOKEN_MAKERS + ["other"]}
        for w in weeks:
            value = lambda m: agg.get((w, m), [0, 0])[idx]
            for m in TOKEN_MAKERS:
                out[m].append(round(value(m), 2))
            out["other"].append(round(sum(value(m) for m in makers if m not in TOKEN_MAKERS), 2))
        return out

    result = {
        "weeks": weeks,
        "spend": folded(0),
        "volume": folded(1),
    }
    if sum(v for s in result["spend"].values() for v in s[-1:]) <= 0:
        raise DataError("tokenVolumes 最新一周支出为 0")
    return result, detail


def parse_token_prices(rows):
    """按日（滚动 7 天）计算每百万 token 价格：Anthropic、OpenAI 及两者合计"""
    agg = {}  # (date, type, maker) -> [cost, count]
    for r in rows:
        t = PRICE_TYPES.get(r.get("token_type"))
        if t is None or r.get("model_maker") not in PRICE_MAKERS:
            continue
        agg[(r["usage_date"], t, r["model_maker"])] = [
            num(r.get("token_cost_usd_7d")) or 0,
            num(r.get("token_count_7d")) or 0,
        ]
    if not agg:
        raise DataError("tokenPrices 中没有可用数据")

    dates = sorted({d for d, _, _ in agg})
    price = lambda cost, count: round(cost / count * 1e6, 4) if count > 0 else None
    result = {"dates": dates}
    detail = []
    for t in PRICE_TYPES.values():
        series = {"combined": [], "anthropic": [], "openai": []}
        for d in dates:
            parts = [agg.get((d, t, m)) for m in PRICE_MAKERS]
            for m, p in zip(PRICE_MAKERS, parts):
                series[m].append(price(*p) if p else None)
                if p:
                    detail.append([d, t, m, round(p[0], 2), round(p[1]), price(*p)])
            if all(parts):
                series["combined"].append(price(sum(p[0] for p in parts), sum(p[1] for p in parts)))
            else:
                series["combined"].append(None)
        result[t] = series
    check_series(result["blended"], 0, 1000, "token 价格")
    return result, detail


# ══ 校验与输出 ════════════════════════════

def check_series(series, lo, hi, label):
    for name, values in series.items():
        valid = [v for v in values if v is not None]
        if not valid:
            raise DataError(f"{label} / {name} 全部缺失")
        bad = [v for v in valid if not lo <= v <= hi]
        if bad:
            raise DataError(f"{label} / {name} 存在超出 [{lo}, {hi}] 的值: {bad[:3]}")


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def series_rows(keys, series, names):
    return [[k] + [series[n][i] for n in names] for i, k in enumerate(keys)]


def main():
    print("获取 Ramp AI Index 页面...")
    html = fetch(BASE_URL)
    payload = extract_rsc_payload(html)
    m = re.search(r'"dataVersion":"([^"]+)"', payload)
    query = f"?version={m.group(1)}" if m else ""

    adoption = parse_adoption(payload)
    pepm = parse_spend_per_employee(payload)
    share = parse_spend_share(payload)
    print(f"  采用率 {adoption['months'][0]} ~ {adoption['months'][-1]}，"
          f"人均支出 {pepm['months'][0]} ~ {pepm['months'][-1]}，"
          f"支出占比 {share['months'][0]} ~ {share['months'][-1]}（{len(share['sectors'])} 个行业）")

    print("获取 token 支出/用量...")
    tokens, token_detail = parse_token_volumes(json.loads(fetch(CHART_URL.format(name="tokenVolumes") + query)))
    print(f"  {tokens['weeks'][0]} ~ {tokens['weeks'][-1]}，共 {len(tokens['weeks'])} 周")

    print("获取 token 价格...")
    prices, price_detail = parse_token_prices(json.loads(fetch(CHART_URL.format(name="tokenPrices") + query)))
    print(f"  {prices['dates'][0]} ~ {prices['dates'][-1]}，共 {len(prices['dates'])} 天")

    output = {
        "last_updated": None,
        "source": BASE_URL,
        "adoption": adoption,
        "spend_per_employee": pepm,
        "spend_share": share,
        "tokens": tokens,
        "token_prices": prices,
    }
    # 数据与上次相同则不写文件，last_updated 表示数据最近一次变化的时间
    try:
        with open(OUTPUT_JSON, encoding="utf-8") as f:
            previous = json.load(f)
        previous["last_updated"] = None
        if previous == output:
            print("数据无变化，跳过写入")
            return
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    os.makedirs(DATA_DIR, exist_ok=True)
    write_csv(f"{DATA_DIR}/adoption_monthly.csv", ["month", "overall"] + VENDORS,
              series_rows(adoption["months"], adoption["series"], ["overall"] + VENDORS))
    write_csv(f"{DATA_DIR}/spend_per_employee_monthly.csv",
              ["month", "median_usd", "top10pct_median_usd", "top1pct_median_usd"],
              series_rows(pepm["months"], pepm["series"], ["median", "top10", "top1"]))
    sector_names = list(share["sectors"])
    write_csv(f"{DATA_DIR}/ai_share_of_spend_monthly.csv", ["month", "overall_pct"] + sector_names,
              [[m, share["overall"][i]] + [share["sectors"][n][i] for n in sector_names]
               for i, m in enumerate(share["months"])])
    write_csv(f"{DATA_DIR}/token_by_maker_weekly.csv",
              ["week_end", "model_maker", "token_spend_usd", "token_volume"], token_detail)
    write_csv(f"{DATA_DIR}/token_prices_daily.csv",
              ["date", "token_type", "model_maker", "cost_usd_7d", "tokens_7d", "price_per_mtok_usd"],
              price_detail)

    output["last_updated"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
    print(f"已写入 {OUTPUT_JSON} 与 {DATA_DIR}/*.csv")

if __name__ == "__main__":
    try:
        main()
    except (DataError, KeyError, ValueError) as e:
        print(f"错误: {e}")
        sys.exit(1)
